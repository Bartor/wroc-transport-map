import {
  Block, Breakdown, Callout, DetailsPanel, DirectionSplit, Donut, Fact, Facts, Footnote,
  GroupedTable, Hint, Notes, Partial, PieceTree, ShareBars, ShareButtons, SplitBody, SplitTable,
  StatBlock, Warn, cameFrom, fixed, fmt, fmtEst, hourRuns, pct, pieceKey, shade, usePick,
} from '@bartor-net/ui-kit'
import { HourBars, StackedHourBars } from '@bartor-net/ui-kit/charts'
import {
  LAYERS, ROAD_METRICS, roadProfile, profileFor, addProfiles,
  sumHours, sectionLetter, sectionOf,
  activeCats, expand, toPeople, expansionOf, BASIS_LABEL, markerIndex, splitTotal,
  splitVehicles, bikeNote, pedNote, thinText, splitShares, SHARE_ROW, PCU_SOURCE,
  coverageGap, windowKind, transitByMode, MODES, nodeSplit,
} from './data'
import { cardFilename, drawCard } from './shareCard'

const GROUP_LABEL = {
  road: 'Przekroje drogowe',
  pt: 'Przystanki — pomiar pasażerów',
  bike: 'Przekroje rowerowe',
  ped: 'Przekroje piesze',
}

const TREE_LABELS = {
  include: (id) => `Wliczaj ${id} do węzła`,
  last: 'Węzeł musi mieć co najmniej jeden przekrój',
  putBack: 'Wlicz do węzła',
  leaveOut: 'Pomiń w liczbach węzła',
  hint: 'Pominięte części nie wliczają się do sum węzła, podziału modalnego, '
    + 'wielkości koła na mapie ani rankingu.',
}

/**
 * A node is made of pieces: lettered road sections (KW_08A, KW_08B...), and
 * the stops of the transit point paired with it.
 *
 * Each piece shows its share of its own group - road and transit count
 * different things, so they are never summed together. Unticking a piece
 * leaves it out of the node's numbers everywhere: the far approaches of an
 * interchange, say, to look at one junction of it. The node's own group keeps
 * at least one piece, or it would have nothing to stand on; the paired stops
 * only lend their load per vehicle, and can all go.
 */
function NodeTree({ family, shares, onSelect, off, toggleOff, hot, setHot }) {
  const { node, groups, current } = family
  return (
    <PieceTree label="Części węzła" labels={TREE_LABELS}
      root={node && {
        label: `Cały węzeł ${node.id}`,
        onPick: () => onSelect({ kind: node.kind, id: node.id, ref: node.ref }),
      }}
      groups={groups.map((g) => ({
        kind: g.kind, label: GROUP_LABEL[g.kind], color: LAYERS[g.kind].color,
        keepOne: g.kind === node?.kind,
        // transit stops: square and blue
        square: g.kind === 'pt', badge: g.kind === 'pt' ? { bg: '#2b4a5e', on: '#2e86ab' } : null,
        items: g.members.map((m) => {
          const share = shares[pieceKey(g.kind, m.id)]
          return {
            id: m.id, ref: m, letter: sectionLetter(m.id) || '—',
            label: (g.kind === 'road' ? m.name : sectionOf(g.kind, m)) || m.name,
            title: `${m.id} · ${sectionOf(g.kind, m) || m.name}`,
            share: share == null ? null : `${share}%`,
          }
        }),
      }))}
      current={current} off={off} onToggle={toggleOff} hot={hot} setHot={setHot}
      onPick={(g, m) => onSelect({ kind: g.kind, id: m.id, ref: m.ref })} />
  )
}

const TRANSIT_MODES = MODES.filter((m) => m.key === 'bus' || m.key === 'tram')
const perVehicle = (x) => (x.veh ? fixed(x.pax / x.veh) : '—')

/**
 * What a transit point counted, by mode: the vehicles that stopped at its
 * poles, the people in them, and so how full they were - the figure a node
 * borrows. With several poles, each one's own as well, so a node's load can
 * be traced to the poles behind it; left-out ones stay listed, greyed.
 */
function TransitLoads({ title, refs, all, hours, scale = (v) => v }) {
  const tot = transitByMode(refs, hours)
  const poles = all || refs
  const modes = TRANSIT_MODES.filter((m) => poles
    .some((r) => transitByMode([r], hours)[m.key].veh > 0))
  if (!modes.length) return null
  const sum = { veh: tot.bus.veh + tot.tram.veh, pax: tot.bus.pax + tot.tram.pax }
  const cells = (x, share) => [fmt(scale(x.veh)), fmt(scale(x.pax)), perVehicle(x), share]
  return (
    <StatBlock title={title}>
      <SplitTable
        columns={[{ label: 'pojazdy' }, { label: 'pasażerowie' },
          { label: 'os./poj.', tone: 'strong' }, { label: '% pas.' }]}
        rows={[
          ...modes.map((m) => ({
            key: m.key, label: m.label, color: m.color,
            cells: cells(tot[m.key], sum.pax ? Math.round((100 * tot[m.key].pax) / sum.pax) : '—'),
          })),
          ...(modes.length > 1
            ? [{ key: 'sum', label: 'Razem', sum: true, cells: cells(sum, 100) }] : []),
        ]} />
      {poles.length > 1 && (
        <GroupedTable corner="słupki"
          groups={modes.map((m) => ({
            key: m.key, label: m.label.toLowerCase(), color: m.color,
            columns: [{ label: 'poj.' }, { label: 'os./poj.', tone: 'strong' }],
          }))}
          rows={poles.map((r) => {
            const t = transitByMode([r], hours)
            const out = !refs.includes(r)
            return {
              key: r.id, out,
              head: (
                <>
                  <b>{sectionLetter(r.id) || r.id}</b> {sectionOf('pt', r) || r.loc}
                  {out && <Partial> — pominięty</Partial>}
                </>
              ),
              cells: modes.map((m) => (t[m.key].veh
                ? [fmt(scale(t[m.key].veh)), perVehicle(t[m.key])] : ['—', ''])),
            }
          })} />
      )}
    </StatBlock>
  )
}

// the ETL's lists close with the remainder, "inne"
const Parts = (props) => <Breakdown rest="inne" {...props} />

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

// The survey writes a round-the-clock count as "00:00-00:00".
const hoursText = (s) => (/^0?0:00\s*-\s*0?0:00$/.test(s.trim()) ? 'całą dobę' : s)

/** Modal split of a node, in people, with the vehicles it came from. */
function ModalSplit({ node, data, occupancy }) {
  const { split } = node
  const total = splitTotal(split)
  // each mode's share of the vehicles beside its share of the people: a car
  // is most of the traffic and a smaller part of who travels
  const vehTotal = splitVehicles(split)
  const rows = split.slices.filter((s) => s.persons > 0 || s.vehicles > 0)
  const shareRows = splitShares(split)
  const span = split.hours.length ? `${split.hours.length} godz. (${hourRuns(split.hours)})` : 'brak'
  // the stop survey's load applied beyond the hours it was measured in
  const beyond = (split.loadHours || []).length
    && split.hours.some((h) => !split.loadHours.includes(h))
  const occ = data.transitOcc
  // Modes can be picked; the donut, the table and the bars all follow, and the
  // bars sum the picked shares - buses and trams together are the whole of
  // public transport.
  const pick = usePick()
  return (
    <Block>
      <h4>
        Podział modalny — osoby
        {node.piece && ` · ${node.piece.kind === 'pt' ? 'przystanek' : 'przekrój'} `
          + `${sectionLetter(node.piece.id) || node.piece.id}`}
      </h4>
      {!total ? (
        <Hint>
          Brak danych w wybranym okresie
          {split.basis === 'transit' ? ' — pasażerów liczono tylko 5–9 i 14–18.' : '.'}
        </Hint>
      ) : (
        <>
          <SplitBody>
            <Donut pick={pick} label="Podział modalny — osoby"
              rows={rows.map((s) => ({ ...s, value: s.persons }))} />
            <SplitTable pick={pick}
              columns={[{ label: 'osoby' }, { label: '% osób', tone: 'strong' },
                ...(vehTotal > 0
                  ? [{ label: 'pojazdy', tone: 'dim' }, { label: '% poj.', tone: 'dim' }] : [])]}
              rows={[...rows].sort((a, b) => b.persons - a.persons).map((s) => ({
                key: s.key, label: s.label, color: s.color,
                cells: [
                  s.est ? fmtEst(s.persons) : fmt(s.persons),
                  Math.round((100 * s.persons) / total),
                  s.vehicles == null ? '' : fmt(s.vehicles),
                  s.vehicles == null ? '' : Math.round((100 * s.vehicles) / vehTotal),
                ],
              }))} />
          </SplitBody>
          <Hint>Liczone dla {span}.</Hint>
          {shareRows && (
            <ShareBars pick={pick} fallback={['car']} label="Udziały środków transportu"
              rows={shareRows.map((r) => ({ ...r, label: SHARE_ROW[r.key] }))}>
              <Hint>
                Liczba po prawej: samochody osobowe albo suma środków zaznaczonych na
                wykresie lub w tabeli — np. autobusy z tramwajami to cała komunikacja
                zbiorowa. Przepustowość w pojazdach
                umownych — {PCU_SOURCE}: rower 0,3, samochód 1, dostawczy 1,5,
                ciężarowy 2,5–3, autobus 2,5, tramwaj 3. To miara zajęcia przepustowości,
                nie powierzchni; tramwaj liczony jak na jezdni, także gdy ma własne torowisko.
              </Hint>
            </ShareBars>
          )}
        </>
      )}
      <Notes>
        {split.basis === 'measured' && (
          <li>
            Autobusy i tramwaje: pojazdy policzone na przekrojach drogowych ×
            średnie napełnienie ze wszystkich zaznaczonych słupków punktu KZ{' '}
            <b>{node.pair.title}</b> ({node.pair.dist} m stąd): autobus {split.load.bus.toFixed(1)}
            {split.local.bus ? '' : ' (średnia miejska)'}, tramwaj{' '}
            {split.load.tram.toFixed(1)}{split.local.tram ? '' : ' (średnia miejska)'}{' '}
            os./poj., zmierzone w godzinach {hourRuns(split.loadHours)}
            {beyond ? ' i przyjęte także dla pozostałych godzin okresu — poza nimi to założenie' : ''}.
            {thinText(split) && ` Średnia miejska tam, gdzie próba była za mała (${thinText(split)}).`}
            {' '}Surowej liczby pasażerów z punktu KZ nie dodajemy, bo jego słupki
            stoją też przy innych ulicach i kierunkach niż przekroje drogowe —
            tabela poniżej pokazuje każdy słupek; te, które nie pasują do
            wybranych przekrojów, można odznaczyć w drzewie.
          </li>
        )}
        {split.basis === 'estimate' && (
          <li>
            Autobusy i tramwaje:{' '}
            {!node.pair ? 'brak punktu pomiaru KZ w promieniu 150 m, więc'
              : !node.pair.refs.length ? `przystanki punktu KZ ${node.pair.title} są pominięte, więc`
              : thinText(split) ? `w punkcie KZ ${node.pair.title} próba była za mała `
                + `(${thinText(split)}), więc`
                : `punkt KZ ${node.pair.title} nie zarejestrował autobusów ani tramwajów, więc`}
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
            {bikeNote(data, node, split) && <li>{bikeNote(data, node, split)}</li>}
            <li>{pedNote(data, node, split)}</li>
          </>
        )}
        {split.basis === 'transit' && (
          <li>
            {node.piece?.kind === 'pt'
              ? 'Tylko ten przystanek: pasażerowie autobusów i tramwajów zmierzeni na jego słupku.'
              : 'Węzeł bez przekroju drogowego w promieniu 150 m — widać tylko podział '
                + 'między autobus i tramwaj.'}
          </li>
        )}
      </Notes>
      {node.pair && split.basis !== 'transit' && split.loadHours?.length > 0 && (
        <TransitLoads refs={node.pair.refs} all={node.pair.all} hours={split.loadHours}
          title={`Słupki punktu KZ ${node.pair.id} — ${hourRuns(split.loadHours)}`} />
      )}
    </Block>
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
  markers, family, onSelect, onClose, off, toggleOff, hot, setHot,
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
        key: cameFrom(d), v: shown(sumHours(arr, hours), k),
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
  const now = (text) => (covered.length ? (
    <Fact label={`W okresie ${period}`} tone="now">
      {text}
      {!scaled && covered.length < hours.length && (
        <Partial> — zmierzono {covered.length} z {hours.length} godz.</Partial>
      )}
    </Fact>
  ) : <Fact label={`W okresie ${period}`} tone="gap">brak pomiaru w tym okresie</Fact>)
  const dirRow = (k, m) => ({
    kind: k, id: m.id,
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
    // pieces left out of the node are not part of what the shares divide
    const isIn = g.members.map((m) => !fam.node || !off?.has(pieceKey(g.kind, m.id)))
    const sum = vals.reduce((x, y, j) => x + (isIn[j] ? y : 0), 0)
    g.members.forEach((m, j) => {
      shares[pieceKey(g.kind, m.id)] = sum && isIn[j] ? Math.round((100 * vals[j]) / sum) : null
    })
    const i = fam.current?.kind === g.kind
      ? g.members.findIndex((m) => m.id === fam.current.id) : -1
    if (i >= 0) {
      part = {
        g, i, val: vals[i], sum, share: shares[pieceKey(g.kind, g.members[i].id)],
        out: !isIn[i],
        unit: g.kind === 'road' && allVehicles ? 'pojazdów, wszystkie kategorie' : unit(g.kind),
      }
    }
  }

  // The node's pie stays in its place with a piece open, drawn for that piece
  // alone: a road section with the node's stop loads, a stop as its own
  // buses and trams.
  const occ = occupancy ?? data.meta.carOccupancy.default
  let splitNode = node?.split ? node : null
  if (!splitNode && fam?.node?.split && fam.current && (kind === 'road' || kind === 'pt')) {
    const split = kind === 'road'
      ? nodeSplit(data, { roadIds: [p.id], ptRefs: fam.node.pair?.refs ?? null, hours, occupancy: occ })
      : nodeSplit(data, { roadIds: [], ptRefs: [p], hours, occupancy: occ })
    splitNode = { ...fam.node, id: p.id, ref: p, split, piece: { kind, id: p.id } }
  }

  // The hourly profile, stacked by the node's pieces of this kind where it
  // has several - the same chart for the node and for each piece, the open
  // piece lit. Left-out pieces drop out of the stack unless one is open.
  const stackGroup = fam?.groups.find((g) => g.kind === kind && g.members.length > 1)
  const stack = stackGroup && stackGroup.members
    .filter((m) => !fam.node || !off?.has(pieceKey(kind, m.id)) || m.id === fam.current?.id)
    .map((m, i) => ({
      id: m.id, ref: m, letter: sectionLetter(m.id) || m.id,
      name: (kind === 'road' ? m.name : sectionOf(kind, m)) || m.name,
      values: shape(profileFor(data, kind, m, metric, people)),
      fill: shade(color, i),
      out: !!fam.node && !!off?.has(pieceKey(kind, m.id)),
    }))
  const chart = (values) => (stack ? (
    <StackedHourBars kind={kind} pieces={stack} hours={hours} unit={unit(kind)}
      current={fam.current?.kind === kind ? fam.current.id : null}
      hot={hot} setHot={setHot} onPick={(s) => onSelect({ kind, id: s.id, ref: s.ref })} />
  ) : <HourBars values={values} hours={hours} color={color} unit={unit(kind)} />)
  // a piece's chart is its whole point, so the heading says which is lit
  const chartFor = (what) => (stack && fam.current
    ? `Profil dobowy — ${what}: punkt ${fam.node?.id || fam.parent}, `
      + `${sectionLetter(fam.current.id) || fam.current.id} wyróżniony`
    : `Profil dobowy — ${what}`)

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
        <Facts>
          <Fact label="Rodzaj">{p.kind === 'crossing'
            ? 'samodzielne przejście dla pieszych z sygnalizacją'
            : `skrzyżowanie, ${p.arms} wloty`}</Fact>
          <Fact label="Ulice">{p.streets.join(', ') || '—'}</Fact>
          <Fact label="Klasa">{p.c}{p.minor ? ' · same ulice lokalne' : ''}</Fact>
          <Fact label="Sygnalizatorów">{p.n}</Fact>
          <Fact label={`Ruch (model, ${period})`}>{fmtEst(p.v * (share ?? 1))} poj.</Fact>
          <Fact label="Komunikacja zbiorowa">{p.runs ? `${fmt(p.runs)} kursów w oknie 6–10 i 15–19` : 'brak'}
            {p.tram ? ' · w tym tramwaj' : ''}</Fact>
          {p.near && (
            <Fact label="Najbliższy pomiar">
              ruch {p.near.kind}: {p.near.id}, {fmt(p.near.total)} os.,
              {' '}{p.near.dist} m stąd
            </Fact>
          )}
        </Facts>
        {p.minor && !p.tram && p.kind === 'junction' && (
          <Warn>
            Wszystkie wloty to ulice lokalne i nie jeździ tędy tramwaj — warto
            sprawdzić, czy sygnalizacja jest tu potrzebna.
          </Warn>
        )}
        <Hint>
          Natężenie pochodzi z modelu (mediana błędu 24%), nie z pomiaru.
          O możliwości wyłączenia sygnalizacji decydują też widoczność,
          przejścia dla pieszych, priorytet tramwaju i historia zdarzeń.
        </Hint>
      </>
    )
  } else if (p.aggregate) {
    const profs = p.members.map((m) => shape(profileFor(data, kind, m, metric, people)))
    // transit: the share of passengers seen twice, at two poles of the point
    const ptTot = kind === 'pt' ? transitByMode(p.members, hours) : null
    const ptRepeat = ptTot && ptTot.bus.pax + ptTot.tram.pax > 0
      ? ptTot.repeat / (ptTot.bus.pax + ptTot.tram.pax) : 0
    const total = addProfiles(profs)
    cardBig = { value: fmt(sumHours(total, hours)), unit: unit(kind) }
    cardProfile = total
    // a split card says it in the split's own notes
    if (p.repeatsStreet && !node?.split) {
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
        <Facts>
          <Fact label="Przekroje">
            {p.members.map((m) => m.id).join(', ')}
            {p.all.length > p.members.length && (
              <Partial>
                {' '}— pominięte: {p.all.filter((m) => !p.members.includes(m))
                  .map((m) => m.id).join(', ')}
              </Partial>
            )}
          </Fact>
          {now(node?.split && splitTotal(node.split) > 0
            ? `${fmtEst(splitTotal(node.split))} osób — wszystkie środki`
            : `${fmt(sumHours(total, hours))} ${unit(kind)}`)}
          {node?.split && splitTotal(node.split) > 0 && (
            <Fact label="w tym ruch drogowy" tone="whole">{fmt(sumHours(total, hours))} {unit(kind)}</Fact>
          )}
          <Fact label="Cały pomiar" tone="whole">{fmt(total.reduce((a, b) => a + b, 0))} {unit(kind)}</Fact>
        </Facts>
        {kind === 'pt' ? (
          <Hint>
            Punkt KZ jako całość: pasażerowie w pojazdach, które zatrzymały się
            na badanych słupkach, zsumowani po słupkach. Słupki stoją przy
            różnych ulicach i w różnych kierunkach, więc ta suma nie odpowiada
            przekrojom drogowym pobliskiego węzła.
            {ptRepeat >= 0.01 && ` Ok. ${Math.round(ptRepeat * 100)}% to pasażerowie pojazdów `
              + 'widzianych na dwóch słupkach tego punktu — liczeni dwa razy.'}
          </Hint>
        ) : p.repeatsStreet ? (
          <Warn>
            Przekroje leżą na tej samej ulicy po obu stronach skrzyżowania, więc
            pojazd jadący na wprost jest liczony dwa razy. Suma zawyża ruch przez
            węzeł; udziały (%) w podziale modalnym pozostają porównywalne.
          </Warn>
        ) : (
          <Hint>
            Punkt pomiarowy widziany jako całość. Przekroje to różne ulice
            przecinające linię pomiaru, więc ich suma to cały ruch przez tę linię.
          </Hint>
        )}
        <h4>Profil dobowy — cały punkt{stack ? ' po częściach' : ''}</h4>
        {chart(total)}
        <Parts title={`Udział przekrojów — ${period}`} parts={bySection} />
        {kind === 'pt' ? (
          <>
            <TransitLoads refs={p.members} hours={hours} scale={(v) => shown(v, 'pt')}
              title={`Pojazdy i napełnienie — ${period}`} />
            <Parts title={`Kierunki (pasażerowie) — ${period}`}
              parts={perPeriod(p.members, 'byHourDir')} />
            <Parts title={`Linie (pasażerowie) — ${period}`}
              parts={perPeriod(p.members, 'byHourLine')} />
          </>
        ) : (
          <DirectionSplit title={`Kierunki przekrojów — ${period} (${unit(kind)})`}
            rows={p.members.map((m) => dirRow(kind, m))} hot={hot} setHot={setHot} />
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
        <Facts>
          <Fact label="Obszar">{p.area}</Fact>
          <Fact label="Odcinek">{p.segment}</Fact>
          <Fact label="Miejsce pomiaru">{p.where}</Fact>
          <Fact label="Data">{p.date}{p.hours ? ` · ${hoursText(p.hours)}` : ''}</Fact>
          {now(`${fmt(sumHours(prof, hours))} ${unit('road')}`)}
          <Fact label="Cały pomiar" tone="whole">
            {fmt(p.total)} pojazdów, wszystkie kategorie
            {p.window ? ' — tylko 6–10 i 15–19, nie cała doba' : ''}
          </Fact>
        </Facts>
        <h4>
          {chartFor(people ? 'osoby w samochodach osobowych'
            : ROAD_METRICS[metric].label.toLowerCase())}
        </h4>
        {chart(prof)}
        <DirectionSplit title={`Kierunki — ${period} (${unit('road')})`} rows={[dirRow('road', p)]}
          hot={hot} setHot={setHot} />
        <Parts title={`Kategorie pojazdów — ${period}`} parts={byCat} />
        <Parts title="Poza jezdnią — rowery i UTO" parts={off} />
      </>
    )
  } else if (kind === 'bike' || kind === 'ped') {
    cardBig = { value: fmt(shown(sumHours(p.byHour, hours))), unit: unit(kind) }
    cardProfile = shape(p.byHour)
    if (GEO_NOTE[p.geo]) cardNotes.push(`Położenie: ${GEO_NOTE[p.geo]}.`)
    body = (
      <>
        <Facts>
          <Fact label="Odcinek">{p.segment}</Fact>
          {p.where?.length ? <Fact label="Miejsce">{p.where.join('; ')}</Fact> : null}
          {p.date ? <Fact label="Pomiar">{p.date}{p.hours ? ` · ${p.hours}` : ''}</Fact> : null}
          {now(`${fmt(shown(sumHours(p.byHour, hours)))} ${unit(kind)}`)}
          <Fact label="Cały pomiar" tone="whole">{fmt(p.total)}{p.hours ? ` (${p.hours})` : ''}</Fact>
        </Facts>
        <h4>{chartFor(unit(kind))}</h4>
        {chart(shape(p.byHour))}
        {p.byHourDir
          ? <DirectionSplit title={`Kierunki — ${period}`} rows={[dirRow(kind, p)]}
            hot={hot} setHot={setHot} />
          : <Parts title="Kierunki — cały pomiar" parts={p.byDir} />}
        <Parts title="Płeć — cały pomiar" parts={p.bySex} />
        {kind === 'bike' && <Parts title="Gdzie jadą — cały pomiar" parts={p.byPlace} />}
        {kind === 'bike' && <Parts title="Pojazd — cały pomiar" parts={p.byMode} />}
        {kind === 'bike' && <Parts title="Kask — cały pomiar" parts={p.helmet} />}
        {kind === 'ped' && <Parts title="Sprawność — cały pomiar" parts={p.byMobility} />}
        {kind === 'ped' && <Parts title="Cechy dodatkowe — cały pomiar" parts={p.byMobility2} />}
        {kind === 'ped' && <Parts title="Strona ulicy — cały pomiar" parts={p.bySide} />}
      </>
    )
  } else if (kind === 'pt') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    const vehNow = Object.values(p.vehByHour || {}).reduce((a, arr) => a + sumHours(arr, hours), 0)
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('pt') }
    cardProfile = shape(prof)
    body = (
      <>
        <Facts>
          <Fact label="Przystanek">{p.stop || '—'}</Fact>
          <Fact label="Lokalizacja">{p.loc}</Fact>
          <Fact label="Osiedle">{p.osiedle || '—'}</Fact>
          <Fact label="Pomiar">{p.dates.join(', ')}</Fact>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów w ${fmt(vehNow)} pojazdach`)}
          <Fact label="Cały pomiar" tone="whole">
            {fmt(p.pax)} pasażerów w {fmt(p.veh)} pojazdach
            {' '}({hourRuns(Array.from({ length: 24 }, (_, h) => h).filter((h) =>
              Object.values(p.vehByHour || {}).some((arr) => arr[h] > 0)))})
          </Fact>
          <Fact label="Średnie wykorzystanie miejsc" tone="whole">{pct(p.avgLoad)} — cały pomiar</Fact>
          {p.boarded ? (
            <Fact label="Wsiadło / wysiadło" tone="whole">
              {fmt(p.boarded)} / {fmt(p.alighted)} — cały pomiar, tylko część kursów
            </Fact>
          ) : null}
        </Facts>
        <h4>{chartFor('pasażerowie')}</h4>
        {chart(shape(prof))}
        <TransitLoads refs={[p]} hours={hours} scale={(v) => shown(v, 'pt')}
          title={`Pojazdy i napełnienie — ${period}`} />
        <Parts title={`Kierunki (pasażerowie) — ${period}`} parts={perPeriod([p], 'byHourDir')} />
        <Parts title={`Linie (pasażerowie) — ${period}`} parts={perPeriod([p], 'byHourLine')} />
        <Parts title="Przewoźnicy (liczba pojazdów) — cały pomiar" parts={p.byCarrier} />
      </>
    )
  } else if (kind === 'rail') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('rail') }
    cardProfile = shape(prof)
    body = (
      <>
        <Facts>
          <Fact label="Stacje kordonu">{p.stations.join(', ')}</Fact>
          <Fact label="Pomiar">{p.dates.join(', ')}</Fact>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów`)}
          <Fact label="Cały pomiar" tone="whole">
            {Object.entries(p.pax).map(([d, v]) => `${d}: ${fmt(v)}`).join(' · ')}
            {' '}w {p.trains} pociągach
          </Fact>
        </Facts>
        <h4>Profil dobowy — pasażerowie</h4>
        <HourBars values={shape(prof)} hours={hours} color={color} unit={unit(kind)} />
        <Parts title={`Kierunek — ${period}`} parts={Object.fromEntries(
          Object.entries(p.byHour).map(([d, arr]) => [d, shown(sumHours(arr, hours))]))} />
        <Parts title="Miejsca w pociągach — cały pomiar" parts={p.seats} />
        <Parts title="Przewoźnicy (kursy) — cały pomiar" parts={p.carriers} />
      </>
    )
  }

  const pill = kind === 'signal' ? (p.kind === 'crossing' ? 'przejście' : 'skrzyżowanie') : p.id
  const title = p.name || p.stop || p.stations?.join(' / ')
    || p.streets?.join(' × ') || 'sygnalizacja'
  // where the survey's own description is wrong
  if (p.correction) cardNotes.push(p.correction)
  if (scaled) {
    cardNotes.push(`Wartości przeliczone na całą dobę (×${exp.factor}, `
      + `${BASIS_LABEL[exp.basis]}) — pomiar obejmował tylko szczyty.`)
  } else if (!node?.split && coverageGap(data.meta, wk, hours)) {
    cardNotes.push('Pomiar tylko w szczytach — część godzin wybranego okresu nie była mierzona.')
  }
  const split = splitNode && splitTotal(splitNode.split) > 0 ? splitNode.split : null
  const spec = {
    id: pill,
    kicker: `${split && !splitNode.piece ? 'Węzeł pomiarowy' : KICKER[kind] || 'Punkt'} · ${pill}`,
    title,
    subtitle: node?.sub || p.segment || p.loc || '',
    period,
    accent: split ? '#e4572e' : color,
    split, pair: splitNode?.pair, repeats: !!p.repeatsStreet,
    bikeNote: split && split.basis !== 'transit' ? bikeNote(data, splitNode, split) : null,
    pedNote: split && split.basis !== 'transit' ? pedNote(data, splitNode, split) : null,
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
    <DetailsPanel pill={pill} title={title} color={color} onClose={onClose}
      actions={(
        <ShareButtons render={() => drawCard(spec)} filename={cardFilename(spec)}
          title={spec.title} text={`KBR Wrocław 2024 — ${spec.title}`} />
      )}>
      {fam && (
        <NodeTree family={fam} shares={shares} onSelect={onSelect}
          off={off} toggleOff={toggleOff} hot={hot} setHot={setHot} />
      )}
      {splitNode && (
        <ModalSplit key={splitNode.id} node={splitNode} data={data} occupancy={occ} />
      )}
      {part && (
        <Callout title={`Część węzła ${fam.node?.id || fam.parent}`
          + ` — ${GROUP_LABEL[part.g.kind].toLowerCase()}`}>
          {part.out ? (
            <p>
              {part.g.kind === 'pt' ? 'Przystanek' : 'Przekrój'}{' '}
              {sectionLetter(fam.current.id) || fam.current.id} jest{' '}
              <b>pominięty</b> w liczbach węzła. W okresie {period}:{' '}
              {fmt(part.val)} ({part.unit}), wobec {fmt(part.sum)} w pozostałej części grupy.
            </p>
          ) : (
            <p>
              {part.g.kind === 'pt' ? 'Przystanek' : 'Przekrój'}{' '}
              {sectionLetter(fam.current.id) || fam.current.id} to{' '}
              <b>{part.sum ? `${part.share}%` : '—'}</b> tej grupy w okresie {period}:
              {' '}{fmt(part.val)} z {fmt(part.sum)} ({part.unit}).
            </p>
          )}
        </Callout>
      )}
      {p.correction && <Warn>{p.correction}</Warn>}
      {body}
      {scaled && (
        <Warn>
          Wartości przeliczone na całą dobę (×{exp.factor},{' '}
          {BASIS_LABEL[exp.basis]}). Pomiar obejmował tylko szczyty.
        </Warn>
      )}
      {p.geo && GEO_NOTE[p.geo] && <Footnote>📍 {GEO_NOTE[p.geo]}</Footnote>}
    </DetailsPanel>
  )
}
