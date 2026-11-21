import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import {
  LAYERS, ROAD_METRICS, roadProfile, profileFor, addProfiles, fmt, pct,
  HOUR_LABEL, sumHours, parentOf, sectionLetter, sectionOf, fmtEst,
  activeCats, expand, toPeople, expansionOf, BASIS_LABEL, markerIndex, splitTotal,
  HOUR_LABEL as HL, coverageGap,
} from './data'
import { copyCard, downloadCard } from './shareCard'

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
  return (
    <div className="share">
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

/** Modal split of a node, in people, with the vehicles it came from. */
function ModalSplit({ node, data, occupancy }) {
  const { split } = node
  const total = splitTotal(split)
  const rows = split.slices.filter((s) => s.persons > 0 || s.vehicles > 0)
  const hrs = [...split.hours].sort((a, b) => a - b)
  const span = hrs.length
    ? `${hrs.length} godz. (${HL(hrs[0])}–${HL((hrs.at(-1) + 1) % 24)})`
    : 'brak'
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
            os./poj. Tylko godziny objęte oboma pomiarami. Surowej liczby
            pasażerów z punktu KZ nie dodajemy, bo obejmuje on inne słupki
            i wloty niż przekroje drogowe.
          </li>
        )}
        {split.basis === 'estimate' && (
          <li>
            Autobusy i tramwaje: brak punktu pomiaru KZ w promieniu 150 m, więc
            liczba pojazdów × średnie napełnienie z pomiarów KBR (autobus{' '}
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
  markers, onSelect, onClose,
}) {
  const { kind, ref: p } = sel
  // The drawn node carries the modal split and its transit partner, if any.
  const node = markers ? markerIndex(markers)[`${kind}:${sel.id}`] : null
  const color = LAYERS[kind]?.color || '#f4a261'
  const catOrder = data.meta.vehCatOrder

  // The map applies the whole-day expansion and the vehicles-to-people
  // conversion before drawing. This panel has to apply exactly the same pair,
  // or the number here contradicts the marker that was clicked to open it.
  const shown = (v, k = kind) =>
    toPeople(expand(data.meta, k, v, wholeDay), k, occupancy, people)
  const shape = (arr, k = kind) => arr.map((v) => shown(v, k))
  const exp = expansionOf(data.meta, kind)
  const scaled = wholeDay && exp?.factor > 1
  const unit = (k) => (k === 'road'
    ? (people ? 'osób w samochodach osobowych' : `pojazdów — ${ROAD_METRICS[metric].label.toLowerCase()}`)
    : unitOf(k))

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
          <dt>Suma w okresie {period}</dt><dd>{fmt(sumHours(total, hours))}</dd>
          <dt>Suma dobowa</dt><dd>{fmt(total.reduce((a, b) => a + b, 0))}</dd>
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
    const cats = activeCats(metric, people)
    const prof = shape(roadProfile(sec, { cats }, catOrder))
    cardBig = { value: fmt(sumHours(prof, hours)), unit: unit('road') }
    cardProfile = prof
    const keep = cats
      ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0)
      : catOrder.map((_, i) => i)
    const byCat = {}
    const byDir = {}
    if (sec) {
      for (const [d, dd] of Object.entries(sec.dirs)) {
        byDir[d.replace('>', ' → ')] = shown(
          hours.reduce((a, h) => a + keep.reduce((x, i) => x + dd.h[h][i], 0), 0))
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
          <dt>Data</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd>
          <dt>Suma dobowa</dt>
          <dd>{fmt(p.total)} pojazdów — pomiar, wszystkie kategorie</dd>
        </dl>
        <h4>
          Profil dobowy — {people ? 'osoby w samochodach osobowych'
            : ROAD_METRICS[metric].label.toLowerCase()}
        </h4>
        <Profile values={prof} hours={hours} color={color} />
        <Breakdown title={`Kierunki — ${period}`} obj={byDir} />
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
          <dt>Łącznie</dt><dd>{fmt(p.total)} — pomiar</dd>
          <dt>W okresie {period}</dt>
          <dd>{fmt(shown(sumHours(p.byHour, hours)))}</dd>
        </dl>
        <h4>Profil dobowy</h4>
        <Profile values={shape(p.byHour)} hours={hours} color={color} />
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
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('pt') }
    cardProfile = shape(prof)
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
        <Profile values={shape(prof)} hours={hours} color={color} />
        <Breakdown title="Trakcja (liczba pojazdów)" obj={p.byTraction} />
        <Breakdown title="Linie (pasażerowie)" obj={p.byLine} />
        <Breakdown title="Kierunki (pasażerowie)" obj={p.byDir} />
        <Breakdown title="Przewoźnicy (liczba pojazdów)" obj={p.byCarrier} />
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
          <dt>Pociągi</dt><dd>{p.trains}</dd>
          <dt>Pasażerowie</dt>
          <dd>{Object.entries(p.pax).map(([d, v]) => `${d}: ${fmt(v)}`).join(' · ')}</dd>
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={shape(prof)} hours={hours} color={color} />
        <Breakdown title="Kierunek" obj={p.pax} />
        <Breakdown title="Miejsca w pociągach" obj={p.seats} />
        <Breakdown title="Przewoźnicy (kursy)" obj={p.carriers} />
      </>
    )
  }

  const pill = kind === 'signal' ? (p.kind === 'crossing' ? 'przejście' : 'skrzyżowanie') : p.id
  const title = p.name || p.stop || p.stations?.join(' / ')
    || p.streets?.join(' × ') || 'sygnalizacja'
  if (scaled) {
    cardNotes.push(`Wartości przeliczone na całą dobę (×${exp.factor}, `
      + `${BASIS_LABEL[exp.basis]}) — pomiar obejmował tylko szczyty.`)
  } else if (!node?.split && coverageGap(data.meta, kind, hours)) {
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
    occupancy, occupancyDefault: data.meta.carOccupancy.default, occ: data.transitOcc,
    big: cardBig,
    profile: cardProfile ? { values: cardProfile, hours, color } : null,
    notes: cardNotes,
    source: split
      ? (split.basis === 'transit' ? SOURCE_TEXT.pt
        : `${KBR}: zał. 3.3 (ruch drogowy) i zał. 6.4 (potoki pasażerskie).`)
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
        {node?.split && <ModalSplit node={node} data={data} occupancy={occupancy} />}
        {body}
        {!p.aggregate && (
          <Sections data={data} kind={kind} p={p} onSelect={onSelect} />
        )}
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
