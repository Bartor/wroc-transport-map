import { useMemo } from 'react'
import { LAYERS, ROAD_METRICS, PRESETS, roadVolume, fmt, sumHours, HOUR_LABEL } from './data'

const COUNTS = {
  road: (d) => d.points.length,
  pt: (d) => d.pt.length,
  bike: (d) => d.bike.length,
  ped: (d) => d.ped.length,
  rail: (d) => d.rail.length,
  survey: (d) => d.survey.length,
}

export default function Sidebar({
  data, visible, setVisible, preset, setPreset, hour, setHour,
  metric, setMetric, areas, setAreas, hours, period, aggregate, setAggregate,
  onSelect, selected,
}) {
  const catOrder = data.meta.vehCatOrder

  // Top cross-sections for the current filter — the quick "where is it worst" list.
  const top = useMemo(() => {
    const cats = ROAD_METRICS[metric].cats
    return data.points
      .filter((p) => p.lat && (!areas || areas.includes(p.area)))
      .map((p) => ({ p, v: roadVolume(data.roadById[p.id], { cats, hours }, catOrder) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12)
  }, [data, metric, hours, areas, catOrder])

  const totals = useMemo(() => {
    const cats = ROAD_METRICS[metric].cats
    const road = data.points.reduce(
      (a, p) => a + roadVolume(data.roadById[p.id], { cats, hours }, catOrder), 0)
    const bike = data.bike.reduce((a, p) => a + sumHours(p.byHour, hours), 0)
    const ped = data.ped.reduce((a, p) => a + sumHours(p.byHour, hours), 0)
    const pt = data.pt.reduce(
      (a, p) => a + Object.values(p.byHour).reduce((b, arr) => b + sumHours(arr, hours), 0), 0)
    return { road, bike, ped, pt }
  }, [data, metric, hours, catOrder])

  return (
    <aside className="sidebar">
      <header>
        <h1>KBR Wrocław 2024</h1>
        <p className="sub">Pomiary ruchu — przeglądarka map</p>
      </header>

      <section>
        <h2>Okres</h2>
        <div className="chips">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} className={hour == null && preset === k ? 'chip on' : 'chip'}
              onClick={() => { setPreset(k); setHour(null) }}>{v.label}</button>
          ))}
        </div>
        <label className="slider">
          <span>{hour == null ? 'Pojedyncza godzina' : `Godzina ${HOUR_LABEL(hour)}`}</span>
          <input type="range" min="0" max="23" value={hour ?? 8}
            onChange={(e) => setHour(Number(e.target.value))} />
          {hour != null && (
            <button className="link" onClick={() => setHour(null)}>wróć do okresu</button>
          )}
        </label>
      </section>

      <section>
        <h2>Punkty i przekroje</h2>
        <label className="row">
          <input type="checkbox" checked={aggregate}
            onChange={() => setAggregate(!aggregate)} />
          <span>Sumuj przekroje do punktu pomiarowego</span>
        </label>
        <p className="hint">
          Litera w numerze (KW_08<b>A</b>, KW_08<b>B</b>) to przekrój — osobny
          wlot, jezdnia lub strona ulicy w tym samym miejscu. Włącz, żeby
          zobaczyć ruch całego punktu zamiast pojedynczego wlotu.
        </p>
      </section>

      <section>
        <h2>Warstwy</h2>
        {Object.entries(LAYERS).map(([k, v]) => (
          <label key={k} className="row">
            <input type="checkbox" checked={!!visible[k]}
              onChange={() => setVisible({ ...visible, [k]: !visible[k] })} />
            <i className="swatch" style={{ background: v.color }} />
            <span>{v.label}</span>
            <b>{COUNTS[k](data)}</b>
          </label>
        ))}
      </section>

      <section>
        <h2>Ruch drogowy — co liczyć</h2>
        <select value={metric} onChange={(e) => setMetric(e.target.value)}>
          {Object.entries(ROAD_METRICS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div className="chips tight">
          {data.meta.areas.map((a) => {
            const on = !areas || areas.includes(a)
            return (
              <button key={a} className={on ? 'chip on' : 'chip'}
                onClick={() => {
                  const cur = areas || data.meta.areas
                  const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
                  setAreas(next.length === data.meta.areas.length ? null : next)
                }}>{a}</button>
            )
          })}
        </div>
      </section>

      <section className="totals">
        <h2>Suma — {period}</h2>
        <div><span>Pojazdy (wszystkie przekroje)</span><b>{fmt(totals.road)}</b></div>
        <div><span>Pasażerowie autobusów i tramwajów</span><b>{fmt(totals.pt)}</b></div>
        <div><span>Rowerzyści (punkty rowerowe)</span><b>{fmt(totals.bike)}</b></div>
        <div><span>Piesi (punkty piesze)</span><b>{fmt(totals.ped)}</b></div>
      </section>

      <section>
        <h2>Najwyższe natężenia — {period}</h2>
        <ol className="top">
          {top.map(({ p, v }) => (
            <li key={p.id}
              className={selected?.id === p.id ? 'on' : ''}
              onClick={() => onSelect({ kind: 'road', id: p.id, ref: p })}>
              <span>{p.name}</span>
              <em>{p.segment}</em>
              <b>{fmt(v)}</b>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        Dane: Kompleksowe Badania Ruchu Wrocław 2024. Podkład: OpenStreetMap.<br />
        Punkty rowerowe i piesze nie mają współrzędnych w źródle — są
        geokodowane z opisu odcinka, więc ich położenie jest przybliżone.
      </footer>
    </aside>
  )
}
