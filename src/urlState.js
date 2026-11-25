import { dirKeys } from './data'
import { MOST } from './evaporation'

// The view lives in the address, so a link opens on the same node, period
// and settings - and on the same pieces left out of it. Only what differs
// from the defaults is written, which keeps a plain link plain.

const LIST = '|'

// A direction rides on its section's id, "R1_03B@W-E": the ">" of its key is
// not allowed in an address as it stands.
const pack = (id) => id.replace('>', '-')
const unpack = (id) => id.replace(/@([A-Z]+)-([A-Z]+)$/, '@$1>$2')

function selOf(kind, id) {
  const [at, dir] = id.split('@')
  return dir ? { kind, id: at, dir } : { kind, id }
}

// The survey views' settings. Filters read "mode:2.3|km:0.1": option numbers.
const ints = (s) => s.split('.').filter((x) => /^\d+$/.test(x)).map(Number)
// segments of a street mostly follow one another: 12-15.40
const spans = (s) => s.split('.').flatMap((p) => {
  const m = /^(\d+)(?:-(\d+))?$/.exec(p)
  if (!m) return []
  const [a, b] = [+m[1], +(m[2] ?? m[1])]
  return b >= a && b - a < 500 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []
})
const spanned = (list) => {
  const out = []
  for (const k of [...list].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && last[1] === k - 1) last[1] = k
    else out.push([k, k])
  }
  return out.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join('.')
}
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

function readTrip(q) {
  const f = {}
  for (const part of (q.get('f') || '').split(LIST)) {
    const [k, list] = part.split(':')
    if (k && list && ints(list).length) f[k] = ints(list)
  }
  return defined({
    set: q.get('set') === 'freight' ? 'freight' : undefined,
    level: ['d', 'z'].includes(q.get('lv')) ? q.get('lv') : undefined,
    paint: q.get('pt') || undefined,
    stat: (() => {
      const m = /^([a-z]+):([\d.]*)$/.exec(q.get('st') || '')
      return m ? { dim: m[1], opts: ints(m[2]) } : undefined
    })(),
    way: ['any', 'from', 'to'].includes(q.get('way')) ? q.get('way') : undefined,
    per: ['abs', 'both', 'km2'].includes(q.get('per')) ? q.get('per') : undefined,
    picked: q.has('z') ? q.get('z').split('.').filter(Boolean) : undefined,
    show: ['flows', 'trips', 'spots', 'days'].includes(q.get('sh')) ? q.get('sh') : undefined,
    names: q.get('nm') === '1' ? true : undefined,
    top: +q.get('top') >= 10 && +q.get('top') <= 300 ? +q.get('top') : undefined,
    rows: q.get('x') || undefined,
    split: q.get('y') || undefined,
    pattern: /^[0-5]+$/.test(q.get('day') || '') ? q.get('day') : undefined,
    filters: Object.keys(f).length ? f : undefined,
  })
}

function readAsk(q) {
  return defined({
    q: q.get('q') || undefined, opts: q.has('o') ? ints(q.get('o')) : undefined,
    group: q.get('g') || undefined,
    level: ['d', 'z', 'h'].includes(q.get('lv')) ? q.get('lv') : undefined,
    km: q.has('km') && +q.get('km') >= 0.5 && +q.get('km') <= 2.5 ? +q.get('km') : undefined,
    place: q.get('z') || undefined,
    raw: q.get('raw') === '1' ? true : undefined,
  })
}

function putTrip(q, t) {
  if (t.set !== 'people') q.set('set', t.set)
  if (t.level !== 'd') q.set('lv', t.level)
  if (t.paint !== 'any') q.set('pt', t.paint)
  if (t.paint === 'stat') q.set('st', `${t.stat.dim}:${t.stat.opts.join('.')}`)
  if (t.way !== 'home') q.set('way', t.way)
  if (t.per !== 'pop') q.set('per', t.per)
  if (t.picked.length) q.set('z', t.picked.join('.'))
  if (t.show !== 'areas') q.set('sh', t.show)
  if (t.names) q.set('nm', '1')
  if (t.top !== 60) q.set('top', String(t.top))
  if (t.rows !== 'km') q.set('x', t.rows)
  if (t.split !== 'mode') q.set('y', t.split)
  if (t.pattern) q.set('day', t.pattern)
  const f = Object.entries(t.filters).map(([k, v]) => `${k}:${v.join('.')}`)
  if (f.length) q.set('f', f.join(LIST))
}

function putAsk(q, a) {
  if (a.q !== 'tram') q.set('q', a.q)
  if (a.opts) q.set('o', a.opts.join('.'))
  if (a.group !== 'all') q.set('g', a.group)
  if (a.level !== 'd') q.set('lv', a.level)
  if (a.level === 'h' && a.km !== 1) q.set('km', String(a.km))
  if (a.place) q.set('z', a.place)
  if (a.raw) q.set('raw', '1')
}

/** What the address asks for; absent keys stay undefined. */
export function readHash(hash = window.location.hash) {
  const q = new URLSearchParams(hash.replace(/^#/, ''))
  const num = (k) => (q.has(k) && q.get(k) !== '' && !Number.isNaN(+q.get(k)) ? +q.get(k) : undefined)
  const flag = (k) => (q.has(k) ? q.get(k) === '1' : undefined)
  const range = /^(\d{1,2})-(\d{1,2})$/.exec(q.get('h') || '')
  const sel = /^([a-z]+):(.+)$/.exec(q.get('sel') || '')
  const lbl = q.get('lbl') || ''
  return {
    view: q.get('v') || undefined,
    range: range && +range[1] <= 23 && +range[2] <= 24 && range[1] !== range[2]
      ? [+range[1], +range[2]] : undefined,
    metric: q.get('m') || undefined,
    areas: q.has('a') ? q.get('a').split(LIST).filter(Boolean) : undefined,
    aggregate: flag('agg'),
    wholeDay: flag('wd'),
    roadPeople: flag('ppl'),
    occupancy: num('occ'),
    labels: q.has('lbl') || q.has('dc')
      ? { num: lbl.includes('n'), pct: lbl.includes('p'), declutter: q.get('dc') !== '0' }
      : undefined,
    basemap: q.get('bm') || undefined,
    survey: flag('srv'),
    net: q.get('net') || undefined,
    sig: q.get('sig') || undefined,
    sel: sel ? selOf(sel[1], unpack(sel[2])) : undefined,
    off: q.has('off') ? q.get('off').split(LIST).filter(Boolean).map(unpack) : undefined,
    by: q.get('by') || undefined,
    unit: q.get('u') || undefined,
    modes: q.has('md') ? q.get('md').split(LIST).filter(Boolean) : undefined,
    trip: q.get('v') === 'trips' ? readTrip(q) : undefined,
    ask: q.get('v') === 'answers' ? readAsk(q) : undefined,
    own: q.get('own') || undefined,
    closure: q.get('v') === 'closure' ? defined({
      closed: q.has('cx') ? spans(q.get('cx')) : undefined, narrow: q.has('cn') ? spans(q.get('cn')) : undefined,
      reduce: +q.get('cr') > 0 && +q.get('cr') <= MOST ? +q.get('cr') / 100 : undefined,
    }) : undefined,
  }
}

/** The address for a state, given the defaults it would otherwise take. */
export function hashOf(s, d) {
  const q = new URLSearchParams()
  const put = (k, v, def) => { if (v !== def && v != null) q.set(k, v) }
  put('v', s.view, d.view)
  if (s.range[0] !== d.range[0] || s.range[1] !== d.range[1]) q.set('h', s.range.join('-'))
  put('m', s.metric, d.metric)
  if (s.areas) q.set('a', s.areas.join(LIST))
  if (s.aggregate !== d.aggregate) q.set('agg', s.aggregate ? '1' : '0')
  if (s.wholeDay) q.set('wd', '1')
  if (s.roadPeople !== d.roadPeople) q.set('ppl', s.roadPeople ? '1' : '0')
  if (s.occupancy != null && Math.abs(s.occupancy - d.occupancy) > 1e-9) {
    q.set('occ', String(Math.round(s.occupancy * 1000) / 1000))
  }
  const lbl = `${s.labels.num ? 'n' : ''}${s.labels.pct ? 'p' : ''}`
  if (lbl) q.set('lbl', lbl)
  if (!s.labels.declutter) q.set('dc', '0')
  put('bm', s.basemap, d.basemap)
  if (s.survey) q.set('srv', '1')
  if (s.net.on) q.set('net', s.net.mode)
  if (s.sig.on) q.set('sig', s.sig.filter)
  if (s.selected) {
    const { kind, id, dir } = s.selected
    q.set('sel', `${kind}:${id}${dir ? `@${pack(dir)}` : ''}`)
  }
  if (s.off.size) q.set('off', [...s.off].sort().map(pack).join(LIST))
  put('by', s.flow.by, d.flow.by)
  put('u', s.flow.unit, d.flow.unit)
  if (s.flow.modes) q.set('md', s.flow.modes.join(LIST))
  if (s.view === 'trips' && s.trip) putTrip(q, s.trip)
  if (s.view === 'answers' && s.ask) putAsk(q, s.ask)
  if (s.view === 'closure' && s.closure) {
    if (s.closure.closed.length) q.set('cx', spanned(s.closure.closed))
    if (s.closure.narrow.length) q.set('cn', spanned(s.closure.narrow))
    if (s.closure.reduce) q.set('cr', String(Math.round(100 * s.closure.reduce)))
  }
  if (s.own) q.set('own', s.own)
  // ':' '|' and ',' are fine in a fragment; left unescaped the link stays readable
  const out = q.toString().replace(/%3A/gi, ':').replace(/%7C/gi, '|').replace(/%2C/gi, ',')
    .replace(/%40/gi, '@')
  return out ? `#${out}` : ''
}

const SOURCE = { road: 'points', pt: 'pt', bike: 'bike', ped: 'ped', rail: 'rail' }

/** The record a linked selection names: a drawn marker, a raw section, or a
 *  signal by its position. Null when the data has no such thing. */
export function findSelection(data, index, { kind, id, dir }) {
  const m = index[`${kind}:${id}`]
  const at = (ref) => (dir && !ref.aggregate && dirKeys(data, kind, ref).includes(dir)
    ? { kind, id, ref, dir } : { kind, id, ref })
  if (m) return at(m.ref)
  if (kind === 'signal') {
    const s = data.signals?.junctions.find((j) => `${j.lat},${j.lon}` === id)
    return s ? { kind, id, ref: s } : null
  }
  const ref = SOURCE[kind] && data[SOURCE[kind]].find((x) => x.id === id)
  return ref ? at(ref) : null
}
