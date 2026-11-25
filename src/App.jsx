import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { AppMessage, AppShell, ErrorBoundary, hoursOf } from '@bartor-net/ui-kit'
import { BASEMAPS, DEFAULT_BASEMAP } from '@bartor-net/ui-kit/map'
import {
  loadAll, loadFile, LAYERS, ROAD_METRICS, PRESETS, rangeLabel, periodShare,
  buildMarkers, familyOf, VIEWS, markerIndex, NET_MODES, MODE,
} from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import { readHash, hashOf, findSelection } from './urlState'
import { BY, FLOW0, UNITS, withoutDirs } from './flows'

// The panel brings the charts library with it; nobody needs it before the
// first click, so it loads apart from the map, and early, while idle.
const loadDetails = () => import('./Details')
const Details = lazy(loadDetails)

// What the address asked for when the page opened, checked against what
// exists; anything unknown falls back to the default.
const URL0 = readHash()
const DEFAULTS = {
  view: 'nodes', range: PRESETS.am.range, metric: 'all', aggregate: true,
  roadPeople: true, basemap: DEFAULT_BASEMAP, flow: FLOW0,
}
const pick = (v, ok, def) => (v !== undefined && ok(v) ? v : def)

export default function App() {
  const [loaded, setData] = useState(null)
  const [error, setError] = useState(null)
  // one survey at a time, see VIEWS
  const [view, setView] = useState(pick(URL0.view, (v) => VIEWS[v], DEFAULTS.view))
  const [survey, setSurvey] = useState(!!URL0.survey)   // survey addresses overlay
  // [from, to) hours, may wrap
  const [range, setRange] = useState(URL0.range || DEFAULTS.range)
  const [metric, setMetric] = useState(pick(URL0.metric, (m) => ROAD_METRICS[m], DEFAULTS.metric))
  const [areas, setAreas] = useState(URL0.areas || null) // null = all
  const [aggregate, setAggregate] = useState(URL0.aggregate ?? DEFAULTS.aggregate) // a point's sections as one
  const [wholeDay, setWholeDay] = useState(!!URL0.wholeDay)   // expand peak-only counts
  // road view: car occupants, not vehicles
  const [roadPeople, setPeople] = useState(URL0.roadPeople ?? DEFAULTS.roadPeople)
  const [occupancy, setOccupancy] = useState(null)  // set from meta on load
  const [net, setNet] = useState({
    on: !!URL0.net && !!NET_MODES[URL0.net],
    mode: pick(URL0.net, (m) => NET_MODES[m], 'road'), min: 3000,
  })
  const [basemap, setBasemap] = useState(pick(URL0.basemap, (b) => BASEMAPS[b], DEFAULTS.basemap))
  const [sig, setSig] = useState({ on: !!URL0.sig, filter: URL0.sig || 'candidates' })
  // permanent map labels: numbers, shares (%), either or both; with neither
  // the details come on hover
  const [labels, setLabels] = useState(URL0.labels || { num: false, pct: false, declutter: true })
  const [selected, setSelected] = useState(null)
  // Sections, and single directions of them, left out of their node's numbers:
  // pieceKey()s and dirPieceKey()s.
  const [off, setOff] = useState(() => new Set(URL0.off || []))
  // everything below counts without the directions left out
  const data = useMemo(() => loaded && withoutDirs(loaded, off), [loaded, off])
  // How the panel's charts are split and what they count, for any point.
  const [flow, setFlow] = useState({
    by: pick(URL0.by, (b) => BY[b], FLOW0.by),
    unit: pick(URL0.unit, (u) => UNITS[u], FLOW0.unit),
    modes: pick(URL0.modes, (m) => m.length && m.every((k) => MODE[k]), FLOW0.modes),
  })
  // The piece of a node under the mouse, in the panel or on the map; both
  // light it up.
  const [hot, setHot] = useState(null)
  const toggleOff = useCallback((keys, out) => setOff((prev) => {
    const next = new Set(prev)
    for (const k of [].concat(keys)) {
      if (out) next.add(k)
      else {
        // a section comes back whole
        for (const x of prev) if (x === k || x.startsWith(`${k}@`)) next.delete(x)
      }
    }
    return next
  }), [])
  // On phones the sidebar is a bottom sheet; this is whether it is pulled up.
  const [sheetOpen, setSheetOpen] = useState(false)

  // Picking a point opens its own sheet, so the settings sheet gets out of the
  // way - two stacked sheets would leave no map to look at.
  const select = useCallback((s) => {
    setSelected(s)
    if (s) setSheetOpen(false)
  }, [])
  const close = useCallback(() => setSelected(null), [])

  // Street-network model layers, fetched the first time they are wanted.
  const [nets, setNets] = useState({})
  const asked = useRef(new Set())
  const loadNet = useCallback((mode) => {
    const f = NET_MODES[mode].file
    if (asked.current.has(f)) return
    asked.current.add(f)
    loadFile(f).then((j) => setNets((n) => ({ ...n, [f]: j })))
  }, [])
  useEffect(() => { if (net.on) loadNet(net.mode) }, [net.on, net.mode, loadNet])

  useEffect(() => {
    loadAll().then((d) => {
      setOccupancy(URL0.occupancy > 0 && URL0.occupancy < 5
        ? URL0.occupancy : d.meta.carOccupancy.default)
      setData(d)
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500))
      idle(() => loadDetails())
    }).catch((e) => setError(e.message))
  }, [])

  const hours = useMemo(
    () => hoursOf(range),
    [range],
  )
  const period = rangeLabel(range)

  // Everything below follows from the view: which layers are drawn, whether
  // nodes are pies, and the unit. Pies are always in people.
  const v = VIEWS[view]
  const visible = useMemo(() => ({
    ...Object.fromEntries(Object.keys(LAYERS).map((k) => [k, v.layers.includes(k)])),
    survey,
  }), [v, survey])
  const split = !!v.split
  const merged = split || aggregate
  const people = split || roadPeople

  // Switching views drops a selection the new view does not draw.
  const changeView = useCallback((next) => {
    setView(next)
    setSelected((s) => (s && !VIEWS[next].layers.includes(s.kind) ? null : s))
  }, [])

  // One marker list for the map and the sidebar, so a click in either always
  // refers to the same object.
  const markers = useMemo(
    () => (data ? buildMarkers(data, {
      visible, hours, metric, areas, aggregate: merged, split, wholeDay, people, occupancy, off,
    }) : {}),
    [data, visible, hours, metric, areas, merged, split, wholeDay, people, occupancy, off],
  )

  // A selected node is rebuilt whenever the markers are; point at the fresh
  // one, or leaving out a section would not reach the panel.
  const sel = useMemo(() => {
    const m = selected && markerIndex(markers)[`${selected.kind}:${selected.id}`]
    return m && m.ref !== selected.ref ? { ...selected, ref: m.ref } : selected
  }, [markers, selected])

  // A linked selection, once there is something to find it in.
  const linked = useRef(URL0.sel)
  useEffect(() => {
    if (!data || !linked.current) return
    const s = findSelection(data, markerIndex(markers), linked.current)
    linked.current = null
    if (s) select(s)
  }, [data, markers, select])

  // Keep the address in step, without adding a history entry per click.
  useEffect(() => {
    if (!data) return
    const h = hashOf({
      view, range, metric, areas, aggregate, wholeDay, roadPeople, occupancy, labels,
      basemap, survey, net, sig, selected, off, flow,
    }, { ...DEFAULTS, occupancy: data.meta.carOccupancy.default })
    if (h !== window.location.hash && !(h === '' && !window.location.hash)) {
      window.history.replaceState(null, '', h || window.location.pathname + window.location.search)
    }
  }, [data, view, range, metric, areas, aggregate, wholeDay, roadPeople, occupancy, labels,
    basemap, survey, net, sig, selected, off, flow])

  // The point the selection belongs to, shared by the map and the panel.
  const family = useMemo(
    () => (data && sel ? familyOf(data, markers, sel) : null),
    [data, markers, sel],
  )

  if (error) return <AppMessage>{error}</AppMessage>
  if (!data) return <AppMessage>Wczytywanie danych…</AppMessage>

  return (
    <AppShell>
      <Sidebar
        data={data} view={view} setView={changeView} visible={visible} off={off}
        survey={survey} setSurvey={setSurvey}
        range={range} setRange={setRange}
        metric={metric} setMetric={setMetric} areas={areas} setAreas={setAreas}
        hours={hours} period={period} aggregate={aggregate} setAggregate={setAggregate}
        wholeDay={wholeDay} setWholeDay={setWholeDay}
        people={people} roadPeople={roadPeople} setPeople={setPeople}
        occupancy={occupancy} setOccupancy={setOccupancy}
        net={net} setNet={setNet} nets={nets} loadNet={loadNet} basemap={basemap} setBasemap={setBasemap}
        sig={sig} setSig={setSig} labels={labels} setLabels={setLabels}
        markers={markers} onSelect={select} selected={selected}
        sheetOpen={sheetOpen} setSheetOpen={setSheetOpen}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} period={period} aggregate={merged} nets={nets}
        wholeDay={wholeDay} people={people} occupancy={occupancy} net={net}
        basemap={basemap} sig={sig} markers={markers} labels={labels}
        selected={sel} onSelect={select} family={family} off={off}
        hot={hot} setHot={setHot}
      />
      {selected && (
        <ErrorBoundary resetKey={`${selected.kind}:${selected.id}`} onClose={close}>
          <Suspense fallback={null}>
            <Details data={data} sel={sel} hours={hours} metric={metric}
              period={period} wholeDay={wholeDay} people={people} occupancy={occupancy}
              share={periodShare(data.meta, hours)} markers={markers} family={family}
              off={off} toggleOff={toggleOff} hot={hot} setHot={setHot}
              flow={flow} setFlow={setFlow}
              onSelect={select} onClose={close} />
          </Suspense>
        </ErrorBoundary>
      )}
    </AppShell>
  )
}

export { LAYERS, ROAD_METRICS }
