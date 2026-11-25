import { dirKeys } from './data'

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
