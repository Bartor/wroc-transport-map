// Loading and reshaping of the ETL output. Everything is small enough to keep
// in memory (~1.2 MB total), so the map filters client-side.

const FILES = ['meta', 'points', 'road', 'pt', 'bike', 'ped', 'rail',
  'network', 'network_modes']

// survey.json is absent from the public build (household addresses), so it is
// optional like the model layers that only exist when they validated.
const OPTIONAL = ['network_pt', 'network_service', 'signals', 'survey']

export async function loadAll() {
  const parts = await Promise.all(
    FILES.map((f) => fetch(`data/${f}.json`).then((r) => {
      if (!r.ok) throw new Error(`data/${f}.json missing — run: npm run etl`)
      return r.json()
    })),
  )
  const d = Object.fromEntries(FILES.map((f, i) => [f, parts[i]]))
  const opt = await Promise.all(OPTIONAL.map((f) =>
    fetch(`data/${f}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
  OPTIONAL.forEach((f, i) => { d[f] = opt[i] })
  d.roadById = d.road.sections
  d.transitOcc = transitOccupancy(d.pt)
  d.roadCoverage = roadCoverage(d.road)
  return d
}

// Units are plain nouns: every map value is a sum over the selected period,
// never a rate, so the period is spelled out next to it instead.
export const LAYERS = {
  road: { label: 'Ruch drogowy', color: '#e4572e', unit: 'poj.' },
  pt: { label: 'Autobusy i tramwaje', color: '#2e86ab', unit: 'pasażerów' },
  bike: { label: 'Ruch rowerowy', color: '#3fa34d', unit: 'rowerzystów' },
  ped: { label: 'Ruch pieszy', color: '#b5179e', unit: 'pieszych' },
  rail: { label: 'Pociągi (kordon miasta)', color: '#7048e8', unit: 'pasażerów' },
  survey: { label: 'Adresy z próby ankietowej', color: '#8d99ae', unit: 'adresów' },
}

// What the map shows: one survey at a time. The layers come from separate
// surveys with their own units, hours and coverage - vehicles on road
// cross-sections, passengers at a sample of stops, cyclists and pedestrians in
// the peaks, trains at the city boundary - so their sizes are not comparable
// and they are not drawn together. The node view is the one place they meet,
// on purpose and in one unit: people, from the road counts plus the transit
// survey's load per vehicle.
export const VIEWS = {
  nodes: {
    label: 'Węzły — podział modalny',
    sub: 'osoby przez węzeł: ruch drogowy z napełnieniem pojazdów',
    layers: ['road', 'pt'], split: true, color: '#e4572e',
  },
  road: {
    label: 'Pomiary drogowe',
    sub: 'pojazdy liczone na przekrojach (zał. 3.3)',
    layers: ['road'], color: LAYERS.road.color,
  },
  pt: {
    label: 'Potoki pasażerskie',
    sub: 'pasażerowie na badanych przystankach (zał. 6.4)',
    layers: ['pt'], color: LAYERS.pt.color,
  },
  active: {
    label: 'Rowery i piesi',
    sub: 'liczeni w szczytach 6–10 i 15–19 (zał. 3.4, 3.5)',
    layers: ['bike', 'ped'], color: LAYERS.bike.color,
  },
  rail: {
    label: 'Pociągi — kordon kolejowy',
    sub: 'pasażerowie w pociągach na granicy miasta (zał. 7.1)',
    layers: ['rail'], color: LAYERS.rail.color,
  },
}

/** The view that shows a given layer best, for search results outside the
 *  current one. */
export const viewOf = (kind, current) => (VIEWS[current]?.layers.includes(kind) ? current
  : { road: 'road', pt: 'pt', bike: 'active', ped: 'active', rail: 'rail' }[kind] || current)

// A period is a range of hour boundaries [from, to), 0..24. from > to wraps
// over midnight. The presets are just named ranges on the same control.
export const PRESETS = {
  day: { label: 'Cała doba', range: [0, 24] },
  am: { label: 'Szczyt poranny 7–9', range: [7, 9] },
  pm: { label: 'Szczyt popołudniowy 15–17', range: [15, 17] },
  midday: { label: 'Międzyszczyt 10–14', range: [10, 14] },
  night: { label: 'Noc 22–6', range: [22, 6] },
}

export function hoursOf([from, to]) {
  const out = []
  if (from < to) for (let h = from; h < to; h++) out.push(h)
  else {
    for (let h = from; h < 24; h++) out.push(h)
    for (let h = 0; h < to; h++) out.push(h)
  }
  return out
}

export const sameRange = (a, b) => a[0] === b[0] && a[1] === b[1]

/** Road counts per hour: the share of cross-sections with any count. Most ran
 *  5-21, some round the clock, so night hours rest on a fifth of the sites. */
function roadCoverage(road) {
  const secs = Object.values(road.sections)
  return Array.from({ length: 24 }, (_, h) => secs.filter((s) =>
    Object.values(s.dirs).some((d) => (d.h[h] || []).some((v) => v > 0))).length / secs.length)
}

// Road metric = which vehicle categories to count.
export const ROAD_METRICS = {
  all: { label: 'Wszystkie pojazdy', cats: null },
  motor: { label: 'Pojazdy silnikowe', cats: ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l'] },
  car: { label: 'Samochody osobowe', cats: ['d'] },
  freight: { label: 'Ciężarowe i dostawcze', cats: ['e', 'f', 'g', 'h'] },
  transit: { label: 'Autobusy i tramwaje', cats: ['i', 'j', 'k'] },
  bike: { label: 'Rowery i UTO (na jezdni)', cats: ['a1', 'a2', 'b1', 'b2'] },
}

/** Vehicles at a road cross-section, summed over the chosen hours/cats/dirs. */
export function roadVolume(section, { cats, hours, dir }, catOrder) {
  if (!section) return 0
  const idx = cats ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0) : null
  let total = 0
  for (const [d, dd] of Object.entries(section.dirs)) {
    if (dir && dir !== d) continue
    for (const h of hours) {
      const row = dd.h[h]
      if (!row) continue
      if (idx) for (const i of idx) total += row[i]
      else for (const v of row) total += v
    }
  }
  return total
}

/** 24-value hourly profile for a road cross-section. */
export function roadProfile(section, { cats, dir }, catOrder) {
  const idx = cats ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0) : null
  const out = new Array(24).fill(0)
  if (!section) return out
  for (const [d, dd] of Object.entries(section.dirs)) {
    if (dir && dir !== d) continue
    for (let h = 0; h < 24; h++) {
      const row = dd.h[h]
      if (!row) continue
      if (idx) for (const i of idx) out[h] += row[i]
      else for (const v of row) out[h] += v
    }
  }
  return out
}

export const sumHours = (profile, hours) => hours.reduce((a, h) => a + (profile[h] || 0), 0)

/** 24-value hourly profile for any layer, so points and cross-sections can be
 *  summed the same way. */
export function profileFor(data, kind, p, metric, people = false) {
  if (kind === 'road') {
    return roadProfile(data.roadById[p.id], { cats: activeCats(metric, people) },
      data.meta.vehCatOrder)
  }
  if (kind === 'pt' || kind === 'rail') {
    const out = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { out[h] += v }))
    return out
  }
  return p.byHour || new Array(24).fill(0)
}

/** Cross-sections of one point summed together — the whole junction, not one
 *  approach of it. */
export function addProfiles(profiles) {
  const out = new Array(24).fill(0)
  for (const pr of profiles) for (let h = 0; h < 24; h++) out[h] += pr[h] || 0
  return out
}

// A measurement point (punkt) is split into lettered cross-sections (przekroje):
// KW_08 -> KW_08A, KW_08B, KW_08C. Each letter is one approach at that place -
// a separate street or slip road for road counts, one side of the street for
// cycle counts, one street of an interchange for transit counts.
export const parentOf = (kind, p) =>
  kind === 'road' || kind === 'pt' ? p.point : p.id.replace(/[A-Z]$/, '')

export const sectionLetter = (id) => (/[A-Z]$/.test(id) ? id.slice(-1) : null)

/** What distinguishes this cross-section from its siblings. */
export function sectionOf(kind, p) {
  if (kind === 'pt') return p.loc
  if (kind === 'bike' || kind === 'ped') return (p.where || [])[0] || p.segment
  return p.segment
}

/**
 * Transit cross-sections all sit on the same stop, so identical coordinates
 * would hide each other. Fan coincident markers onto a small ring around the
 * shared position; the popup still names the real location.
 */
export function spread(markers, metres = 20) {
  const by = new Map()
  for (const m of markers) {
    const k = `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(m)
  }
  for (const group of by.values()) {
    if (group.length < 2) continue
    const dLat = metres / 111320
    const dLon = dLat / Math.cos((group[0].lat * Math.PI) / 180)
    group.forEach((m, i) => {
      const a = (2 * Math.PI * i) / group.length
      m.lat += dLat * Math.sin(a)
      m.lon += dLon * Math.cos(a)
      m.shifted = group.length
    })
  }
  return markers
}

// Only the road counts ran all day. Passengers, cyclists and pedestrians were
// counted in the peaks only, so a "whole day" total for them is a peak total
// wearing the wrong label unless it is expanded.
export const coverage = (meta, kind) => meta.windows?.[kind] || null

export function coverageGap(meta, kind, hours) {
  const w = coverage(meta, kind)
  if (!w) return null
  const missing = hours.filter((h) => !w.includes(h))
  return missing.length ? { missing, measured: hours.length - missing.length } : null
}

export const expansionOf = (meta, kind) => meta.expansion?.[kind] || null

/** Which measurement window a marker's numbers come from. Road sections on
 *  the study-area cordon (KO_*) ran in the peaks only, unlike the rest of the road
 *  layer, so they expand and warn like the peak-only layers do. */
export const windowKind = (kind, ref) => (kind === 'road'
  && (ref?.window || ref?.members?.some((x) => x.window)) ? 'roadPeak' : kind)

/** Scale a peak-only count up to a whole day, when the user asks for it. */
export function expand(meta, kind, value, on) {
  const e = expansionOf(meta, kind)
  if (!on || !e || !e.factor) return value
  return value * e.factor
}

export const BASIS_LABEL = {
  measured: 'pomiar',
  derived: 'wyliczone z danych KBR',
  assumed: 'założenie',
}

// The road survey counts vehicles. Converting to people is only meaningful for
// cars: lorry and van occupancy is not surveyed, and bus and tram passengers are
// counted directly in the transit layer, so folding them in would double count.
export const CAR_CATS = ['d']

export function toPeople(value, kind, occupancy, on) {
  if (!on) return value
  return kind === 'road' ? value * occupancy : value
}

/** Which vehicle categories the road layer should count right now. */
export const activeCats = (metric, people) =>
  (people ? CAR_CATS : ROAD_METRICS[metric].cats)

/** Marker radius: sqrt so area, not radius, tracks the volume. */
export function radius(value, max, min = 3, cap = 22) {
  if (!value || !max) return min
  return min + (cap - min) * Math.sqrt(value / max)
}

export const fmt = (n) =>
  n == null ? '—' : Math.round(n).toLocaleString('pl-PL')

/**
 * Estimates are printed at two significant figures. The model's median error is
 * 30%, so a digit like the 7 in "6427" is noise pretending to be information.
 */
export function roundEst(n) {
  if (!n || n < 100) return Math.round(n / 10) * 10
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1)
  return Math.round(n / mag) * mag
}

export const fmtEst = (n) => `≈${fmt(roundEst(n))}`

export const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)

/**
 * The network model predicts the 6-10 + 15-19 window, because that is the only
 * window every measured cross-section shares. To show any other period we scale
 * by the measured city-wide motor-traffic shape from the 45 cross-sections that
 * were counted round the clock.
 */
export function periodShare(meta, hours) {
  const p = meta.profiles?.motor
  if (!p) return 1
  const win = MODEL_WINDOW.reduce((a, h) => a + p[h], 0)
  if (!win) return 1
  return hours.reduce((a, h) => a + (p[h] || 0), 0) / win
}

// What each estimation layer is measuring, and which file holds it.
export const NET_MODES = {
  road: { label: 'Samochody i inne pojazdy', file: 'network', unit: 'poj.' },
  pt: { label: 'Pasażerowie autobusów i tramwajów', file: 'network_pt', unit: 'pasażerów' },
  service: {
    label: 'Kursy autobusów i tramwajów (rozkład)', file: 'network_service',
    unit: 'kursów', measured: true,
  },
}

export const MODEL_WINDOW = [6, 7, 8, 9, 15, 16, 17, 18]

export const HOUR_LABEL = (h) => `${String(h).padStart(2, '0')}:00`

/** What the numbers on the map are summed over, for labelling. */
export function rangeLabel(range) {
  const named = Object.values(PRESETS).find((p) => sameRange(p.range, range))
  if (named) return named.label.toLowerCase()
  const end = range[1] === 24 ? '24:00' : HOUR_LABEL(range[1])
  return `${HOUR_LABEL(range[0])}–${end}`
}

/** One marker per drawn point: position, the value that sizes it, and what to
 *  select on click.
 *
 *  Built here rather than inside MapView because the sidebar's ranked list has
 *  to select the very same objects. When it built its own list from data.points
 *  while the map was showing aggregated points, the ids disagreed and clicking
 *  a row highlighted nothing.
 */
export function buildMarkers(data, {
  visible, hours, metric, areas, aggregate, split, wholeDay, people, occupancy,
  off = NONE,
}) {
  const catOrder = data.meta.vehCatOrder
  const out = {}
  // `aggregate` sums a point's sections into one marker; `split` also turns
  // nodes into modal-split pies, which needs the transit nodes for their load.
  const want = split && visible.road ? { ...visible, pt: true } : visible

  if (want.road) {
    const cats = activeCats(metric, people)
    out.road = data.points
      .filter((p) => p.lat && (!areas || areas.includes(p.area)))
      .map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'road', ref: p,
        value: roadVolume(data.roadById[p.id], { cats, hours }, catOrder),
        title: `${p.id} · ${p.name}`, sub: sectionOf('road', p),
      }))
  }
  if (want.pt) {
    out.pt = data.pt.filter((p) => p.lat).map((p) => ({
      id: p.id, lat: p.lat, lon: p.lon, kind: 'pt', ref: p,
      value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
      title: `${p.id} · ${p.stop || p.name}`, sub: sectionOf('pt', p),
    }))
  }
  if (want.bike) {
    out.bike = data.bike.filter((p) => p.lat).map((p) => ({
      id: p.id, lat: p.lat, lon: p.lon, kind: 'bike', ref: p,
      value: sumHours(p.byHour, hours),
      title: `${p.id} · ${p.name}`, sub: sectionOf('bike', p),
    }))
  }
  if (want.ped) {
    out.ped = data.ped.filter((p) => p.lat).map((p) => ({
      id: p.id, lat: p.lat, lon: p.lon, kind: 'ped', ref: p,
      value: sumHours(p.byHour, hours),
      title: `${p.id} · ${p.short || p.name}`, sub: sectionOf('ped', p),
    }))
  }
  if (want.rail) {
    out.rail = data.rail.filter((p) => p.lat).map((p) => ({
      id: p.id, lat: p.lat, lon: p.lon, kind: 'rail', ref: p,
      value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
      title: `${p.id} · ${p.stations.join(' / ')}`,
    }))
  }
  for (const k of Object.keys(out)) {
    for (const m of out[k]) {
      m.raw = m.value
      m.value = toPeople(expand(data.meta, windowKind(k, m.ref), m.value, wholeDay),
        k, occupancy, people)
    }
    if (aggregate && k !== 'rail') out[k] = mergeToPoints(k, out[k], off)
  }
  if (split) {
    attachSplits(data, out, {
      hours, occupancy: occupancy ?? data.meta.carOccupancy.default, pair: !!visible.road, off,
    })
  }
  if (!visible.pt) delete out.pt
  for (const k of Object.keys(out)) spread(out[k])
  return out
}

const NONE = new Set()

/** Key of a section in the set of sections left out of their node. */
export const pieceKey = (kind, id) => `${kind}:${id}`

/** One marker per measurement point: its cross-sections are separate approaches
 *  of the same place, so their counts add up rather than overlap.
 *
 *  Sections in `off` are left out of the sums - say the far approaches of a big
 *  interchange, to look at one junction of it. They stay in `all`, so the panel
 *  can list them and bring them back, and the marker stays where it was. */
function mergeToPoints(kind, list, off) {
  const by = new Map()
  for (const m of list) {
    const key = parentOf(kind, m.ref)
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(m)
  }
  return [...by.entries()].map(([key, ms]) => {
    if (ms.length === 1) return ms[0]
    const on = ms.filter((m) => !off.has(pieceKey(kind, m.id)))
    return {
      id: key, kind,
      lat: ms.reduce((a, m) => a + m.lat, 0) / ms.length,
      lon: ms.reduce((a, m) => a + m.lon, 0) / ms.length,
      value: on.reduce((a, m) => a + m.value, 0),
      raw: on.reduce((a, m) => a + m.raw, 0),
      title: `${key} · ${ms[0].ref.name || ms[0].ref.stop || ''}`,
      sub: `suma ${on.length} przekrojów: ${on.map((m) => m.id.slice(-1)).join(', ')}`
        + (on.length < ms.length ? ` (z ${ms.length})` : ''),
      ref: {
        aggregate: true, id: key, members: on.map((m) => m.ref), all: ms.map((m) => m.ref),
        name: ms[0].ref.name || ms[0].ref.stop || '',
        // Usually a node's sections are different streets crossing a survey
        // line, and their sum is the traffic across it. In 10 nodes they are
        // the same street either side of a junction, where a vehicle going
        // straight on is counted on both - the sum overstates, shares do not.
        repeatsStreet: kind === 'road'
          && new Set(on.map((m) => m.ref.name)).size < on.length,
      },
    }
  })
}

/** The drawn marker that contains a given point.
 *
 *  Search works on raw records, but in node mode the map draws nodes: R1_06A is
 *  inside R1_06, and a transit node paired with a road node is inside that
 *  road's pie. Selecting the raw id would highlight nothing and lose the split.
 */
export function resolveTarget(markers, kind, ref) {
  const list = markers[kind] || []
  const m = list.find((x) => x.id === ref.id)
    || list.find((x) => x.ref.aggregate && x.ref.all.some((r) => r.id === ref.id))
  if (m) return { kind, id: m.id, ref: m.ref }
  if (kind === 'pt') {
    const host = (markers.road || []).find((x) => x.pair
      && (x.pair.id === ref.id || x.pair.all.some((r) => r.id === ref.id)))
    if (host) return { kind: 'road', id: host.id, ref: host.ref }
  }
  return { kind, id: ref.id, ref }
}

/** Flat lookup so the map can find a selected marker without rescanning. */
export const markerIndex = (markers) => {
  const idx = {}
  for (const [kind, list] of Object.entries(markers)) {
    for (const m of list) idx[`${kind}:${m.id}`] = m
  }
  return idx
}

const FAMILY_SOURCE = { road: 'points', pt: 'pt', bike: 'bike', ped: 'ped' }

/**
 * What a selection is part of, so the panel and the map can treat a section as
 * a piece of something rather than a separate place.
 *
 * In node mode that is the drawn node: its road sections and, when it has a
 * transit partner, that partner's stop sections - one group each, since their
 * units differ. A transit section whose node was folded into a road pie
 * belongs to that pie. Otherwise it is the lettered sections of one point.
 * Null when there is only one piece.
 */
export function familyOf(data, markers, sel) {
  const { kind, ref } = sel || {}
  if (!FAMILY_SOURCE[kind] || !ref) return null
  const parent = ref.aggregate ? ref.id : parentOf(kind, ref)
  const idx = markerIndex(markers)
  // a node is a pie or a merged point; drawn apart, markers are plain sections
  let node = [idx[`${kind}:${parent}`], idx[`${kind}:${ref.id}`]]
    .find((m) => m?.split || m?.ref?.aggregate) || null
  if (!node && kind === 'pt') {
    node = (markers.road || []).find((r) => r.pair?.all.some((x) => x.id === ref.id)) || null
  }
  const groups = node
    ? [{ kind: node.kind, members: allOf(node) },
      ...(node.pair ? [{ kind: 'pt', members: node.pair.all }] : [])]
    : [{ kind, members: data[FAMILY_SOURCE[kind]].filter((x) => parentOf(kind, x) === parent) }]
  if (groups.reduce((a, g) => a + g.members.length, 0) < 2) return null
  const atNode = ref.aggregate || ref === node?.ref
  return { parent, node, groups, current: atNode ? null : { kind, id: ref.id } }
}

// ------------------------------------------------------------- modal split
// What moves through a node, in people. The road survey counts vehicles by
// category; people are what the modal-split question is about.
export const MODES = [
  { key: 'car', label: 'Samochody osobowe', color: '#e4572e', cats: ['d'] },
  { key: 'goods', label: 'Dostawcze i ciężarowe', color: '#b07a4f', cats: ['e', 'f', 'g', 'h'] },
  { key: 'bus', label: 'Autobusy', color: '#2e86ab', cats: ['j'] },
  { key: 'tram', label: 'Tramwaje', color: '#4cc9f0', cats: ['k'] },
  { key: 'bike', label: 'Rowery i hulajnogi', color: '#3fa34d',
    cats: ['a1', 'a2', 'b1', 'b2'], off: ['a3', 'a4', 'b3', 'b4'] },
  { key: 'other', label: 'Inne (motocykle, mikrobusy)', color: '#8d99ae', cats: ['c', 'i', 'l'] },
]
const MODE = Object.fromEntries(MODES.map((m) => [m.key, m]))

// Road and transit nodes are numbered independently, so they are paired by
// distance. Up to 150 m the pairs are the same junction (Arkady/Swidnicka 16 m,
// Dworzec/Kollataja 78 m, pl. Grunwaldzki 127 m); past it they start matching
// a different street.
export const PAIR_RADIUS = 150

/** Measured passengers per vehicle, by mode, from the transit survey (6.4). */
function transitOccupancy(pt) {
  const pax = { bus: 0, tram: 0 }
  const veh = { bus: 0, tram: 0 }
  for (const p of pt) {
    for (const [t, arr] of Object.entries(p.byHour || {})) {
      pax[t === 'tramwaj' ? 'tram' : 'bus'] += arr.reduce((a, b) => a + b, 0)
    }
    for (const [t, arr] of Object.entries(p.vehByHour || {})) {
      veh[t === 'tramwaj' ? 'tram' : 'bus'] += arr.reduce((a, b) => a + b, 0)
    }
  }
  return { bus: pax.bus / Math.max(1, veh.bus), tram: pax.tram / Math.max(1, veh.tram) }
}

export function metres(a, b) {
  const R = 6371000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// the sections a node counts, and all it has including the ones left out
const membersOf = (m) => (m.ref.aggregate ? m.ref.members : [m.ref])
const allOf = (m) => (m.ref.aggregate ? m.ref.all : [m.ref])

function roadCounts(data, ids, hours) {
  const ci = Object.fromEntries(data.meta.vehCatOrder.map((c, i) => [c, i]))
  const oi = Object.fromEntries(data.meta.offCatOrder.map((c, i) => [c, i]))
  const v = Object.fromEntries(MODES.map((m) => [m.key, 0]))
  for (const id of ids) {
    const s = data.roadById[id]
    if (!s) continue
    for (const dd of Object.values(s.dirs)) {
      for (const h of hours) {
        const row = dd.h[h]
        if (!row) continue
        for (const m of MODES) for (const c of m.cats) v[m.key] += row[ci[c]] || 0
      }
    }
    for (const rows of Object.values(s.off || {})) {
      for (const h of hours) {
        const row = rows[h]
        if (!row) continue
        for (const c of MODE.bike.off) v.bike += row[oi[c]] || 0
      }
    }
  }
  return v
}

const roadHasHour = (data, ids, h) => ids.some((id) => {
  const s = data.roadById[id]
  return s && Object.values(s.dirs).some((dd) => (dd.h[h] || []).some((x) => x > 0))
})

function transitSum(refs, hours, field) {
  const out = { bus: 0, tram: 0 }
  for (const r of refs) {
    for (const [t, arr] of Object.entries(r[field] || {})) {
      out[t === 'tramwaj' ? 'tram' : 'bus'] += hours.reduce((a, h) => a + (arr[h] || 0), 0)
    }
  }
  return out
}
const transitPax = (refs, hours) => transitSum(refs, hours, 'byHour')
const transitVeh = (refs, hours) => transitSum(refs, hours, 'vehByHour')

/**
 * Modal split at a node, in people.
 *
 * Cars use the occupancy slider (an assumption). Buses and trams are the
 * vehicles counted on the road cross-sections, times the load per vehicle
 * measured at the paired transit node - or the city-wide measured average
 * where there is no partner.
 *
 * Adding the partner's raw passenger count instead would be wrong: the two
 * surveys cover different stop poles and approaches. Dworzec Glowny's transit
 * node spans 8 stop sections across three streets while the road node next to
 * it has 4 cross-sections, so raw passengers put trams at 48% of everyone. The
 * road sections define the stream; the transit node only supplies how full
 * the vehicles in it are. Vans,
 * lorries, motorbikes and minibuses count their driver only - a lower bound,
 * since their occupancy was never surveyed. Pedestrians are absent: the road
 * survey did not count them.
 *
 * A paired split uses only the hours both surveys covered. The transit survey
 * ran 5-9 and 14-18; mixing it with an all-day car count would overstate cars.
 */
export function nodeSplit(data, { roadIds, ptRefs, hours, occupancy }) {
  const ptWin = data.meta.windows?.pt || []
  const occ = data.transitOcc
  const mk = (key, vehicles, persons, est) => ({ ...MODE[key], vehicles, persons, est })

  if (!roadIds.length) {
    const hrs = hours.filter((h) => ptWin.includes(h))
    const pax = transitPax(ptRefs, hrs)
    return {
      basis: 'transit', hours: hrs,
      slices: [mk('bus', null, pax.bus, false), mk('tram', null, pax.tram, false)],
    }
  }

  // Every mode comes from the road counts, over the hours the road sections
  // were counted in (most 5-21, the KO cordon only in the peaks). That keeps
  // nodes comparable whatever the period.
  const hrs = hours.filter((h) => roadHasHour(data, roadIds, h))
  const v = roadCounts(data, roadIds, hrs)
  // The partner's passengers per vehicle is a ratio, so it is measured where
  // the stop survey ran - within the period if they overlap, else its whole
  // window - and applied to all the road-counted vehicles. Outside the stop
  // survey's hours that is an assumption, which the panel says. City average
  // for a mode the partner never saw.
  const load = { ...occ }
  const local = { bus: false, tram: false }
  let loadHours = []
  if (ptRefs?.length) {
    const inPeriod = hours.filter((h) => ptWin.includes(h))
    const pax = transitPax(ptRefs, inPeriod.length ? inPeriod : ptWin)
    const veh = transitVeh(ptRefs, inPeriod.length ? inPeriod : ptWin)
    for (const k of ['bus', 'tram']) {
      if (veh[k] > 0) { load[k] = pax[k] / veh[k]; local[k] = true }
    }
    // the hours the stop actually saw vehicles in, for the note
    loadHours = (inPeriod.length ? inPeriod : ptWin).filter((h) => ptRefs.some((r) =>
      Object.values(r.vehByHour || {}).some((arr) => arr[h] > 0)))
  }
  const measured = local.bus || local.tram
  return {
    basis: measured ? 'measured' : 'estimate', hours: hrs, load, local, loadHours,
    slices: [
      mk('car', v.car, v.car * occupancy, true),
      mk('goods', v.goods, v.goods, true),
      mk('bus', v.bus, v.bus * load.bus, !local.bus),
      mk('tram', v.tram, v.tram * load.tram, !local.tram),
      mk('bike', v.bike, v.bike, false),
      mk('other', v.other, v.other, true),
    ],
  }
}

/** Pair road and transit nodes, give every node its split, and drop transit
 *  nodes that now live inside a road pie. */
function attachSplits(data, out, { hours, occupancy, pair, off }) {
  const road = out.road || []
  const pt = out.pt || []
  const partner = new Map()
  const used = new Set()
  if (pair) {
    const cand = []
    for (const r of road) {
      for (const p of pt) {
        const d = metres(r, p)
        if (d <= PAIR_RADIUS) cand.push([d, r, p])
      }
    }
    cand.sort((x, y) => x[0] - y[0])
    for (const [d, r, p] of cand) {            // nearest first, one partner each
      if (partner.has(r) || used.has(p)) continue
      partner.set(r, { m: p, d })
      used.add(p)
    }
  }
  for (const r of road) {
    const pr = partner.get(r)
    // The partner's stops only lend the node their load per vehicle, so all
    // of them may be left out - a lone stop too, which was never merged.
    // Then the node falls back to the city average.
    const refs = pr ? allOf(pr.m).filter((x) => !off.has(pieceKey('pt', x.id))) : null
    r.split = nodeSplit(data, {
      roadIds: membersOf(r).map((x) => x.id), ptRefs: refs, hours, occupancy,
    })
    if (pr) {
      r.pair = {
        id: pr.m.id, title: pr.m.title, dist: Math.round(pr.d), refs, all: allOf(pr.m),
      }
    }
  }
  for (const p of pt) {
    if (!used.has(p)) {
      p.split = nodeSplit(data, { roadIds: [], ptRefs: membersOf(p), hours, occupancy })
    }
  }
  if (out.pt) out.pt = pt.filter((p) => !used.has(p))
}

export const splitTotal = (split) => split.slices.reduce((a, s) => a + s.persons, 0)

// How far to look for a cycle count to set beside a node's road-counted bikes.
const BIKE_NEAR = 800

const runsText = (hours) => {
  const runs = []
  for (const h of [...hours].sort((a, b) => a - b)) {
    if (runs.length && runs.at(-1)[1] === h - 1) runs.at(-1)[1] = h
    else runs.push([h, h])
  }
  return runs.map(([a, b]) => `${a}–${b + 1}`).join(', ')
}

/**
 * What the bike slice of a node's split covers, in words.
 *
 * The road survey counted bikes on the roadway and on painted bike lanes at
 * every section, but bike paths and pavements beside the road only at some
 * (75 of 244). Where they were not counted the slice is a floor - R1_23 shows
 * 18 bikes in the morning peak while the cycle count on Dmowskiego, 430 m
 * away, saw 412. The nearest cycle count point is named for scale, summed
 * over its sides of the street, in the hours both surveys share.
 */
export function bikeNote(data, node, split) {
  const secs = membersOf(node).filter((r) => data.roadById[r.id])
  if (!secs.length) return null
  const withPaths = secs.filter((r) => Object.keys(data.roadById[r.id].off || {}).length)
  const letters = (rs) => rs.map((r) => sectionLetter(r.id) || r.id).join(', ')
  let text
  if (withPaths.length === secs.length) {
    text = 'Rowery i hulajnogi: na jezdni, pasach rowerowych oraz na drogach '
      + 'rowerowych i chodnikach obok jezdni.'
  } else {
    text = withPaths.length
      ? 'Rowery i hulajnogi: na jezdni i pasach rowerowych; drogi rowerowe i chodniki '
        + `obok jezdni liczono tylko na przekrojach ${letters(withPaths)}, więc na `
        + 'pozostałych to dolna granica.'
      : 'Rowery i hulajnogi: tylko na jezdni i pasach rowerowych. Na tych przekrojach '
        + 'nie liczono dróg rowerowych ani chodników obok jezdni, więc to dolna granica '
        + '— rowerzystów może być znacznie więcej.'
    const near = nearestBike(data, node, split.hours)
    if (near) {
      text += ` Najbliższy pomiar ruchu rowerowego: ${near.id} · ${near.name} `
        + `(${near.dist} m) — ${near.hours.length
          ? `${fmt(near.count)} rowerzystów w godz. ${runsText(near.hours)}`
          : `liczony tylko w godz. ${runsText(near.window)}`}.`
    }
  }
  return text
}

/** The closest cycle count point to a node, its sides summed. */
function nearestBike(data, node, hours) {
  const by = new Map()
  for (const b of data.bike || []) {
    if (!b.lat) continue
    const key = parentOf('bike', b)
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(b)
  }
  let best = null
  for (const [id, bs] of by) {
    const dist = Math.min(...bs.map((b) => metres(node, b)))
    if (dist <= BIKE_NEAR && (!best || dist < best.dist)) best = { id, bs, dist }
  }
  if (!best) return null
  const window = data.meta.windows?.bike || []
  const hrs = hours.filter((h) => window.includes(h))
  return {
    id: best.id, name: best.bs[0].name, dist: Math.round(best.dist / 10) * 10,
    hours: hrs, window, count: best.bs.reduce((a, b) => a + sumHours(b.byHour, hrs), 0),
  }
}

/** All the vehicles behind a split, for each mode's share of the traffic as
 *  against its share of the people. Zero for a transit-only node. */
export const splitVehicles = (split) => split.slices.reduce((a, s) => a + (s.vehicles || 0), 0)

/** The number a node goes by. When counting people and the node has a modal
 *  split, that is everyone through it - all modes, not just the car share. */
export const headline = (m, people) => (people && m.split && splitTotal(m.split) > 0
  ? splitTotal(m.split) : m.value)
