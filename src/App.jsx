import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { AppMessage, AppShell, ErrorBoundary, Hint, LinkButton, Panel, hoursOf, isPhone } from '@bartor-net/ui-kit'
import { BASEMAPS, DEFAULT_BASEMAP } from '@bartor-net/ui-kit/map'
import {
  loadAll, loadFile, LAYERS, ROAD_METRICS, PRESETS, rangeLabel, periodShare,
  buildMarkers, familyOf, VIEWS, markerIndex, NET_MODES, MODE,
} from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import { readHash, hashOf, findSelection } from './urlState'
import { BY, FLOW0, UNITS, withoutDirs } from './flows'
import { TripsControls, TripsMap, tripsLegend, useTrips } from './TripsView'
import { AnswersControls, AnswersMap, AnswersPanel, answersLegend, useAnswers } from './AnswersView'
import {
  ChangeControls, ChangeMap, SpeedsControls, SpeedsMap, StationsControls, StationsMap, changeLegend,
  speedsLegend, stationsLegend,
} from './MoreViews'
import { ASK0 } from './answers'
import { readDays } from './days'
import { changes } from './compare'
import { PAINTS, TRIPS0, placeName, prepare, prepareFreight, readZones } from './trips'

// The panel brings the charts library with it; nobody needs it before the
// first click, so it loads apart from the map, and early, while idle.
const loadDetails = () => import('./Details')
const Details = lazy(loadDetails)
const TripsPanel = lazy(() => import('./TripsPanel'))
const morePanel = (name) => lazy(() => import('./MorePanels').then((m) => ({ default: m[name] })))
const ChangePanel = morePanel('ChangePanel')
const StationsPanel = morePanel('StationsPanel')
const SpeedsPanel = morePanel('SpeedsPanel')

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

  // The survey views keep settings of their own, and an open thing each:
  // a station, a road counted twice. Their panel is open unless closed.
  const [trip, setTrip] = useState({
    ...TRIPS0, ...URL0.trip, paint: pick(URL0.trip?.paint, (x) => PAINTS[x], TRIPS0.paint),
  })
  const [ask, setAsk] = useState({ ...ASK0, ...URL0.ask })
  const [ownId, setOwnId] = useState(URL0.own || null)
  const [ownPanel, setOwnPanel] = useState(!isPhone() || !!URL0.own)

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

  // The files of the survey views, likewise.
  const [files, setFiles] = useState({})
  const wanted = useRef(new Set())
  const need = VIEWS[view].own
  const fetchFile = useCallback((f) => {
    if (wanted.current.has(f)) return
    wanted.current.add(f)
    loadFile(f).then((j) => setFiles((x) => ({ ...x, [f]: j })))
  }, [])
  useEffect(() => {
    for (const f of [...(need || []), ...(view === 'trips' ? ['freight', 'places'] : [])]) fetchFile(f)
  }, [need, view, fetchFile])

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
    setOwnId(null)
    setOwnPanel(!isPhone())
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
      basemap, survey, net, sig, selected, off, flow, trip, ask, own: ownId,
    }, { ...DEFAULTS, occupancy: data.meta.carOccupancy.default })
    if (h !== window.location.hash && !(h === '' && !window.location.hash)) {
      window.history.replaceState(null, '', h || window.location.pathname + window.location.search)
    }
  }, [data, view, range, metric, areas, aggregate, wholeDay, roadPeople, occupancy, labels,
    basemap, survey, net, sig, selected, off, flow, trip, ask, ownId])

  // The point the selection belongs to, shared by the map and the panel.
  const family = useMemo(
    () => (data && sel ? familyOf(data, markers, sel) : null),
    [data, markers, sel],
  )

  // ---------------------------------------------------------- the survey views
  const people0 = useMemo(() => (files.zones && files.trips ? prepare(files.zones, files.trips) : null), [files.zones, files.trips])
  const freight = useMemo(() => (files.zones && files.freight ? prepareFreight(files.zones, files.freight) : null), [files.zones, files.freight])
  const zones = useMemo(() => (files.zones ? readZones(files.zones) : null), [files.zones])
  const dayData = useMemo(() => (people0 ? readDays(people0) : null), [people0])
  const tripsX = useTrips(view === 'trips' ? (trip.set === 'freight' ? freight : people0) : null, trip, hours, files.places?.spots, dayData)
  const askX = useAnswers(view === 'answers' ? files.answers : null, zones, ask)
  const changed = useMemo(() => (files.compare && loaded ? changes(files.compare, loaded) : null), [files.compare, loaded])
  const dark = BASEMAPS[basemap].dark
  const pickTrip = useCallback((p, add) => {
    setTrip((t) => ({
      ...t,
      picked: t.picked.includes(p.key) ? t.picked.filter((k) => k !== p.key)
        : add || t.many ? [...t.picked, p.key] : [p.key],
    }))
    setOwnPanel(true)
  }, [])
  const pickAsk = useCallback((p) => {
    setAsk((a) => ({ ...a, place: a.place === p.key ? null : p.key }))
    setOwnPanel(true)
  }, [])
  const openOwn = useCallback((id) => {
    setOwnId(id)
    setOwnPanel(true)
    setSheetOpen(false)
  }, [])
  const openRoad = useCallback((id) => {
    changeView('road')
    const ref = loaded.points.find((q) => q.id === id)
    if (ref) select({ kind: 'road', id, ref })
  }, [changeView, loaded, select])
  const extra = useMemo(() => {
    if (!zones || !VIEWS[view].ask) return null
    const level = view === 'trips' ? trip.level : ask.level === 'd' ? 'd' : 'z'
    const list = level === 'd' ? zones.districts : zones.zones
    return {
      find: (needle) => list.filter((q) => q.name.toLowerCase().includes(needle) || q.id === needle).slice(0, 8)
        .map((q) => ({ key: q.key, label: placeName(q), sub: q.level === 'd' ? (q.city ? 'osiedle' : 'gmina') : `rejon ${q.id} · ${q.district}`, color: VIEWS[view].color, place: q })),
      pick: (q) => (view === 'trips' ? setTrip((t) => ({ ...t, picked: [q.key] })) : setAsk((a) => ({ ...a, place: q.key }))),
    }
  }, [zones, view, trip.level, ask.level])

  const wantChoice = useCallback(() => fetchFile('choice'), [fetchFile])
  const sel0 = ownId ? { id: ownId } : null
  const shut = () => { setOwnPanel(false); setOwnId(null) }
  /** A survey view's parts: in the sidebar, on the map, in the panel. */
  function ownParts() {
    if (view === 'trips' && tripsX) {
      return {
        controls: <TripsControls x={tripsX} setT={setTrip} hasFreight={!!freight}
          choice={files.choice} onChoice={wantChoice} />,
        map: <TripsMap x={tripsX} dark={dark} onPick={pickTrip} setT={setTrip} />, legend: tripsLegend({ x: tripsX, dark }),
        panel: <TripsPanel x={tripsX} setT={setTrip} period={period} onClose={shut} />,
      }
    }
    if (view === 'answers' && askX) {
      return {
        controls: <AnswersControls x={askX} setA={setAsk} />,
        map: <AnswersMap x={askX} onPick={pickAsk} />, legend: answersLegend({ x: askX }),
        panel: <AnswersPanel x={askX} setA={setAsk} onClose={shut} />,
      }
    }
    if (view === 'change' && changed) {
      return {
        controls: <ChangeControls rows={changed} sel={sel0} onPick={(r) => openOwn(r.key)} />,
        map: <ChangeMap rows={changed} sel={sel0} onPick={(r) => openOwn(r.key)} />, legend: changeLegend(),
        panel: <ChangePanel C={files.compare} rows={changed} zones={zones?.districts} sel={sel0} onRoad={openRoad} onClose={ownId ? () => setOwnId(null) : shut} />,
      }
    }
    if (view === 'stations' && files.stations) {
      return {
        controls: <StationsControls S={files.stations} hours={hours} period={period} sel={sel0} onPick={openOwn} />,
        map: <StationsMap S={files.stations} hours={hours} sel={sel0} onPick={openOwn} />, legend: stationsLegend(),
        panel: sel0 && <StationsPanel S={files.stations} C={files.compare} hours={hours} period={period} sel={sel0} onClose={shut} />,
      }
    }
    if (view === 'speeds' && files.speeds) {
      return {
        controls: <SpeedsControls S={files.speeds} hours={hours} period={period} sel={sel0} onPick={openOwn} />,
        map: <SpeedsMap S={files.speeds} hours={hours} onPick={openOwn} />, legend: speedsLegend(),
        panel: sel0 && <SpeedsPanel S={files.speeds} hours={hours} sel={sel0} onClose={shut} />,
      }
    }
    return need ? { controls: <Panel title={VIEWS[view].label}><Hint>Wczytywanie danych…</Hint></Panel> } : {}
  }

  if (error) return <AppMessage>{error}</AppMessage>
  if (!data) return <AppMessage>Wczytywanie danych…</AppMessage>

  const own = ownParts()

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
        sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} extra={extra}
        own={own.controls && (
          <>
            {own.panel && !ownPanel && (
              <LinkButton block onClick={() => { setOwnPanel(true); setSheetOpen(false) }}>Pokaż statystyki</LinkButton>
            )}
            {own.controls}
          </>
        )}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} period={period} aggregate={merged} nets={nets}
        wholeDay={wholeDay} people={people} occupancy={occupancy} net={net}
        basemap={basemap} sig={sig} markers={markers} labels={labels}
        selected={sel} onSelect={select} family={family} off={off}
        hot={hot} setHot={setHot} own={own.map} ownLegend={own.legend}
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
      {own.panel && ownPanel && !selected && (
        <ErrorBoundary resetKey={`${view}:${ownId}`} onClose={shut}>
          <Suspense fallback={null}>{own.panel}</Suspense>
        </ErrorBoundary>
      )}
    </AppShell>
  )
}

export { LAYERS, ROAD_METRICS }
