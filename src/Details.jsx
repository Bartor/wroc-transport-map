import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { LAYERS, ROAD_METRICS, roadProfile, fmt, pct, HOUR_LABEL, sumHours } from './data'

const Profile = ({ values, hours, color }) => (
  <ResponsiveContainer width="100%" height={130}>
    <BarChart data={values.map((v, h) => ({ h, v }))} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
      <XAxis dataKey="h" tickFormatter={HOUR_LABEL} interval={3} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} width={46} />
      <RTooltip formatter={(v) => fmt(v)} labelFormatter={(h) => `${HOUR_LABEL(h)}–${HOUR_LABEL((h + 1) % 24)}`} />
      <Bar dataKey="v">
        {values.map((_, h) => (
          <Cell key={h} fill={color} fillOpacity={hours.includes(h) ? 1 : 0.28} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
)

const Breakdown = ({ title, obj, total }) => {
  const rows = Object.entries(obj || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1])
  if (!rows.length) return null
  const sum = total || rows.reduce((a, [, v]) => a + v, 0)
  return (
    <div className="breakdown">
      <h4>{title}</h4>
      {rows.map(([k, v]) => (
        <div key={k} className="bar">
          <span>{k}</span>
          <i style={{ width: `${(100 * v) / sum}%` }} />
          <b>{fmt(v)}</b>
        </div>
      ))}
    </div>
  )
}

const GEO_NOTE = {
  intersections: 'położenie wyliczone ze skrzyżowań opisanych w kolumnie „Odcinek”',
  'one-intersection': 'położenie przybliżone — rozpoznano jedno skrzyżowanie',
  'cross-only': 'położenie przybliżone — tylko ulice poprzeczne',
  'street-centroid': 'położenie przybliżone — środek ulicy',
  'street-anchored': 'położenie przybliżone — fragment ulicy przy odcinku',
  'cross-centroid': 'położenie przybliżone — pomiędzy ulicami poprzecznymi',
  'street-near-cross': 'położenie przybliżone — ulica przy skrzyżowaniu',
  nominatim: 'położenie przybliżone — wyszukiwarka OSM',
  manual: 'położenie wskazane ręcznie (etl/overrides.json)',
  stop: 'położenie przystanku z OpenStreetMap',
  street: 'położenie przybliżone — środek ulicy',
  osm: 'stacja z OpenStreetMap',
  stations: 'środek ciężkości stacji kordonu',
  section: 'współrzędne z wykazu przekrojów',
  point: 'środek punktu pomiarowego',
}

export default function Details({ data, sel, hours, metric, onClose }) {
  const { kind, ref: p } = sel
  const color = LAYERS[kind].color
  const catOrder = data.meta.vehCatOrder

  let body = null

  if (kind === 'road') {
    const sec = data.roadById[p.id]
    const cats = ROAD_METRICS[metric].cats
    const prof = roadProfile(sec, { cats }, catOrder)
    const byCat = {}
    const byDir = {}
    if (sec) {
      for (const [d, dd] of Object.entries(sec.dirs)) {
        byDir[d.replace('>', ' → ')] = hours.reduce((a, h) => a + dd.h[h].reduce((x, y) => x + y, 0), 0)
        for (let h = 0; h < 24; h++) {
          if (!hours.includes(h)) continue
          dd.h[h].forEach((v, i) => {
            const label = data.meta.vehCats[catOrder[i]] || catOrder[i]
            byCat[label] = (byCat[label] || 0) + v
          })
        }
      }
    }
    const off = {}
    if (sec?.off) {
      for (const rows of Object.values(sec.off)) {
        for (let h = 0; h < 24; h++) {
          if (!hours.includes(h)) continue
          rows[h].forEach((v, i) => {
            const label = data.meta.vehCats[data.meta.offCatOrder[i]] || data.meta.offCatOrder[i]
            off[label] = (off[label] || 0) + v
          })
        }
      }
    }
    body = (
      <>
        <dl>
          <dt>Obszar</dt><dd>{p.area}</dd>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          <dt>Miejsce pomiaru</dt><dd>{p.where}</dd>
          <dt>Data</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd>
          <dt>Suma dobowa</dt><dd>{fmt(p.total)} pojazdów</dd>
        </dl>
        <h4>Profil dobowy — {ROAD_METRICS[metric].label.toLowerCase()}</h4>
        <Profile values={prof} hours={hours} color={color} />
        <Breakdown title="Kierunki (wybrany okres, wszystkie pojazdy)" obj={byDir} />
        <Breakdown title="Kategorie pojazdów (wybrany okres)" obj={byCat} />
        <Breakdown title="Poza jezdnią — rowery i UTO" obj={off} />
      </>
    )
  }

  if (kind === 'bike' || kind === 'ped') {
    body = (
      <>
        <dl>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          {p.where?.length ? <><dt>Miejsce</dt><dd>{p.where.join('; ')}</dd></> : null}
          {p.date ? <><dt>Pomiar</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd></> : null}
          <dt>Łącznie</dt><dd>{fmt(p.total)}</dd>
          <dt>W wybranym okresie</dt><dd>{fmt(sumHours(p.byHour, hours))}</dd>
        </dl>
        <h4>Profil dobowy</h4>
        <Profile values={p.byHour} hours={hours} color={color} />
        <Breakdown title="Kierunki" obj={p.byDir} />
        <Breakdown title="Płeć" obj={p.bySex} />
        {kind === 'bike' && <Breakdown title="Gdzie jadą" obj={p.byPlace} />}
        {kind === 'bike' && <Breakdown title="Pojazd" obj={p.byMode} />}
        {kind === 'bike' && <Breakdown title="Kask" obj={p.helmet} />}
        {kind === 'ped' && <Breakdown title="Sprawność" obj={p.byMobility} />}
        {kind === 'ped' && <Breakdown title="Cechy dodatkowe" obj={p.byMobility2} />}
        {kind === 'ped' && <Breakdown title="Strona ulicy" obj={p.bySide} />}
      </>
    )
  }

  if (kind === 'pt') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    body = (
      <>
        <dl>
          <dt>Przystanek</dt><dd>{p.stop || '—'}</dd>
          <dt>Lokalizacja</dt><dd>{p.loc}</dd>
          <dt>Osiedle</dt><dd>{p.osiedle || '—'}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt>Pasażerowie w pojazdach</dt><dd>{fmt(p.pax)} w {fmt(p.veh)} pojazdach</dd>
          <dt>Średnie wykorzystanie miejsc</dt><dd>{pct(p.avgLoad)}</dd>
          {p.boarded ? <><dt>Wsiadło / wysiadło</dt><dd>{fmt(p.boarded)} / {fmt(p.alighted)}</dd></> : null}
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={prof} hours={hours} color={color} />
        <Breakdown title="Trakcja (liczba pojazdów)" obj={p.byTraction} />
        <Breakdown title="Linie (pasażerowie)" obj={p.byLine} />
        <Breakdown title="Kierunki (pasażerowie)" obj={p.byDir} />
        <Breakdown title="Przewoźnicy (liczba pojazdów)" obj={p.byCarrier} />
      </>
    )
  }

  if (kind === 'rail') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    body = (
      <>
        <dl>
          <dt>Stacje kordonu</dt><dd>{p.stations.join(', ')}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt>Pociągi</dt><dd>{p.trains}</dd>
          <dt>Pasażerowie</dt>
          <dd>{Object.entries(p.pax).map(([d, v]) => `${d}: ${fmt(v)}`).join(' · ')}</dd>
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={prof} hours={hours} color={color} />
        <Breakdown title="Kierunek" obj={p.pax} />
        <Breakdown title="Miejsca w pociągach" obj={p.seats} />
        <Breakdown title="Przewoźnicy (kursy)" obj={p.carriers} />
      </>
    )
  }

  return (
    <div className="details">
      <div className="dhead" style={{ borderColor: color }}>
        <div>
          <span className="pill" style={{ background: color }}>{p.id}</span>
          <h3>{p.name || p.stop || p.stations?.join(' / ')}</h3>
        </div>
        <button onClick={onClose}>×</button>
      </div>
      <div className="dbody">
        {body}
        {p.geo && GEO_NOTE[p.geo] && <p className="geo">📍 {GEO_NOTE[p.geo]}</p>}
      </div>
    </div>
  )
}
