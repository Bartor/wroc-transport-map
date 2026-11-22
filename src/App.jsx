import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  loadAll, loadFile, LAYERS, ROAD_METRICS, PRESETS, rangeLabel, hoursOf, periodShare,
  buildMarkers, familyOf, VIEWS, markerIndex, NET_MODES,
} from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import ErrorBoundary from './ErrorBoundary'

// The panel brings the charts library with it; nobody needs it before the
// first click, so it loads apart from the map, and early, while idle.
const loadDetails = () => import('./Details')
const Details = lazy(loadDetails)
import { DEFAULT_BASEMAP } from './basemaps'

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('nodes')         // one survey at a time, see VIEWS
  const [survey, setSurvey] = useState(false)       // survey addresses overlay
  const [range, setRange] = useState(PRESETS.am.range) // [from, to) hours, may wrap
  const [metric, setMetric] = useState('all')
  const [areas, setAreas] = useState(null) // null = all
  const [aggregate, setAggregate] = useState(true)     // a point's sections as one
  const [wholeDay, setWholeDay] = useState(false)   // expand peak-only counts
  const [roadPeople, setPeople] = useState(true)    // road view: car occupants, not vehicles
  const [occupancy, setOccupancy] = useState(null)  // set from meta on load
  const [net, setNet] = useState({ on: false, mode: 'road', min: 3000 })
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP)
  const [sig, setSig] = useState({ on: false, filter: 'candidates' })
  // permanent map labels: numbers, shares (%), either or both; with neither
  // the details come on hover
  const [labels, setLabels] = useState({ num: false, pct: false, declutter: true })
  const [selected, setSelected] = useState(null)
  // Sections left out of their node's numbers, as pieceKey()s.
  const [off, setOff] = useState(() => new Set())
  // The piece of a node under the mouse, in the panel or on the map; both
  // light it up.
  const [hot, setHot] = useState(null)
  const toggleOff = useCallback((keys, out) => setOff((prev) => {
    const next = new Set(prev)
    for (const k of [].concat(keys)) (out ? next.add(k) : next.delete(k))
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
      setOccupancy(d.meta.carOccupancy.default)
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

  // The point the selection belongs to, shared by the map and the panel.
  const family = useMemo(
    () => (data && sel ? familyOf(data, markers, sel) : null),
    [data, markers, sel],
  )

  if (error) return <div className="fatal">{error}</div>
  if (!data) return <div className="fatal">Wczytywanie danych…</div>

  return (
    <div className="app">
      <Sidebar
        data={data} view={view} setView={changeView} visible={visible}
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
              onSelect={select} onClose={close} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

export { LAYERS, ROAD_METRICS }
