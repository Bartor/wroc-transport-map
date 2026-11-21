import { useEffect, useMemo, useState } from 'react'
import {
  loadAll, LAYERS, ROAD_METRICS, PRESETS, periodLabel, periodShare, buildMarkers,
} from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import Details from './Details'
import { DEFAULT_BASEMAP } from './basemaps'

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState({
    road: true, pt: true, bike: false, ped: false, rail: false, survey: false,
  })
  const [preset, setPreset] = useState('am')
  const [hour, setHour] = useState(null) // single hour overrides the preset
  const [metric, setMetric] = useState('all')
  const [areas, setAreas] = useState(null) // null = all
  const [aggregate, setAggregate] = useState(true)     // nodes as modal-split pies
  const [wholeDay, setWholeDay] = useState(false)   // expand peak-only counts
  const [people, setPeople] = useState(true)        // people, not vehicles
  const [occupancy, setOccupancy] = useState(null)  // set from meta on load
  const [net, setNet] = useState({ on: false, mode: 'road', min: 3000 })
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP)
  const [sig, setSig] = useState({ on: false, filter: 'candidates' })
  // map labels: 'hover' (tooltip only), 'num' or 'pct' (always visible)
  const [labels, setLabels] = useState({ mode: 'hover', declutter: true })
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    loadAll().then((d) => {
      setOccupancy(d.meta.carOccupancy.default)
      setData(d)
    }).catch((e) => setError(e.message))
  }, [])

  const hours = useMemo(
    () => (hour == null ? PRESETS[preset].hours : [hour]),
    [preset, hour],
  )
  const period = periodLabel(preset, hour)

  // One marker list for the map and the sidebar, so a click in either always
  // refers to the same object.
  const markers = useMemo(
    () => (data ? buildMarkers(data, {
      visible, hours, metric, areas, aggregate, wholeDay, people, occupancy,
    }) : {}),
    [data, visible, hours, metric, areas, aggregate, wholeDay, people, occupancy],
  )

  if (error) return <div className="fatal">{error}</div>
  if (!data) return <div className="fatal">Wczytywanie danych…</div>

  return (
    <div className="app">
      <Sidebar
        data={data} visible={visible} setVisible={setVisible}
        preset={preset} setPreset={setPreset} hour={hour} setHour={setHour}
        metric={metric} setMetric={setMetric} areas={areas} setAreas={setAreas}
        hours={hours} period={period} aggregate={aggregate} setAggregate={setAggregate}
        wholeDay={wholeDay} setWholeDay={setWholeDay}
        people={people} setPeople={setPeople}
        occupancy={occupancy} setOccupancy={setOccupancy}
        net={net} setNet={setNet} basemap={basemap} setBasemap={setBasemap}
        sig={sig} setSig={setSig} labels={labels} setLabels={setLabels}
        markers={markers} onSelect={setSelected} selected={selected}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} period={period} aggregate={aggregate}
        wholeDay={wholeDay} people={people} occupancy={occupancy} net={net}
        basemap={basemap} sig={sig} markers={markers} labels={labels}
        selected={selected} onSelect={setSelected}
      />
      {selected && (
        <Details data={data} sel={selected} hours={hours} metric={metric}
          period={period} wholeDay={wholeDay} people={people} occupancy={occupancy}
          share={periodShare(data.meta, hours)} markers={markers}
          onSelect={setSelected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

export { LAYERS, ROAD_METRICS }
