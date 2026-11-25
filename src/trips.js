// The household survey's trips: filtered, summed over places and described.
// Rows are columns of numbers (see etl/trips.py), so a filter over all of them
// is a few milliseconds and everything below is recomputed as it changes.
import { csvNumber as num } from '@bartor-net/ui-kit'

/** Outlines come as running differences of whole 1e-5 degrees. */
export function rings(coded) {
  return coded.map((flat) => {
    const out = []
    let la = 0
    let lo = 0
    for (let i = 0; i < flat.length; i += 2) {
      la += flat[i]
      lo += flat[i + 1]
      out.push([la / 1e5, lo / 1e5])
    }
    return out
  })
}

/** Zones, the districts they make up, and the places outside the study area. */
export function readZones(j) {
  const zones = j.zones.map((z, i) => ({
    ...z, i, key: `z${z.id}`, rings: rings(z.g), zones: [i], level: 'z',
    district: j.districts[z.d].name,
  }))
  const districts = j.districts.map((d, i) => {
    const own = zones.filter((z) => z.d === i)
    const sum = (k) => (own.some((z) => z[k] != null) ? own.reduce((a, z) => a + (z[k] || 0), 0) : null)
    // the middle of the people who live there, or of the land
    const w = own.map((z) => z.pop || z.km2)
    const all = w.reduce((a, b) => a + b, 0)
    return {
      key: `d${i}`, i, level: 'd', name: d.name, city: d.city, rings: rings(d.g),
      zones: own.map((z) => z.i),
      c: [0, 1].map((k) => own.reduce((a, z, n) => a + z.c[k] * w[n], 0) / all),
      pop: sum('pop'), popEst: own.some((z) => z.popEst) ? 1 : 0, jobs: sum('jobs'), firms: sum('firms'), n: sum('n'), km2: sum('km2'),
      core: own.every((z) => z.core) ? 1 : 0,
    }
  })
  return { zones, districts, outside: j.outside, core: j.core, count: zones.length }
}

/** Places of a level: what is drawn, and which of them a zone belongs to. */
export function places(Z, level) {
  const list = level === 'd' ? Z.districts : Z.zones
  const of = new Int16Array(Z.count + Z.outside.length).fill(-1)
  list.forEach((p, k) => p.zones.forEach((z) => { of[z] = k }))
  return { list, of, byKey: new Map(list.map((p) => [p.key, p])) }
}

export const placeName = (p) => (p.level === 'd' ? p.name : p.name.includes(' - ')
  ? p.name.replace(' - ', ' — ') : `${p.name}`)

// What the trips view starts with.
export const TRIPS0 = {
  set: 'people', level: 'd', paint: 'any', way: 'home', per: 'pop', picked: [], filters: {}, lines: true, many: false,
}

// ------------------------------------------------------------------ the modes
// A mode's colour is the one it has in the counts, where it is counted there.
export const TRIP_MODES = [
  { key: 'walk', label: 'Pieszo', color: '#b5179e', of: [0] },
  { key: 'bike', label: 'Rower, hulajnoga', color: '#0ca30c', of: [1, 2] },
  { key: 'drive', label: 'Samochód — kierowca', color: '#e4572e', of: [3] },
  { key: 'ride', label: 'Samochód — pasażer', color: '#f2a48d', of: [4] },
  { key: 'bus', label: 'Autobus', color: '#c98500', of: [8] },
  { key: 'tram', label: 'Tramwaj', color: '#3987e5', of: [7] },
  { key: 'change', label: 'KZ z przesiadką', color: '#6cc5d9', of: [10] },
  { key: 'train', label: 'Pociąg', color: '#7048e8', of: [9] },
  { key: 'other', label: 'Taksówka, motocykl, inne', color: '#6b7385', of: [5, 6, 11] },
]
const MODE_AT = []
TRIP_MODES.forEach((m, i) => m.of.forEach((k) => { MODE_AT[k] = i }))
export const modeAt = (m) => MODE_AT[m]
const at = (key) => TRIP_MODES.findIndex((m) => m.key === key)

/** The four headline groups: what the survey calls the division of tasks. */
export const MAIN = [
  { key: 'car', label: 'samochód', color: '#e4572e', of: [at('drive'), at('ride')] },
  { key: 'pt', label: 'transport zbiorowy', color: '#3987e5', of: ['bus', 'tram', 'change', 'train'].map(at) },
  { key: 'walk', label: 'pieszo', color: '#b5179e', of: [at('walk')] },
  { key: 'bike', label: 'rower', color: '#0ca30c', of: [at('bike')] },
]

// ---------------------------------------------------------------- the filters
const pl = (x) => String(x).replace('.', ',')
const bands = (edges, unit) => edges.map((a, i) => ({
  label: i === edges.length - 1 ? `${pl(a)}+ ${unit}` : i === 0 ? `do ${pl(edges[1])} ${unit}` : `${pl(a)}–${pl(edges[i + 1])}`,
}))
const KM = [0, 0.5, 1, 2, 3, 5, 10]
const MIN = [0, 11, 21, 31, 46, 61]
const bandOf = (edges) => (v) => {
  if (v == null) return -1
  let i = edges.length - 1
  while (v < edges[i]) i--
  return i
}
const kmBand = bandOf(KM)
const minBand = bandOf(MIN)
export const KM_BANDS = bands(KM, 'km')
export const MIN_BANDS = ['do 10 min', '11–20', '21–30', '31–45', '46–60', 'ponad godzinę']
  .map((label) => ({ label }))
const AREAS = ['centrum (do 1,5 km od Rynku)', 'reszta Wrocławia', 'gminy wokół', 'dalej']

/**
 * What trips can be filtered by. `of(c, i)` is the option a row falls into, or
 * -1 for none: the length of a trip that ends outside the study area, the
 * people in a car that was not driven.
 */
export function dims(T, area) {
  const o = (list) => list.map((x) => (typeof x === 'string' ? { label: x } : x))
  return [
    { key: 'mode', label: 'Środek transportu', options: TRIP_MODES, of: (c, i) => MODE_AT[c.m[i]] },
    { key: 'goal', label: 'Cel podróży', options: o(T.acts), of: (c, i) => c.a1[i],
      help: 'Dokąd ktoś jechał lub szedł. Prawie połowa podróży to powroty do domu; żeby liczyć '
        + 'je razem z drogą tam, użyj motywu.' },
    { key: 'why', label: 'Motyw (tam i z powrotem)', options: o(T.acts.slice(1)),
      of: (c, i) => (c.a1[i] === 0 ? c.a0[i] : c.a1[i]) - 1 },
    { key: 'km', label: 'Długość', options: o(KM_BANDS), of: (c, i) => kmBand(c.km[i]),
      help: 'W linii prostej między środkami rejonów — tak podaje ją badanie. Droga po ulicach jest '
        + 'zwykle o 20–40% dłuższa, a podróż w obrębie jednego rejonu ma długość 0.' },
    { key: 'min', label: 'Czas podróży', options: o(MIN_BANDS), of: (c, i) => minBand(c.d[i]) },
    { key: 'to', label: 'Dokąd', options: o(AREAS), of: (c, i) => area[c.t[i]] },
    { key: 'from', label: 'Skąd', options: o(AREAS), of: (c, i) => area[c.f[i]] },
    { key: 'in', label: 'Osób w samochodzie', options: o(['1 — sam kierowca', '2', '3', '4 i więcej']),
      of: (c, i) => Math.min(4, c.o[i]) - 1, note: 'tylko kierowcy' },
    { key: 'park', label: 'Gdzie zaparkowano', options: o(T.park), of: (c, i) => c.pk[i], note: 'tylko kierowcy' },
    { key: 'reason', label: 'Dlaczego samochodem', options: o(T.why), of: (c, i) => c.y[i],
      note: 'tylko kierowcy', help: 'Główny powód podany przez kierowcę — raz, nie osobno dla każdej podróży.' },
    { key: 'cars', label: 'Samochody w domu', options: o(['brak', '1', '2', '3 i więcej']), of: (c, i) => c.hc[i] },
    { key: 'age', label: 'Wiek', options: o(T.ages), of: (c, i) => c.ag[i] },
    { key: 'job', label: 'Zajęcie', options: o(T.jobs), of: (c, i) => c.jb[i] },
    { key: 'pass', label: 'Bilet okresowy', options: o(['nie ma', 'ma']), of: (c, i) => c.ps[i] },
    { key: 'lic', label: 'Prawo jazdy', options: o(['nie ma', 'ma']), of: (c, i) => c.lc[i] },
    { key: 'live', label: 'Mieszka', options: o(['poza Wrocławiem', 'we Wrocławiu']), of: (c, i) => c.wr[i] },
    { key: 'change', label: 'Przesiadki', options: o(['bez przesiadek', '1', '2']), of: (c, i) => c.x[i] },
  ]
}

/** Core, rest of the city, communes around, further: for every end of a trip. */
export const areas = (Z) => Int8Array.from(
  [...Z.zones.map((z) => (z.core ? 0 : z.city ? 1 : 2)), ...Z.outside.map(() => 3)],
)

// Named sets of filters.
export const TRIP_PRESETS = [
  { key: 'core', label: 'Do centrum', filters: { to: [0], from: [1, 2, 3] } },
  { key: 'carcore', label: 'Samochodem do centrum', filters: { mode: [2, 3], to: [0], from: [1, 2, 3] } },
  { key: 'short', label: 'Samochodem do 3 km', filters: { mode: [2, 3], km: [0, 1, 2, 3] } },
  { key: 'alone', label: 'Kierowca sam', filters: { mode: [2], in: [0] } },
  { key: 'easy', label: 'Najłatwiejsze do zastąpienia', filters: { mode: [2], in: [0], easy: [1] },
    help: 'Sam kierowca, jedzie z wygody, dla czasu lub kosztu, do 5 km albo do lub z centrum. '
      + 'To cechy podróży, nie deklaracja: o gotowość do zmiany nikt nie pytał.' },
  { key: 'kids', label: 'Odwożenie samochodem', filters: { mode: [2, 3], why: [5] } },
]

/** Comfort, time or cost only; and short, or an end in the core. */
const easy = (c, i, area) => c.sf[i] === 1
  && ((c.km[i] != null && c.km[i] < 5) || area[c.t[i]] === 0 || area[c.f[i]] === 0)

/** Which trips pass: their row numbers. `skip` leaves one filter out. */
export function passing(S, { filters, hours }, skip) {
  const { T, D, area } = S
  const c = T.cols
  const inHour = hours && hours.length < 24 ? new Set(hours) : null
  const on = D.filter((d) => filters[d.key]?.length && d.key !== skip)
    .map((d) => ({ of: d.of, has: new Set(filters[d.key]) }))
  const wantEasy = !!filters.easy?.length
  const out = []
  for (let i = 0; i < T.n; i++) {
    if (inHour && !inHour.has(c.h[i])) continue
    if (wantEasy && !easy(c, i, area)) continue
    if (on.every((d) => d.has.has(d.of(c, i)))) out.push(i)
  }
  return out
}

/** The zone of a trip's home end: whose trip it is. -1 for one between two
 *  other places - 1 in 14. */
const homeOf = (c, i) => (c.a0[i] === 0 ? c.f[i] : c.a1[i] === 0 ? c.t[i] : -1)

/** Trips that start, end, or do either in the picked zones; or ('home') that
 *  the people living there make from home or back. */
export function touching(S, idx, zones, way) {
  if (!zones) return idx
  const z = new Set(zones)
  const c = S.T.cols
  return idx.filter((i) => (way === 'from' ? z.has(c.f[i]) : way === 'to' ? z.has(c.t[i])
    : way === 'home' ? z.has(homeOf(c, i)) : z.has(c.f[i]) || z.has(c.t[i])))
}

export function prepare(zonesJson, T) {
  const Z = readZones(zonesJson)
  const area = areas(Z)
  return {
    Z, T, area, D: dims(T, area), levels: { d: places(Z, 'd'), z: places(Z, 'z') },
    modes: TRIP_MODES, modeAt: MODE_AT, main: MAIN, ends: T.acts,
  }
}

// ---------------------------------------------------------------- the freight
const CLASS_COLORS = ['#f2c14e', '#e08e45', '#b8793e', '#7bb4ea', '#3f8bd0', '#5a55c8', '#8d3fa8']

/** The freight survey in the same shape: one row is one surveyed run, not
 *  scaled up, and its "modes" are classes of vehicle. */
export function prepareFreight(zonesJson, F) {
  const Z0 = readZones(zonesJson)
  const Z = { ...Z0, outside: F.outside }
  const blank = (v) => new Array(F.n).fill(v)
  const T = {
    n: F.n, acts: F.places, modes: F.classes, park: [], why: [], ages: [], jobs: [],
    cols: { ...F.cols, w: blank(1), km: blank(null), d: blank(null), o: blank(0), pk: blank(-1),
      sf: blank(0), x: blank(0), ag: blank(0), jb: blank(0), hc: blank(0), ps: blank(0), lc: blank(0),
      wr: blank(0), y: blank(-1) },
  }
  const area = areas(Z)
  const modes = F.classes.map((label, i) => ({ key: `c${i}`, label, color: CLASS_COLORS[i], of: [i] }))
  const o = (list) => list.map((label) => ({ label }))
  const D = [
    { key: 'mode', label: 'Pojazd', options: modes, of: (c, i) => c.m[i] },
    { key: 'goal', label: 'Cel', options: o(F.places), of: (c, i) => c.a1[i] },
    { key: 'from', label: 'Skąd', options: o(AREAS), of: (c, i) => area[c.f[i]] },
    { key: 'to', label: 'Dokąd', options: o(AREAS), of: (c, i) => area[c.t[i]] },
  ]
  return { Z, T, area, D, levels: { d: places(Z, 'd'), z: places(Z, 'z') }, modes,
    modeAt: F.classes.map((_, i) => i), ends: F.places, freight: true,
    main: [{ key: 'light', label: 'do 3,5 t', color: CLASS_COLORS[1], of: [0, 1, 2] },
      { key: 'heavy', label: 'powyżej 3,5 t', color: CLASS_COLORS[5], of: [3, 4, 5, 6] }] }
}

// ------------------------------------------------------------------- the sums
/** Trips a day behind some rows, per group; `of` gives the group or -1. */
export function sumBy(S, idx, k, of) {
  const w = new Float64Array(k)
  const n = new Int32Array(k)
  const c = S.T.cols
  for (const i of idx) {
    const g = of(c, i)
    if (g < 0) continue
    w[g] += c.w[i]
    n[g] += 1
  }
  return { w, n }
}

export const total = (S, idx) => idx.reduce((a, i) => a + S.T.cols.w[i], 0)

// How alike the travel of people asked by one interviewer is, over and above
// anyone's, and about how many interviewers stand behind n trips. Set so that
// the margin of the whole sample is what resampling interviewers gives (+-5
// points for the car's share).
const ASKER = 0.07
const askers = (n) => Math.max(1, Math.min(30, 0.7 * (n / 2) ** 0.42))

/**
 * The 95% margin of a share, in its own units. Weights differ, a person's
 * trips go together - out by car, back by car - and so do people asked by one
 * interviewer, so the sample says less than its count: Kish's effective size,
 * halved for the two trips of a day, and the interviewers' part on top.
 */
export function margin(S, idx, share) {
  let a = 0
  let b = 0
  for (const i of idx) { const w = S.T.cols.w[i]; a += w; b += w * w }
  const n = b ? (a * a) / b / 2 : 0
  const p = Math.min(0.97, Math.max(0.03, share))
  return n < 2 ? null : 1.96 * Math.sqrt(p * (1 - p) * (1 / n + ASKER / askers(idx.length)))
}

/** Everything the panel says about a set of trips. */
export function describe(S, idx) {
  const c = S.T.cols
  const all = total(S, idx)
  const mode = sumBy(S, idx, S.modes.length, (x, i) => S.modeAt[x.m[i]])
  const share = (of) => (all ? of.reduce((a, m) => a + mode.w[m], 0) / all : 0)
  let km = 0
  let kw = 0
  let min = 0
  let mw = 0
  let people = 0
  let cars = 0
  for (const i of idx) {
    const w = c.w[i]
    if (c.km[i] != null) { km += c.km[i] * w; kw += w }
    if (c.d[i] != null) { min += c.d[i] * w; mw += w }
    if (c.o[i]) { people += c.o[i] * w; cars += w }
  }
  return {
    n: idx.length, w: all, mode,
    main: S.main.map((m) => { const s = share(m.of); return { ...m, share: s, margin: margin(S, idx, s) } }),
    km: kw ? km / kw : null, min: mw ? min / mw : null, inCar: cars ? people / cars : null, cars,
    hours: S.modes.map((_, k) => {
      const out = new Array(24).fill(0)
      for (const i of idx) if (S.modeAt[c.m[i]] === k && c.h[i] != null) out[c.h[i]] += c.w[i]
      return out
    }),
  }
}

/** Shares of one dimension, biggest first unless it has an order of its own. */
export function shares(S, idx, key) {
  const d = S.D.find((x) => x.key === key)
  const { w, n } = sumBy(S, idx, d.options.length, d.of)
  const all = w.reduce((a, b) => a + b, 0)
  return d.options.map((o, i) => ({ i, label: o.label, color: o.color, w: w[i], n: n[i], share: all ? w[i] / all : 0 }))
}

/** Per drawn place: trips that start there, end there, and either, by mode;
 *  or only those of the people who live there. */
export function perPlace(S, idx, level, way) {
  const { list, of } = S.levels[level]
  const c = S.T.cols
  const K = S.modes.length
  const blank = () => ({ n: 0, from: 0, to: 0, any: 0, modes: new Float64Array(K), km: 0, kw: 0, cars: 0, people: 0 })
  const out = list.map(blank)
  for (const i of idx) {
    const a = of[c.f[i]]
    const b = of[c.t[i]]
    const w = c.w[i]
    const add = (k) => {
      const p = out[k]
      p.n += 1
      p.any += w
      p.modes[S.modeAt[c.m[i]]] += w
      if (c.km[i] != null) { p.km += c.km[i] * w; p.kw += w }
      if (c.o[i]) { p.people += c.o[i] * w; p.cars += w }
    }
    if (way === 'home') {
      const k = of[homeOf(c, i)]
      if (k >= 0) { out[k].from += a === k ? w : 0; out[k].to += b === k ? w : 0; add(k) }
      continue
    }
    if (a >= 0) { out[a].from += w; add(a) }
    if (b >= 0) { out[b].to += w; if (b !== a) add(b) }
  }
  return out
}

/** Between the picked place and every other; `way` as in touching(). */
export function perPartner(S, idx, picked, level, way) {
  const { list, of } = S.levels[level]
  const z = new Set(picked)
  const c = S.T.cols
  const size = list.length
  const w = new Float64Array(size)
  const n = new Int32Array(size)
  const out = new Map()      // ends off the map
  const add = (zone, i) => {
    const k = of[zone]
    if (k >= 0) { w[k] += c.w[i]; n[k] += 1; return }
    const o = out.get(zone) || { w: 0, n: 0 }
    o.w += c.w[i]
    o.n += 1
    out.set(zone, o)
  }
  for (const i of idx) {
    const home = way === 'home' ? homeOf(c, i) : null
    const f = z.has(c.f[i]) && (home == null || home === c.f[i])
    const t = z.has(c.t[i]) && (home == null || (home === c.t[i] && !f))
    if (f && way !== 'to') add(c.t[i], i)
    if (t && way !== 'from' && !(f && way === 'any')) add(c.f[i], i)
  }
  return { w, n, off: [...out].map(([zone, v]) => ({ ...S.Z.outside[zone - S.Z.count], ...v })) }
}

/** The busiest pairs of places, both directions together. */
export function pairs(S, idx, level, top = 40) {
  const { list, of } = S.levels[level]
  const c = S.T.cols
  const by = new Map()
  for (const i of idx) {
    let a = of[c.f[i]]
    let b = of[c.t[i]]
    if (a < 0 || b < 0 || a === b) continue
    if (a > b) [a, b] = [b, a]
    const k = a * 1000 + b
    const p = by.get(k) || { a, b, w: 0, n: 0, car: 0 }
    p.w += c.w[i]
    p.n += 1
    if (!S.freight && (S.modeAt[c.m[i]] === 2 || S.modeAt[c.m[i]] === 3)) p.car += c.w[i]
    by.set(k, p)
  }
  return [...by.values()].sort((x, y) => y.w - x.w).slice(0, top)
    .map((p) => ({ ...p, a: list[p.a], b: list[p.b] }))
}

// ------------------------------------------------------------------ the paint
// What a place's colour can mean. `v(p, sums)` is the value, `n` the trips it
// rests on; `share` ones are drawn 0-100%.
const modeShare = (of) => (_, s) => (s.any ? of.reduce((a, m) => a + s.modes[m], 0) / s.any : null)
export const PAINTS = {
  any: { label: 'Podróże', count: true, v: (_, s) => s.any },
  from: { label: 'Podróże zaczynane tutaj', count: true, v: (_, s) => s.from },
  to: { label: 'Podróże kończone tutaj', count: true, v: (_, s) => s.to },
  car: { label: 'Udział samochodu', share: true, v: modeShare(MAIN[0].of) },
  pt: { label: 'Udział transportu zbiorowego', share: true, v: modeShare(MAIN[1].of) },
  walk: { label: 'Udział pieszych', share: true, v: modeShare(MAIN[2].of) },
  bike: { label: 'Udział roweru i hulajnogi', share: true, v: modeShare(MAIN[3].of) },
  km: { label: 'Średnia długość podróży', unit: 'km', digits: 1, v: (_, s) => (s.kw ? s.km / s.kw : null) },
  inCar: { label: 'Osób w samochodzie', unit: 'os.', digits: 2, v: (_, s) => (s.cars ? s.people / s.cars : null) },
  jobs: { label: 'Miejsca pracy', count: true, fixed: true, v: (p) => p.jobs },
  pop: { label: 'Mieszkańcy', count: true, fixed: true, v: (p) => p.pop },
  asked: { label: 'Osoby przebadane', count: true, fixed: true, v: (p) => p.n },
}

// What a count is divided by. A place with hardly anyone in it has no rate.
export const FEW = 500
const people = (p) => (p.pop || 0) + (p.jobs || 0)
export const PER = {
  pop: { label: 'na mieszkańca', unit: 'na mieszkańca', many: 'na 1000 mieszkańców', digits: 2,
    of: (p) => (p.pop >= FEW ? p.pop : null) },
  abs: { label: 'liczba', unit: '', of: () => 1 },
  both: { label: 'na mieszkańca i miejsce pracy', unit: 'na mieszkańca i miejsce pracy',
    many: 'na 1000 mieszkańców i miejsc pracy', digits: 2, of: (p) => (people(p) >= FEW ? people(p) : null) },
  km2: { label: 'na km²', unit: 'na km²', of: (p) => p.km2 },
}
/** How a count is shown for a painting: residents per resident say nothing. */
export const perOf = (paint, per) => (paint === 'pop' && (per === 'pop' || per === 'both') ? 'km2' : per)

/** A share or a mean over fewer trips than this is not worth a colour. */
export const THIN = 20

// light on a dark map means more
const DARK = ['#12304f', '#1b4b7c', '#2768a8', '#3f8bd0', '#7bb4ea', '#c8e1fb']
const LIGHT = [...DARK].reverse()

/** Breaks for a set of values: about as many places in each, rounded; shares
 *  to whole twentieths. */
export function breaks(values, share) {
  const v = values.filter((x) => x != null && (share || x > 0)).sort((a, b) => a - b)
  if (v.length < 6) return v.slice(1)
  const q = [0.2, 0.4, 0.6, 0.8, 0.93].map((p) => v[Math.floor(p * (v.length - 1))])
  const round = (x) => {
    if (share) return Math.round(x * 20) / 20
    if (x <= 0) return 0
    const m = 10 ** Math.floor(Math.log10(x))
    return (Math.round((x / m) * 10) * m) / 10
  }
  return [...new Set(q.map(round))]
}

export function scale(br, dark = true, colors = dark ? DARK : LIGHT) {
  const pickOf = (i) => colors[Math.round((i * (colors.length - 1)) / Math.max(1, br.length))]
  return {
    color: (v) => { let i = 0; while (i < br.length && v >= br[i]) i++; return pickOf(i) },
    steps: [null, ...br].map((b, i) => ({ from: b, to: br[i] ?? null, color: pickOf(i) })),
  }
}

// ----------------------------------------------------------------- the tables
const H = (h) => (h == null ? '' : `${h}:00`)

/** One row per trip, for a list or a spreadsheet. */
export function tripRow(S, i) {
  const { T, Z } = S
  const c = T.cols
  const name = (k) => (k < Z.count ? Z.zones[k] : Z.outside[k - Z.count])
  return {
    i, from: name(c.f[i]), to: name(c.t[i]), hour: c.h[i], min: c.d[i], km: c.km[i],
    mode: T.modes[c.m[i]], modeAt: S.modeAt[c.m[i]], act: `${T.acts[c.a0[i]]} → ${T.acts[c.a1[i]]}`,
    inCar: c.o[i] || null, park: c.pk[i] < 0 ? '' : T.park[c.pk[i]], w: c.w[i],
  }
}

export function tripsTable(S, idx) {
  const { T } = S
  const c = T.cols
  return [
    ['skąd (rejon)', 'skąd', 'dokąd (rejon)', 'dokąd', 'godzina', 'czas [min]', 'odległość w linii prostej [km]',
      'środek transportu', 'początek', 'cel', 'osób w samochodzie', 'parkowanie', 'przesiadki',
      'wiek', 'zajęcie', 'samochody w domu', 'bilet okresowy', 'prawo jazdy', 'powód wyboru samochodu',
      'podróży na dobę (waga)'],
    ...idx.map((i) => {
      const r = tripRow(S, i)
      return [r.from.id, r.from.name, r.to.id, r.to.name, H(r.hour), r.min ?? '', r.km == null ? '' : num(r.km, 1),
        r.mode, T.acts[c.a0[i]], T.acts[c.a1[i]], r.inCar ?? '', r.park, c.x[i],
        T.ages[c.ag[i]], T.jobs[c.jb[i]], c.hc[i], c.ps[i] ? 'tak' : 'nie', c.lc[i] ? 'tak' : 'nie',
        c.y[i] < 0 ? '' : T.why[c.y[i]], r.w]
    }),
  ]
}

/** One row per place: what the map is painted from. */
export function placesTable(S, sums, level) {
  const { list } = S.levels[level]
  return [
    ['obszar', 'podróży w próbie', 'podróże/dobę', 'na mieszkańca',
      'zaczynane/dobę', 'kończone/dobę', ...S.main.map((m) => `% ${m.label}`),
      'śr. długość [km]', 'mieszkańcy', 'miejsca pracy', 'km²', 'osoby w badaniu'],
    ...list.map((p, k) => {
      const s = sums[k]
      return [placeName(p), s.n, num(s.any), p.pop >= FEW ? num(s.any / p.pop, 2) : '', num(s.from), num(s.to),
        ...S.main.map((m) => (s.any ? num((100 * m.of.reduce((a, x) => a + s.modes[x], 0)) / s.any, 1) : '')),
        s.kw ? num(s.km / s.kw, 1) : '', p.pop ?? '', p.jobs ?? '', num(p.km2, 2), p.n]
    }),
  ]
}
