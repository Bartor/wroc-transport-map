import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  LAYERS, ROAD_METRICS, roadProfile, profileFor, addProfiles, fmt, pct,
  HOUR_LABEL, sumHours, parentOf, sectionLetter, sectionOf,
} from './data'

const SOURCE = { road: 'points', pt: 'pt', bike: 'bike', ped: 'ped' }

/**
 * The letter in KW_08B is a cross-section within measurement point KW_08.
 * Siblings often sit on the same spot, so spell out what each one covers and
 * make them clickable.
 */
function Sections({ data, kind, p, onSelect }) {
  if (!SOURCE[kind]) return null
  const parent = parentOf(kind, p)
  const sibs = data[SOURCE[kind]].filter((x) => parentOf(kind, x) === parent)
  if (sibs.length < 2) return null
  return (
    <div className="sections">
      <h4>Punkt {parent} — {sibs.length} przekroje</h4>
      <p className="hint">
        Litera oznacza przekrój pomiarowy: osobny wlot, jezdnię lub stronę
        ulicy w tym samym punkcie. Pomiary są rozłączne, nie powielone.
      </p>
      {sibs.map((x) => (
        <button key={x.id} className={x.id === p.id ? 'sec on' : 'sec'}
          onClick={() => onSelect({ kind, id: x.id, ref: x })}>
          <b>{sectionLetter(x.id) || '—'}</b>
          <span>{sectionOf(kind, x) || x.name}</span>
        </button>
      ))}
    </div>
  )
}

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

export default function Details({ data, sel, hours, metric, period, onSelect, onClose }) {
  const { kind, ref: p } = sel
  const color = LAYERS[kind].color
  const catOrder = data.meta.vehCatOrder

  let body = null

  if (p.aggregate) {
    const profs = p.members.map((m) => profileFor(data, kind, m, metric))
    const total = addProfiles(profs)
    const bySection = Object.fromEntries(
      p.members.map((m, i) => [
        `${sectionLetter(m.id) || m.id} — ${sectionOf(kind, m) || m.name}`,
        sumHours(profs[i], hours),
      ]),
    )
    body = (
      <>
        <dl>
          <dt>Przekroje</dt><dd>{p.members.map((m) => m.id).join(', ')}</dd>
          <dt>Suma w okresie {period}</dt><dd>{fmt(sumHours(total, hours))}</dd>
          <dt>Suma dobowa</dt><dd>{fmt(total.reduce((a, b) => a + b, 0))}</dd>
        </dl>
        <p className="hint">
          Punkt pomiarowy widziany jako całość — przekroje A, B, C to osobne
          wloty tego samego miejsca, więc ich pomiary się sumują.
        </p>
        <h4>Profil dobowy — cały punkt</h4>
        <Profile values={total} hours={hours} color={color} />
        <Breakdown title={`Udział przekrojów — ${period}`} obj={bySection} />
        {onSelect && (
          <div className="sections">
            <h4>Przejdź do przekroju</h4>
            {p.members.map((m) => (
              <button key={m.id} className="sec"
                onClick={() => onSelect({ kind, id: m.id, ref: m })}>
                <b>{sectionLetter(m.id) || '—'}</b>
                <span>{sectionOf(kind, m) || m.name}</span>
              </button>
            ))}
          </div>
        )}
      </>
    )
  } else if (kind === 'road') {
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
        <Breakdown title={`Kierunki — ${period}, wszystkie pojazdy`} obj={byDir} />
        <Breakdown title={`Kategorie pojazdów — ${period}`} obj={byCat} />
        <Breakdown title="Poza jezdnią — rowery i UTO" obj={off} />
      </>
    )
  } else if (kind === 'bike' || kind === 'ped') {
    body = (
      <>
        <dl>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          {p.where?.length ? <><dt>Miejsce</dt><dd>{p.where.join('; ')}</dd></> : null}
          {p.date ? <><dt>Pomiar</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd></> : null}
          <dt>Łącznie</dt><dd>{fmt(p.total)}</dd>
          <dt>W okresie {period}</dt><dd>{fmt(sumHours(p.byHour, hours))}</dd>
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
  } else if (kind === 'pt') {
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
  } else if (kind === 'rail') {
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
        {!p.aggregate && (
          <Sections data={data} kind={kind} p={p} onSelect={onSelect} />
        )}
        {p.geo && GEO_NOTE[p.geo] && <p className="geo">📍 {GEO_NOTE[p.geo]}</p>}
      </div>
    </div>
  )
}
