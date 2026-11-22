import { useEffect, useMemo, useState } from 'react'
import {
  loadAll, LAYERS, ROAD_METRICS, PRESETS, rangeLabel, hoursOf, periodShare, buildMarkers,
  familyOf, VIEWS, markerIndex,
} from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import Details from './Details'
import ErrorBoundary from './ErrorBoundary'
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
  // map labels: 'hover' (tooltip only), 'num' or 'pct' (always visible)
  const [labels, setLabels] = useState({ mode: 'hover', declutter: true })
  const [selected, setSelected] = useState(null)
  // Sections left out of their node's numbers, as pieceKey()s.
  const [off, setOff] = useState(() => new Set())
  const toggleOff = (keys, out) => setOff((prev) => {
    const next = new Set(prev)
    for (const k of [].concat(keys)) (out ? next.add(k) : next.delete(k))
    return next
  })
  // On phones the sidebar is a bottom sheet; this is whether it is pulled up.
  const [sheetOpen, setSheetOpen] = useState(false)

  // Picking a point opens its own sheet, so the settings sheet gets out of the
  // way - two stacked sheets would leave no map to look at.
  const select = (s) => {
    setSelected(s)
    if (s) setSheetOpen(false)
  }

  useEffect(() => {
    loadAll().then((d) => {
      setOccupancy(d.meta.carOccupancy.default)
      setData(d)
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
  const changeView = (next) => {
    setView(next)
    if (selected && !VIEWS[next].layers.includes(selected.kind)) setSelected(null)
  }

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
        net={net} setNet={setNet} basemap={basemap} setBasemap={setBasemap}
        sig={sig} setSig={setSig} labels={labels} setLabels={setLabels}
        markers={markers} onSelect={select} selected={selected}
        sheetOpen={sheetOpen} setSheetOpen={setSheetOpen}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} period={period} aggregate={merged}
        wholeDay={wholeDay} people={people} occupancy={occupancy} net={net}
        basemap={basemap} sig={sig} markers={markers} labels={labels}
        selected={sel} onSelect={select} family={family} off={off}
      />
      {selected && (
        <ErrorBoundary resetKey={`${selected.kind}:${selected.id}`}
          onClose={() => setSelected(null)}>
          <Details data={data} sel={sel} hours={hours} metric={metric}
            period={period} wholeDay={wholeDay} people={people} occupancy={occupancy}
            share={periodShare(data.meta, hours)} markers={markers} family={family}
            off={off} toggleOff={toggleOff}
            onSelect={select} onClose={() => setSelected(null)} />
        </ErrorBoundary>
      )}
    </div>
  )
}

export { LAYERS, ROAD_METRICS }
