import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import {
  LAYERS, ROAD_METRICS, roadProfile, profileFor, addProfiles, fmt, pct,
  HOUR_LABEL, sumHours, parentOf, sectionLetter, sectionOf, fmtEst,
  activeCats, expand, toPeople, expansionOf, BASIS_LABEL, markerIndex, splitTotal,
  HOUR_LABEL as HL, coverageGap, windowKind,
} from './data'
import { copyCard, downloadCard, shareCard, canShareImage } from './shareCard'

const SHARE_FILES = canShareImage()

const GROUP_LABEL = {
  road: 'Przekroje drogowe',
  pt: 'Przystanki — pomiar pasażerów',
  bike: 'Przekroje rowerowe',
  ped: 'Przekroje piesze',
}

/**
 * A node is made of pieces: lettered road sections (KW_08A, KW_08B...), and
 * the stops of the transit point paired with it. These tabs move between the
 * node as a whole and its pieces, each with its share of its own group - road
 * and transit count different things, so they are never summed together.
 */
function SubNav({ family, shares, onSelect }) {
  const { node, groups, current } = family
  const toNode = () => onSelect({ kind: node.kind, id: node.id, ref: node.ref })
  const isOn = (kind, id) => current?.kind === kind && current.id === id
  return (
    <nav className="subnav" aria-label="Części węzła">
      {current && node && (
        <button type="button" className="back" onClick={toNode}>
          ← cały węzeł {node.id}
        </button>
      )}
      {node && (
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!current}
            className={current ? 'tab' : 'tab on'} onClick={toNode}>
            <b>Σ</b><span>Całość</span><em>węzeł</em>
          </button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.kind} className={`tab-group ${g.kind}`}>
          {(groups.length > 1 || node) && <h5>{GROUP_LABEL[g.kind]}</h5>}
          <div className="tabs" role="tablist">
            {g.members.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={isOn(g.kind, m.id)}
                className={isOn(g.kind, m.id) ? 'tab on' : 'tab'}
                title={`${m.id} · ${sectionOf(g.kind, m) || m.name}`}
                onClick={() => onSelect({ kind: g.kind, id: m.id, ref: m })}>
                <b>{sectionLetter(m.id) || '—'}</b>
                <span>{(g.kind === 'road' ? m.name : sectionOf(g.kind, m)) || m.name}</span>
                <em>{shares[`${g.kind}:${m.id}`] == null ? '—' : `${shares[`${g.kind}:${m.id}`]}%`}</em>
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

/** A section's hourly profile stacked on the rest of its point. */
const PartProfile = ({ part, whole, hours, color }) => (
  <ResponsiveContainer width="100%" height={120}>
    <BarChart data={part.map((v, h) => ({ h, v, rest: Math.max(0, (whole[h] || 0) - v) }))}
      margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
      <XAxis dataKey="h" tickFormatter={HOUR_LABEL} interval={3} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} width={46} />
      <RTooltip formatter={(v, n) => [fmt(v), n === 'v' ? 'ten przekrój' : 'reszta punktu']}
        labelFormatter={(h) => `${HOUR_LABEL(h)}–${HOUR_LABEL((h + 1) % 24)}`} />
      <Bar dataKey="v" stackId="p">
        {part.map((_, h) => (
          <Cell key={h} fill={color} fillOpacity={hours.includes(h) ? 1 : 0.3} />
        ))}
      </Bar>
      <Bar dataKey="rest" stackId="p">
        {part.map((_, h) => (
          <Cell key={h} fill="#5b6475" fillOpacity={hours.includes(h) ? 0.55 : 0.2} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
)

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
  // largest first; the "inne" remainder last, however big
  const rows = Object.entries(obj || {}).filter(([, v]) => v)
    .sort((a, b) => (a[0] === 'inne') - (b[0] === 'inne') || b[1] - a[1])
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

// Direction of travel, "W>E" = from west to east; the arrow points where they go.
const ARROW = { N: '↑', S: '↓', E: '→', W: '←', NE: '↗', NW: '↖', SE: '↘', SW: '↙' }
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }
const dirLabel = (d) => {
  const to = d.includes('>') ? d.split('>')[1] : d
  return `${ARROW[to] || ''} ${d.replace('>', ' → ')}`.trim()
}

/**
 * Each section's directions side by side for the period: one bar per
 * section, split between its two directions. Shows tidal flows - a street
 * busy inbound in the morning and outbound in the afternoon - that a single
 * total hides. One-way sections have a single segment.
 */
function DirSplit({ title, rows }) {
  const shown = rows.filter((r) => r.dirs.some((d) => d.v > 0))
  if (!shown.length) return null
  return (
    <div className="dirsplit">
      <h4>{title}</h4>
      {shown.map((r) => {
        const sum = r.dirs.reduce((a, d) => a + d.v, 0)
        return (
          <div key={r.id} className="dir-row">
            <b>{r.letter}</b>
            <span className="dir-name" title={r.id}>{r.name}</span>
            <div className="dir-bar">
              {r.dirs.map((d, i) => (
                <i key={d.key} className={i ? 'b' : 'a'} style={{ flexGrow: d.v }} />
              ))}
            </div>
            <div className="dir-vals">
              {r.dirs.map((d, i) => (
                <span key={d.key} className={i ? 'b' : 'a'}>
                  {dirLabel(d.key)} <b>{fmt(d.v)}</b> · {sum ? Math.round((100 * d.v) / sum) : 0}%
                </span>
              ))}
            </div>
          </div>
        )
      })}
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

const KICKER = {
  road: 'Punkt pomiaru ruchu drogowego',
  pt: 'Punkt pomiaru potoków pasażerskich',
  bike: 'Punkt pomiaru ruchu rowerowego',
  ped: 'Punkt pomiaru ruchu pieszego',
  rail: 'Kordon kolejowy',
  signal: 'Sygnalizacja świetlna',
}

const KBR = 'Kompleksowe Badania Ruchu Wrocław 2024'
const SOURCE_TEXT = {
  road: `${KBR}, zał. 3.3 — pomiary ruchu drogowego.`,
  pt: `${KBR}, zał. 6.4 — pomiary potoków pasażerskich w autobusach i tramwajach.`,
  bike: `${KBR}, zał. 3.4 — pomiary ruchu rowerowego.`,
  ped: `${KBR}, zał. 3.5 — pomiary ruchu pieszego.`,
  rail: `${KBR}, zał. 7.1 — potoki pasażerskie w pociągach.`,
  signal: 'OpenStreetMap (sygnalizacja), rozkład jazdy GTFS Wrocławia, model '
    + `natężenia ruchu na podstawie ${KBR}.`,
}

/** Copy the point as a picture, with a download for browsers that will not
 *  put images on the clipboard. */
function ShareButtons({ spec }) {
  const [state, setState] = useState(null)
  const settle = (s) => {
    setState(s)
    setTimeout(() => setState(null), 2800)
  }
  const copy = async () => {
    setState('busy')
    try { settle(await copyCard(spec)) } catch { settle('error') }
  }
  const download = async () => {
    try { await downloadCard(spec); settle('saved') } catch { settle('error') }
  }
  const share = async () => {
    try {
      const r = await shareCard(spec)
      if (r === 'shared') settle('shared')
    } catch { settle('error') }
  }
  return (
    <div className="share">
      {SHARE_FILES && (
        <button type="button" className="share-btn primary" onClick={share}>
          {state === 'shared' ? 'Udostępniono ✓' : 'Udostępnij'}
        </button>
      )}
      <button type="button" className="share-btn" onClick={copy} disabled={state === 'busy'}>
        {state === 'copied' ? 'Skopiowano ✓' : state === 'busy' ? 'Kopiuję…' : 'Kopiuj obraz'}
      </button>
      <button type="button" className="share-btn icon" onClick={download}
        title="Pobierz jako PNG" aria-label="Pobierz jako PNG">⬇</button>
      {state === 'downloaded' && <span className="share-msg">schowek niedostępny — pobrano plik</span>}
      {state === 'saved' && <span className="share-msg">pobrano plik</span>}
      {state === 'error' && <span className="share-msg err">nie udało się</span>}
    </div>
  )
}

/** Hours as runs, so 6-10 and 15-19 do not read as 6-19: "07:00–09:00, 15:00–17:00". */
function hourRuns(hours) {
  const runs = []
  for (const h of [...hours].sort((a, b) => a - b)) {
    if (runs.length && runs.at(-1)[1] === h - 1) runs.at(-1)[1] = h
    else runs.push([h, h])
  }
  return runs.map(([a, b]) => `${HL(a)}–${HL((b + 1) % 24)}`).join(', ')
}

// The survey writes a round-the-clock count as "00:00-00:00".
const hoursText = (s) => (/^0?0:00\s*-\s*0?0:00$/.test(s.trim()) ? 'całą dobę' : s)

/** Modal split of a node, in people, with the vehicles it came from. */
function ModalSplit({ node, data, occupancy }) {
  const { split } = node
  const total = splitTotal(split)
  const rows = split.slices.filter((s) => s.persons > 0 || s.vehicles > 0)
  const span = split.hours.length ? `${split.hours.length} godz. (${hourRuns(split.hours)})` : 'brak'
  // the stop survey's load applied beyond the hours it was measured in
  const beyond = (split.loadHours || []).length
    && split.hours.some((h) => !split.loadHours.includes(h))
  const occ = data.transitOcc
  return (
    <div className="split">
      <h4>Podział modalny — osoby</h4>
      {!total ? (
        <p className="hint">
          Brak danych w wybranym okresie
          {split.basis === 'transit' ? ' — pasażerów liczono tylko 5–9 i 14–18.' : '.'}
        </p>
      ) : (
        <>
          <div className="split-body">
            <PieChart width={128} height={128}>
              <Pie data={rows.map((s) => ({ name: s.label, v: s.persons }))} dataKey="v"
                innerRadius={30} outerRadius={60} stroke="#1c1f26" isAnimationActive={false}>
                {rows.map((s) => <Cell key={s.key} fill={s.color} />)}
              </Pie>
            </PieChart>
            <table className="split-table">
              <thead>
                <tr><th /><th>{split.basis === 'transit' ? '' : 'pojazdy'}</th><th>osoby</th><th>%</th></tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => b.persons - a.persons).map((s) => (
                  <tr key={s.key}>
                    <td><i style={{ background: s.color }} />{s.label}</td>
                    <td>{s.vehicles == null ? '' : fmt(s.vehicles)}</td>
                    <td>{s.est ? fmtEst(s.persons) : fmt(s.persons)}</td>
                    <td>{Math.round((100 * s.persons) / total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Liczone dla {span}.</p>
        </>
      )}
      <ul className="split-notes">
        {split.basis === 'measured' && (
          <li>
            Autobusy i tramwaje: pojazdy policzone na przekrojach drogowych ×
            napełnienie zmierzone w punkcie KZ <b>{node.pair.title}</b>{' '}
            ({node.pair.dist} m stąd): autobus {split.load.bus.toFixed(1)}
            {split.local.bus ? '' : ' (średnia miejska)'}, tramwaj{' '}
            {split.load.tram.toFixed(1)}{split.local.tram ? '' : ' (średnia miejska)'}{' '}
            os./poj., zmierzone w godzinach {hourRuns(split.loadHours)}
            {beyond ? ' i przyjęte także dla pozostałych godzin okresu — poza nimi to założenie' : ''}.
            Surowej liczby pasażerów z punktu KZ nie dodajemy, bo obejmuje on
            inne słupki i wloty niż przekroje drogowe.
          </li>
        )}
        {split.basis === 'estimate' && (
          <li>
            Autobusy i tramwaje:{' '}
            {node.pair
              ? `punkt KZ ${node.pair.title} nie zarejestrował autobusów ani tramwajów, więc`
              : 'brak punktu pomiaru KZ w promieniu 150 m, więc'}
            {' '}liczba pojazdów × średnie napełnienie z pomiarów KBR (autobus{' '}
            {occ.bus.toFixed(1)}, tramwaj {occ.tram.toFixed(1)} os./poj.) — szacunek.
          </li>
        )}
        {split.basis !== 'transit' && (
          <>
            <li>
              Samochody osobowe × {occupancy.toFixed(2)} os./poj.
              {Math.abs(occupancy - data.meta.carOccupancy.default) < 1e-9
                ? ' — KBR 2024, badanie ankietowe (zał. 2.2).'
                : ' — wartość ustawiona ręcznie w ustawieniach zaawansowanych.'}
            </li>
            <li>
              Dostawcze, ciężarowe, motocykle i mikrobusy liczone tylko
              z kierowcą — dolne oszacowanie.
            </li>
            <li>Bez pieszych — KBR nie liczył ich na przekrojach drogowych.</li>
          </>
        )}
        {split.basis === 'transit' && (
          <li>
            Węzeł bez przekroju drogowego w promieniu 150 m — widać tylko podział
            między autobus i tramwaj.
          </li>
        )}
      </ul>
    </div>
  )
}

/** Unit for a layer's headline number; the road one depends on toggles, so
 *  Details wraps it in `unit()`. */
function unitOf(kind) {
  return { road: 'pojazdów', pt: 'pasażerów', bike: 'rowerzystów', ped: 'pieszych',
    rail: 'pasażerów' }[kind] || ''
}

export default function Details({
  data, sel, hours, metric, period, share, wholeDay, people, occupancy,
  markers, family, onSelect, onClose,
}) {
  const { kind, ref: p } = sel
  // The drawn node carries the modal split and its transit partner, if any.
  const node = markers ? markerIndex(markers)[`${kind}:${sel.id}`] : null
  const color = LAYERS[kind]?.color || '#f4a261'
  const catOrder = data.meta.vehCatOrder

  // The map applies the whole-day expansion and the vehicles-to-people
  // conversion before drawing. This panel has to apply exactly the same pair,
  // or the number here contradicts the marker that was clicked to open it.
  const wk = windowKind(kind, p)
  const shown = (v, k = kind) =>
    toPeople(expand(data.meta, k === kind ? wk : k, v, wholeDay), k, occupancy, people)
  const shape = (arr, k = kind) => arr.map((v) => shown(v, k))
  const exp = expansionOf(data.meta, wk)
  const scaled = wholeDay && exp?.factor > 1
  const unit = (k) => (k === 'road'
    ? (people ? 'osób w samochodach osobowych' : `pojazdów — ${ROAD_METRICS[metric].label.toLowerCase()}`)
    : unitOf(k))

  // A section's directions in the period, in the panel's unit. Road sections
  // record each direction separately; cyclists and pedestrians by direction
  // of travel. Transit directions are destinations, not ways along a street,
  // so they are listed rather than split.
  const dirsOf = (k, ref) => {
    if (k === 'road') {
      const sec = data.roadById[ref.id]
      if (!sec) return []
      const cats = activeCats(metric, people)
      const keep = cats
        ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0)
        : catOrder.map((_, i) => i)
      return Object.entries(sec.dirs).map(([d, dd]) => ({
        key: d,
        v: shown(hours.reduce((a, h) => a + keep.reduce((x, i) => x + (dd.h[h]?.[i] || 0), 0), 0), k),
      }))
    }
    if (k === 'bike' || k === 'ped') {
      // 3.4 and 3.5 record the side people came from ("wlot początkowy"), so
      // "E" is someone heading west; spelled as from > to like the road keys
      return Object.entries(ref.byHourDir || {}).map(([d, arr]) => ({
        key: OPPOSITE[d] ? `${d}>${OPPOSITE[d]}` : d, v: shown(sumHours(arr, hours), k),
      }))
    }
    return []
  }
  // Hours of the period this piece was actually counted in. A count of 0 in
  // an hour nobody measured is "no data", not "no traffic".
  const coveredOf = (k, ref) => {
    if (ref.aggregate) {
      return hours.filter((h) => ref.members.some((m) => coveredOf(k, m).includes(h)))
    }
    if (k === 'road') {
      const sec = data.roadById[ref.id]
      return hours.filter((h) => Object.values(sec?.dirs || {})
        .some((dd) => (dd.h[h] || []).some((x) => x > 0)))
    }
    const w = data.meta.windows?.[windowKind(k, ref)]
    return w ? hours.filter((h) => w.includes(h)) : hours
  }
  const covered = kind === 'signal' ? hours : coveredOf(kind, p)
  /** The period figure, or why there is none. */
  const now = (text) => {
    if (!covered.length) return <dd className="now gap">brak pomiaru w tym okresie</dd>
    return (
      <dd className="now">
        {text}
        {!scaled && covered.length < hours.length && (
          <span className="partial"> — zmierzono {covered.length} z {hours.length} godz.</span>
        )}
      </dd>
    )
  }
  const dirRow = (k, m) => ({
    id: m.id,
    letter: sectionLetter(m.id) || '—',
    name: k === 'road' ? m.name : sectionOf(k, m) || m.name,
    dirs: dirsOf(k, m),
  })
  // transit passengers by destination or line, summed over hours and sections
  const perPeriod = (refs, field) => {
    const out = {}
    for (const r of refs) {
      for (const [key, arr] of Object.entries(r[field] || {})) {
        out[key] = (out[key] || 0) + shown(sumHours(arr, hours), 'pt')
      }
    }
    return out
  }

  // Each piece's share of its own group in the period, for the tabs and the
  // piece view. Same metric and units as everything else in the panel.
  const fam = family && onSelect ? family : null
  const shares = {}
  let part = null
  // Under a modal-split pie the road sections' shares are of all vehicles,
  // not of car occupants, which would say little about the junction.
  const allVehicles = !!fam?.node?.split
  for (const g of fam?.groups || []) {
    const profs = g.members.map((m) => (g.kind === 'road' && allVehicles
      ? profileFor(data, 'road', m, 'all', false)
      : shape(profileFor(data, g.kind, m, metric, people), g.kind)))
    const vals = profs.map((pr) => sumHours(pr, hours))
    const sum = vals.reduce((x, y) => x + y, 0)
    g.members.forEach((m, i) => {
      shares[`${g.kind}:${m.id}`] = sum ? Math.round((100 * vals[i]) / sum) : null
    })
    const i = fam.current?.kind === g.kind
      ? g.members.findIndex((m) => m.id === fam.current.id) : -1
    if (i >= 0) {
      part = {
        g, i, profs, val: vals[i], sum, share: shares[`${g.kind}:${g.members[i].id}`],
        unit: g.kind === 'road' && allVehicles ? 'pojazdów, wszystkie kategorie' : unit(g.kind),
      }
    }
  }

  let body = null
  // what the shareable picture shows when there is no modal split
  let cardBig = null
  let cardProfile = null
  const cardNotes = []

  if (kind === 'signal') {
    cardBig = { value: fmtEst(p.v * (share ?? 1)), unit: 'pojazdów na wlotach — szacunek z modelu' }
    cardNotes.push(
      `${p.kind === 'crossing' ? 'Samodzielne przejście dla pieszych z sygnalizacją'
        : `Skrzyżowanie, ${p.arms} wloty`}; ulice: ${p.streets.join(', ') || '—'}.`,
      p.runs ? `Komunikacja zbiorowa: ${fmt(p.runs)} kursów w oknie 6–10 i 15–19`
        + `${p.tram ? ', w tym tramwaj' : ''}.` : 'Brak komunikacji zbiorowej.',
      'Natężenie pochodzi z modelu (mediana błędu 24%), nie z pomiaru. O wyłączeniu '
        + 'sygnalizacji decydują też widoczność, przejścia dla pieszych, priorytet '
        + 'tramwaju i historia zdarzeń.',
    )
    body = (
      <>
        <dl>
          <dt>Rodzaj</dt>
          <dd>{p.kind === 'crossing'
            ? 'samodzielne przejście dla pieszych z sygnalizacją'
            : `skrzyżowanie, ${p.arms} wloty`}</dd>
          <dt>Ulice</dt><dd>{p.streets.join(', ') || '—'}</dd>
          <dt>Klasa</dt><dd>{p.c}{p.minor ? ' · same ulice lokalne' : ''}</dd>
          <dt>Sygnalizatorów</dt><dd>{p.n}</dd>
          <dt>Ruch (model, {period})</dt>
          <dd>{fmtEst(p.v * (share ?? 1))} poj.</dd>
          <dt>Komunikacja zbiorowa</dt>
          <dd>{p.runs ? `${fmt(p.runs)} kursów w oknie 6–10 i 15–19` : 'brak'}
            {p.tram ? ' · w tym tramwaj' : ''}</dd>
          {p.near && (
            <>
              <dt>Najbliższy pomiar</dt>
              <dd>ruch {p.near.kind}: {p.near.id}, {fmt(p.near.total)} os.,
                {' '}{p.near.dist} m stąd</dd>
            </>
          )}
        </dl>
        {p.minor && !p.tram && p.kind === 'junction' && (
          <p className="warn">
            Wszystkie wloty to ulice lokalne i nie jeździ tędy tramwaj — warto
            sprawdzić, czy sygnalizacja jest tu potrzebna.
          </p>
        )}
        <p className="hint">
          Natężenie pochodzi z modelu (mediana błędu 24%), nie z pomiaru.
          O możliwości wyłączenia sygnalizacji decydują też widoczność,
          przejścia dla pieszych, priorytet tramwaju i historia zdarzeń.
        </p>
      </>
    )
  } else if (p.aggregate) {
    const profs = p.members.map((m) => shape(profileFor(data, kind, m, metric, people)))
    const total = addProfiles(profs)
    cardBig = { value: fmt(sumHours(total, hours)), unit: unit(kind) }
    cardProfile = total
    if (p.repeatsStreet) {
      cardNotes.push('Przekroje leżą po obu stronach jednego skrzyżowania, więc jadący '
        + 'na wprost są liczeni dwa razy — suma zawyża ruch przez węzeł.')
    }
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
          <dt className="now">W okresie {period}</dt>
          {now(node?.split && splitTotal(node.split) > 0
            ? `${fmtEst(splitTotal(node.split))} osób — wszystkie środki`
            : `${fmt(sumHours(total, hours))} ${unit(kind)}`)}
          {node?.split && splitTotal(node.split) > 0 && (
            <>
              <dt className="whole">w tym ruch drogowy</dt>
              <dd className="whole">{fmt(sumHours(total, hours))} {unit(kind)}</dd>
            </>
          )}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">{fmt(total.reduce((a, b) => a + b, 0))} {unit(kind)}</dd>
        </dl>
        {p.repeatsStreet ? (
          <p className="warn">
            Przekroje leżą na tej samej ulicy po obu stronach skrzyżowania, więc
            pojazd jadący na wprost jest liczony dwa razy. Suma zawyża ruch przez
            węzeł; udziały (%) w podziale modalnym pozostają porównywalne.
          </p>
        ) : (
          <p className="hint">
            Punkt pomiarowy widziany jako całość. Przekroje to różne ulice
            przecinające linię pomiaru, więc ich suma to cały ruch przez tę linię.
          </p>
        )}
        <h4>Profil dobowy — cały punkt</h4>
        <Profile values={total} hours={hours} color={color} />
        <Breakdown title={`Udział przekrojów — ${period}`} obj={bySection} />
        {kind === 'pt' ? (
          <>
            <Breakdown title={`Kierunki (pasażerowie) — ${period}`}
              obj={perPeriod(p.members, 'byHourDir')} />
            <Breakdown title={`Linie (pasażerowie) — ${period}`}
              obj={perPeriod(p.members, 'byHourLine')} />
          </>
        ) : (
          <DirSplit title={`Kierunki przekrojów — ${period} (${unit(kind)})`}
            rows={p.members.map((m) => dirRow(kind, m))} />
        )}
      </>
    )
  } else if (kind === 'road') {
    const sec = data.roadById[p.id]
    const cats = activeCats(metric, people)
    const prof = shape(roadProfile(sec, { cats }, catOrder))
    cardBig = { value: fmt(sumHours(prof, hours)), unit: unit('road') }
    cardProfile = prof
    const keep = cats
      ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0)
      : catOrder.map((_, i) => i)
    const byCat = {}
    if (sec) {
      for (const dd of Object.values(sec.dirs)) {
        for (let h = 0; h < 24; h++) {
          if (!hours.includes(h)) continue
          for (const i of keep) {
            const label = data.meta.vehCats[catOrder[i]] || catOrder[i]
            byCat[label] = (byCat[label] || 0) + shown(dd.h[h][i])
          }
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
          <dt>Data</dt><dd>{p.date}{p.hours ? ` · ${hoursText(p.hours)}` : ''}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(prof, hours))} ${unit('road')}`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {fmt(p.total)} pojazdów, wszystkie kategorie
            {p.window ? ' — tylko 6–10 i 15–19, nie cała doba' : ''}
          </dd>
        </dl>
        <h4>
          Profil dobowy — {people ? 'osoby w samochodach osobowych'
            : ROAD_METRICS[metric].label.toLowerCase()}
        </h4>
        <Profile values={prof} hours={hours} color={color} />
        <DirSplit title={`Kierunki — ${period} (${unit('road')})`} rows={[dirRow('road', p)]} />
        <Breakdown title={`Kategorie pojazdów — ${period}`} obj={byCat} />
        <Breakdown title="Poza jezdnią — rowery i UTO" obj={off} />
      </>
    )
  } else if (kind === 'bike' || kind === 'ped') {
    cardBig = { value: fmt(shown(sumHours(p.byHour, hours))), unit: unit(kind) }
    cardProfile = shape(p.byHour)
    if (GEO_NOTE[p.geo]) cardNotes.push(`Położenie: ${GEO_NOTE[p.geo]}.`)
    body = (
      <>
        <dl>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          {p.where?.length ? <><dt>Miejsce</dt><dd>{p.where.join('; ')}</dd></> : null}
          {p.date ? <><dt>Pomiar</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd></> : null}
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(shown(sumHours(p.byHour, hours)))} ${unit(kind)}`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">{fmt(p.total)}{p.hours ? ` (${p.hours})` : ''}</dd>
        </dl>
        <h4>Profil dobowy</h4>
        <Profile values={shape(p.byHour)} hours={hours} color={color} />
        {p.byHourDir
          ? <DirSplit title={`Kierunki — ${period}`} rows={[dirRow(kind, p)]} />
          : <Breakdown title="Kierunki — cały pomiar" obj={p.byDir} />}
        <Breakdown title="Płeć — cały pomiar" obj={p.bySex} />
        {kind === 'bike' && <Breakdown title="Gdzie jadą — cały pomiar" obj={p.byPlace} />}
        {kind === 'bike' && <Breakdown title="Pojazd — cały pomiar" obj={p.byMode} />}
        {kind === 'bike' && <Breakdown title="Kask — cały pomiar" obj={p.helmet} />}
        {kind === 'ped' && <Breakdown title="Sprawność — cały pomiar" obj={p.byMobility} />}
        {kind === 'ped' && <Breakdown title="Cechy dodatkowe — cały pomiar" obj={p.byMobility2} />}
        {kind === 'ped' && <Breakdown title="Strona ulicy — cały pomiar" obj={p.bySide} />}
      </>
    )
  } else if (kind === 'pt') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    const vehNow = Object.values(p.vehByHour || {}).reduce((a, arr) => a + sumHours(arr, hours), 0)
    // per traction in the period; lines and directions exist only as totals
    const tractionNow = Object.fromEntries(Object.entries(p.vehByHour || {})
      .map(([t, arr]) => [t, sumHours(arr, hours)]))
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('pt') }
    cardProfile = shape(prof)
    body = (
      <>
        <dl>
          <dt>Przystanek</dt><dd>{p.stop || '—'}</dd>
          <dt>Lokalizacja</dt><dd>{p.loc}</dd>
          <dt>Osiedle</dt><dd>{p.osiedle || '—'}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów w ${fmt(vehNow)} pojazdach`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {fmt(p.pax)} pasażerów w {fmt(p.veh)} pojazdach
            {' '}({hourRuns(Array.from({ length: 24 }, (_, h) => h).filter((h) =>
              Object.values(p.vehByHour || {}).some((arr) => arr[h] > 0)))})
          </dd>
          <dt className="whole">Średnie wykorzystanie miejsc</dt>
          <dd className="whole">{pct(p.avgLoad)} — cały pomiar</dd>
          {p.boarded ? (
            <>
              <dt className="whole">Wsiadło / wysiadło</dt>
              <dd className="whole">
                {fmt(p.boarded)} / {fmt(p.alighted)} — cały pomiar, tylko część kursów
              </dd>
            </>
          ) : null}
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={shape(prof)} hours={hours} color={color} />
        <Breakdown title={`Trakcja (liczba pojazdów) — ${period}`} obj={tractionNow} />
        <Breakdown title={`Kierunki (pasażerowie) — ${period}`} obj={perPeriod([p], 'byHourDir')} />
        <Breakdown title={`Linie (pasażerowie) — ${period}`} obj={perPeriod([p], 'byHourLine')} />
        <Breakdown title="Przewoźnicy (liczba pojazdów) — cały pomiar" obj={p.byCarrier} />
      </>
    )
  } else if (kind === 'rail') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('rail') }
    cardProfile = shape(prof)
    body = (
      <>
        <dl>
          <dt>Stacje kordonu</dt><dd>{p.stations.join(', ')}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {Object.entries(p.pax).map(([d, v]) => `${d}: ${fmt(v)}`).join(' · ')}
            {' '}w {p.trains} pociągach
          </dd>
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={shape(prof)} hours={hours} color={color} />
        <Breakdown title={`Kierunek — ${period}`} obj={Object.fromEntries(
          Object.entries(p.byHour).map(([d, arr]) => [d, shown(sumHours(arr, hours))]))} />
        <Breakdown title="Miejsca w pociągach — cały pomiar" obj={p.seats} />
        <Breakdown title="Przewoźnicy (kursy) — cały pomiar" obj={p.carriers} />
      </>
    )
  }

  const pill = kind === 'signal' ? (p.kind === 'crossing' ? 'przejście' : 'skrzyżowanie') : p.id
  const title = p.name || p.stop || p.stations?.join(' / ')
    || p.streets?.join(' × ') || 'sygnalizacja'
  if (scaled) {
    cardNotes.push(`Wartości przeliczone na całą dobę (×${exp.factor}, `
      + `${BASIS_LABEL[exp.basis]}) — pomiar obejmował tylko szczyty.`)
  } else if (!node?.split && coverageGap(data.meta, wk, hours)) {
    cardNotes.push('Pomiar tylko w szczytach — część godzin wybranego okresu nie była mierzona.')
  }
  const split = node?.split && splitTotal(node.split) > 0 ? node.split : null
  const spec = {
    id: pill,
    kicker: `${split ? 'Węzeł pomiarowy' : KICKER[kind] || 'Punkt'} · ${pill}`,
    title,
    subtitle: node?.sub || p.segment || p.loc || '',
    period,
    accent: split ? '#e4572e' : color,
    split, pair: node?.pair, repeats: !!p.repeatsStreet,
    occupancy, occupancyDefault: data.meta.carOccupancy.default,
    occupancyQuote: data.meta.carOccupancy.value, occ: data.transitOcc,
    big: cardBig,
    profile: cardProfile ? { values: cardProfile, hours, color } : null,
    notes: cardNotes,
    source: split
      ? (split.basis === 'transit' ? SOURCE_TEXT.pt
        : `${KBR}: zał. 3.3 (ruch drogowy), zał. 6.4 (potoki pasażerskie), `
          + 'zał. 2.2 do Raportu II (napełnienie samochodów) — bip.um.wroc.pl.')
      : SOURCE_TEXT[kind] || KBR,
  }

  return (
    <div className="details">
      <div className="dhead" style={{ borderColor: color }}>
        <div>
          <span className="pill" style={{ background: color }}>{pill}</span>
          <h3>{title}</h3>
          <ShareButtons spec={spec} />
        </div>
        <button onClick={onClose}>×</button>
      </div>
      <div className="dbody">
        {fam && <SubNav family={fam} shares={shares} onSelect={onSelect} />}
        {part && (
          <div className="part">
            <h4>
              Część węzła {fam.node?.id || fam.parent}
              {' — '}{GROUP_LABEL[part.g.kind].toLowerCase()}
            </h4>
            <p>
              {part.g.kind === 'pt' ? 'Przystanek' : 'Przekrój'}{' '}
              {sectionLetter(fam.current.id) || fam.current.id} to{' '}
              <b>{part.sum ? `${part.share}%` : '—'}</b> tej grupy w okresie {period}:
              {' '}{fmt(part.val)} z {fmt(part.sum)} ({part.unit}).
            </p>
            <PartProfile part={part.profs[part.i]} whole={addProfiles(part.profs)}
              hours={hours} color={LAYERS[part.g.kind].color} />
          </div>
        )}
        {node?.split && <ModalSplit node={node} data={data} occupancy={occupancy} />}
        {body}
        {scaled && (
          <p className="warn">
            Wartości przeliczone na całą dobę (×{exp.factor},{' '}
            {BASIS_LABEL[exp.basis]}). Pomiar obejmował tylko szczyty.
          </p>
        )}
        {p.geo && GEO_NOTE[p.geo] && <p className="geo">📍 {GEO_NOTE[p.geo]}</p>}
      </div>
    </div>
  )
}
