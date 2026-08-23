import { useEffect, useMemo, useState } from 'react'
import { loadAll, LAYERS, ROAD_METRICS } from './data'
import MapView from './MapView'
import Sidebar from './Sidebar'
import Details from './Details'

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i)
export const PRESETS = {
  day: { label: 'Cała doba', hours: ALL_HOURS },
  am: { label: 'Szczyt poranny 7–9', hours: [7, 8] },
  pm: { label: 'Szczyt popołudniowy 15–17', hours: [15, 16] },
  midday: { label: 'Międzyszczyt 10–14', hours: [10, 11, 12, 13] },
  night: { label: 'Noc 22–5', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
}

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
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(e.message))
  }, [])

  const hours = useMemo(
    () => (hour == null ? PRESETS[preset].hours : [hour]),
    [preset, hour],
  )

  if (error) return <div className="fatal">{error}</div>
  if (!data) return <div className="fatal">Wczytywanie danych…</div>

  return (
    <div className="app">
      <Sidebar
        data={data} visible={visible} setVisible={setVisible}
        preset={preset} setPreset={setPreset} hour={hour} setHour={setHour}
        metric={metric} setMetric={setMetric} areas={areas} setAreas={setAreas}
        hours={hours} onSelect={setSelected} selected={selected}
      />
      <MapView
        data={data} visible={visible} hours={hours} metric={metric}
        areas={areas} selected={selected} onSelect={setSelected}
      />
      {selected && (
        <Details data={data} sel={selected} hours={hours} metric={metric}
          onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

export { LAYERS, ROAD_METRICS }
