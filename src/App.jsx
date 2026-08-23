import { useEffect, useMemo, useState } from 'react'
import { loadAll, LAYERS, ROAD_METRICS, PRESETS, periodLabel } from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import Details from './Details'
import { DEFAULT_BASEMAP } from './basemaps'

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState({
    road: true, pt: false, bike: true, ped: true, rail: false, survey: false,
  })
  const [preset, setPreset] = useState('am')
  const [hour, setHour] = useState(null) // single hour overrides the preset
  const [metric, setMetric] = useState('all')
  const [areas, setAreas] = useState(null) // null = all
  const [aggregate, setAggregate] = useState(false)
  const [wholeDay, setWholeDay] = useState(false)   // expand peak-only counts
  const [people, setPeople] = useState(false)       // vehicles -> people
  const [occupancy, setOccupancy] = useState(null)  // set from meta on load
  const [net, setNet] = useState({ on: false, mode: 'road', min: 3000 })
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP)
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
        onSelect={setSelected} selected={selected}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} period={period} aggregate={aggregate}
        wholeDay={wholeDay} people={people} occupancy={occupancy} net={net}
        basemap={basemap}
        selected={selected} onSelect={setSelected}
      />
      {selected && (
        <Details data={data} sel={selected} hours={hours} metric={metric}
          period={period} wholeDay={wholeDay} people={people} occupancy={occupancy}
          onSelect={setSelected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

export { LAYERS, ROAD_METRICS }
