// Directions as things of their own, and traffic split the way the reader asks:
// by section, direction, mode or line, in people, vehicles or car units.
import { cameFrom, csvNumber, dirLabel, pieceKey, shade } from '@bartor-net/ui-kit'
import {
  LAYERS, MODES, MODE, PCU, dirKeys, sectionLetter, sectionOf, sumHours,
} from './data'

// ---------------------------------------------------------------- directions
const TO = {
  N: 'północ', S: 'południe', E: 'wschód', W: 'zachód', NE: 'północny wschód',
  NW: 'północny zachód', SE: 'południowy wschód', SW: 'południowy zachód',
}

/** "W>E" -> "na wschód (W → E)". */
export function dirName(dir) {
  const to = TO[dir.split('>')[1]]
  const key = dir.replace('>', ' → ')
  return to ? `na ${to} (${key})` : key
}

/** Key of one direction of a section, among the pieces left out of a node. */
export const dirPieceKey = (id, dir) => pieceKey('road', `${id}@${dir}`)

/** The directions left out of a section that is otherwise in. */
export const leftDirs = (data, off, id) => dirKeys(data, 'road', { id })
  .filter((d) => off.has(dirPieceKey(id, d)))

const keep = (obj, test) => Object.fromEntries(Object.entries(obj || {}).filter(([d]) => test(d)))

/** The data without the directions left out: everything counted from it
 *  follows. Sections wholly left out are handled by their nodes. */
export function withoutDirs(data, off) {
  const cut = {}
  for (const k of off) {
    const m = /^road:([^@]+)@(.+)$/.exec(k)
    if (m) (cut[m[1]] ||= new Set()).add(m[2])
  }
  const ids = Object.keys(cut).filter((id) => data.road.sections[id])
  if (!ids.length) return data
  const roadById = { ...data.road.sections }
  for (const id of ids) {
    const s = roadById[id]
    const test = (d) => !cut[id].has(d)
    roadById[id] = { ...s, dirs: keep(s.dirs, test), off: keep(s.off, test) }
  }
  return { ...data, roadById }
}

/** The data with nothing left out. */
export const whole = (data) => (data.roadById === data.road.sections
  ? data : { ...data, roadById: data.road.sections })

/** One direction of a section as if it were all of it: the data to count it
 *  from, and its record. Null when the section has no such direction. */
export function onlyDir(data, kind, ref, dir) {
  if (!dir || !dirKeys(data, kind, ref).includes(dir)) return null
  if (kind === 'road') {
    const s = data.road.sections[ref.id]
    const test = (d) => d === dir
    const one = { ...s, dirs: keep(s.dirs, test), off: keep(s.off, test) }
    const total = one.dirs[dir].h.reduce((a, row) => a + row.reduce((x, v) => x + v, 0), 0)
    return {
      data: { ...data, roadById: { ...data.road.sections, [ref.id]: one } },
      ref: { ...ref, total },
    }
  }
  const raw = Object.keys(ref.byHourDir).find((d) => cameFrom(d) === dir)
  const byHour = ref.byHourDir[raw]
  return {
    data,
    ref: { ...ref, byHour, byHourDir: { [raw]: byHour }, total: byHour.reduce((a, v) => a + v, 0) },
  }
}

// --------------------------------------------------------------------- flows
export const BY = {
  section: { label: 'Przekroje', of: 'przekrojów', after: 'po przekrojach' },
  dir: { label: 'Kierunki', of: 'kierunków', after: 'po kierunkach' },
  mode: { label: 'Środki transportu', of: 'środków transportu', after: 'po środkach transportu' },
  line: { label: 'Linie', of: 'linii', after: 'po liniach' },
  way: { label: 'Do / z centrum', of: 'kierunków wobec centrum', after: 'do i z centrum' },
}

/** What each layer can be split by. */
export const BY_OF = {
  road: ['section', 'dir', 'way', 'mode'],
  pt: ['section', 'mode', 'dir', 'line'],
  bike: ['section', 'dir'],
  ped: ['section', 'dir'],
}

export const UNITS = {
  persons: { label: 'osoby', many: 'osób' },
  vehicles: { label: 'pojazdy', many: 'pojazdów' },
  pcu: {
    label: 'poj. umowne', many: 'pojazdów umownych',
    title: 'pojazdy umowne: zajęcie przepustowości jezdni (WR-D-13, tab. 4.3.1)',
  },
}

export const FLOW0 = { by: 'section', unit: 'persons', modes: null }

// Towards the centre or away: told by the survey on the two cordons, by the
// compass elsewhere; a road that runs around the centre is neither.
export const WAYS = {
  in: { label: 'Do centrum', color: '#e4572e' },
  out: { label: 'Z centrum', color: '#3987e5' },
  across: { label: 'W poprzek lub nieokreślone', color: '#6b7385' },
}
const wayOf = (data, id, dir) => data.ways?.[id]?.[dir]?.[0] || 'across'
export const hasWays = (data, refs) => refs.some((r) => data.ways?.[r.id])
/** Whether the survey itself says which way the section's directions go. */
export const waysTold = (data, refs) => refs.every((r) => !data.ways?.[r.id]
  || Object.values(data.ways[r.id]).every((w) => w[1]))

const day = () => new Array(24).fill(0)

/**
 * Road counts as rows by section, direction and mode: 24 hourly vehicles, and
 * the same in passenger car units. `cats` limits the vehicle categories; bikes
 * counted beside the road belong to their mode, and take no room on it, unless
 * `roadway` leaves them out.
 */
export function roadFlows(data, refs, { cats = null, roadway = false } = {}) {
  const ci = Object.fromEntries(data.meta.vehCatOrder.map((c, i) => [c, i]))
  const oi = Object.fromEntries(data.meta.offCatOrder.map((c, i) => [c, i]))
  const out = []
  for (const ref of refs) {
    const s = data.roadById[ref.id]
    if (!s) continue
    for (const dir of new Set([...Object.keys(s.dirs), ...(roadway ? [] : Object.keys(s.off || {}))])) {
      for (const m of MODES) {
        const use = cats ? m.cats.filter((c) => cats.includes(c)) : m.cats
        if (!use.length) continue
        const veh = day()
        const pcu = day()
        for (let h = 0; h < 24; h++) {
          const row = s.dirs[dir]?.h[h]
          for (const c of use) {
            veh[h] += row?.[ci[c]] || 0
            pcu[h] += (row?.[ci[c]] || 0) * PCU[c]
          }
          if (m.off && !roadway) for (const c of m.off) veh[h] += s.off?.[dir]?.[h]?.[oi[c]] || 0
        }
        if (veh.some(Boolean)) out.push({ ref, dir, mode: m.key, way: wayOf(data, ref.id, dir), vehicles: veh, pcu })
      }
    }
  }
  return out
}

const TRACTION = { tramwaj: 'tram' }
const tractionMode = (t) => TRACTION[t] || 'bus'

/** Stop counts as rows by pole, and by mode, destination or line. Vehicles are
 *  recorded by mode alone. */
export function stopFlows(refs, by) {
  const field = { dir: 'byHourDir', line: 'byHourLine' }[by]
  return refs.flatMap((ref) => (field
    ? Object.entries(ref[field] || {}).map(([key, arr]) => ({ ref, [by]: key, persons: arr }))
    : Object.entries(ref.byHour || {}).map(([t, arr]) => ({
      ref, mode: tractionMode(t), persons: arr, vehicles: ref.vehByHour?.[t] || day(),
    }))))
}

/** Bike and pedestrian counts as rows by section and direction. */
export const walkFlows = (refs, by) => refs.flatMap((ref) => (by === 'dir' && ref.byHourDir
  ? Object.entries(ref.byHourDir).map(([d, arr]) => ({ ref, dir: cameFrom(d), persons: arr }))
  : [{ ref, persons: ref.byHour }]))

/** People in a vehicle of each mode: only drivers where nobody asked. */
export const perVehicle = ({ occupancy, load }) => ({
  car: occupancy, goods: 1, bus: load?.bus ?? 0, tram: load?.tram ?? 0, bike: 1, other: 1,
})

const add = (into, arr, k = 1) => { arr.forEach((v, h) => { into[h] += v * k }) }

/** A row's hours in a unit. */
export function inUnit(row, unit, persons) {
  if (unit !== 'persons') return row[unit] || day()
  return row.persons || row.vehicles.map((v) => v * persons[row.mode])
}

const TOP = 6      // destinations and lines named; the rest is one piece
const REST = 'inne'

/**
 * Rows as the pieces of a chart, split `by` something, in a unit. Pieces carry
 * what they stand for, so the chart, the tree and the map light each other up:
 * a section, a direction of one, or a mode.
 *
 * `isOut` says which pieces are left out of the node; `hours` decide which
 * destinations and lines are big enough to be named.
 */
export function flowPieces(rows, {
  kind, by, unit, persons, hours, isOut = () => false,
}) {
  const groups = new Map()
  for (const r of rows) {
    const key = { section: r.ref.id, dir: kind === 'pt' ? r.dir : `${r.ref.id}@${r.dir}`,
      mode: r.mode, line: r.line, way: r.way }[by]
    if (!groups.has(key)) groups.set(key, { id: key, row: r, values: day() })
    add(groups.get(key).values, inUnit(r, unit, persons))
  }
  let list = [...groups.values()]
  if (by === 'mode') {
    const order = MODES.map((m) => m.key)
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  }
  if (by === 'way') {
    const order = Object.keys(WAYS)
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  }
  if (by === 'line' || (by === 'dir' && kind === 'pt')) {
    const size = (g) => (g.id === REST ? -1 : sumHours(g.values, hours))
    list.sort((a, b) => size(b) - size(a))
    const rest = list.filter((g, i) => i >= TOP || g.id === REST)
    if (rest.length) {
      const sum = { id: REST, row: {}, values: day() }
      for (const g of rest) add(sum.values, g.values)
      list = [...list.filter((g) => !rest.includes(g)), sum]
    }
  }
  const color = LAYERS[kind].color
  return list.map((g, i) => {
    const { ref, dir } = g.row
    // some points of the outer cordon have no street, only a stretch of road
    const named = (x) => (x && x !== '-' ? x : null)
    const street = ref && (named(kind === 'road' ? ref.name : sectionOf(kind, ref))
      || named(ref.name) || ref.segment)
    const letter = ref && (sectionLetter(ref.id) || ref.id)
    const base = { id: g.id, values: g.values, fill: shade(color, i) }
    if (by === 'section') {
      return {
        ...base, letter, name: street, ref, hot: { kind, id: ref.id }, out: isOut(ref),
        label: `${letter} — ${sectionOf(kind, ref) || ref.name}`,
      }
    }
    if (by === 'mode') {
      return { ...base, name: MODE[g.id].label, label: MODE[g.id].label, fill: MODE[g.id].color,
        mode: g.id, hot: { kind: 'mode', id: g.id } }
    }
    if (by === 'way') {
      return { ...base, name: WAYS[g.id].label, label: WAYS[g.id].label, fill: WAYS[g.id].color,
        hot: { kind: 'way', id: g.id } }
    }
    if (by === 'dir' && kind !== 'pt') {
      return {
        ...base, letter, name: `${dirLabel(dir)} · ${street}`, ref, dir,
        hot: { kind, id: ref.id, dir }, out: isOut(ref, dir),
        label: `${letter} ${dirLabel(dir)} — ${street}`,
      }
    }
    return { ...base, name: g.id, label: g.id, hot: { kind: by, id: g.id } }
  })
}

/** The hours of some pieces as a table: one row an hour, a column a piece. */
export const flowTable = (pieces, unit) => {
  const on = pieces.filter((p) => !p.out)
  return [
    ['godzina', ...on.map((p) => `${p.label} [${unit}]`), `razem [${unit}]`],
    ...Array.from({ length: 24 }, (_, h) => [
      `${h}:00`, ...on.map((p) => csvNumber(p.values[h], 1)),
      csvNumber(on.reduce((a, p) => a + p.values[h], 0), 1),
    ]),
  ]
}

export const MODE_SHORT = {
  car: 'samochody', goods: 'dostawcze i ciężarowe', bus: 'autobusy', tram: 'tramwaje',
  bike: 'rowery', other: 'inne',
}

/** Which modes are counted, after a unit: ": autobusy, tramwaje", or the few
 *  that are not; empty when all are. */
export function modesText(modes) {
  if (!modes) return ''
  const names = (list) => list.map((m) => MODE_SHORT[m.key]).join(', ')
  const no = MODES.filter((m) => !modes.includes(m.key))
  return no.length < modes.length && no.length < 3 ? ` oprócz: ${names(no)}`
    : `: ${names(MODES.filter((m) => modes.includes(m.key)))}`
}
