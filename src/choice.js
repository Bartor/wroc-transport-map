// What slower cars or quicker transit would do to the shares: the mode-choice
// model of etl/choice.py, run on whatever trips the page has filtered.
//
// The model is a nested logit. It says how much shares respond; the shares
// themselves are the survey's, so "before" is always exactly what was observed
// and only the change is modelled.
//
//   const model = prepare(choiceJson)
//   scenario(model, trips, { carMinCore: 5, ptMin: -3, scope: 'into' })

export const ALTS = ['walk', 'bike', 'car', 'pt']
const [WALK, BIKE, CAR, PT] = [0, 1, 2, 3]
const NONE = 'other'

/** The file, with its tables indexed. */
export function prepare(choice) {
  const zone = new Map(choice.zones.map((z, i) => [z, i]))
  const at = new Map()
  choice.los.from.forEach((f, i) => {
    const to = new Map()
    choice.los.to[i].forEach((t, j) => to.set(t, [
      choice.los.car[i][j] / 10, choice.los.dist[i][j] * 10, choice.los.pt[i][j] / 10,
    ]))
    at.set(f, to)
  })
  const index = Object.fromEntries(choice.names.map((n, i) => [n, i]))
  return {
    choice, zone, at,
    core: new Set(choice.core),
    terms: choice.terms.map(([n, a, v]) => [index[n], ALTS.indexOf(a), v]),
    ride: index.ride,
    ages: choice.ages,
  }
}

/** The zone pair's minutes in a car, metres, and transit minutes as felt; null off the map. */
export function los(model, from, to) {
  const pair = model.at.get(model.zone.get(String(from)))?.get(model.zone.get(String(to)))
  return pair ? { car: pair[0], dist: pair[1], pt: pair[2] < 0 ? null : pair[2] } : null
}

const inCore = (model, z) => model.core.has(String(z))

/** The trip's mode as the model names it; taxis and motorcycles count as "other". */
export const modeOf = (model, mode) => (ALTS.includes(mode) ? mode : model.choice.modes[mode] || NONE)

const groupOf = (model, purpose) => model.choice.purposes[purpose] || purpose

/** What each alternative is worth to one trip, as [[coefficient index, alt, value]]. */
function rowOf(model, t) {
  const l = los(model, t.from, t.to)
  if (!l) return null
  const { meta } = model.choice
  const walk = l.dist / meta.walk / 60
  const age = typeof t.age === 'number' ? t.age : Math.max(0, model.ages.indexOf(t.age))
  const v = {
    one: 1, walk, walkOver12: Math.max(0, walk - 12), walkOver25: Math.max(0, walk - 25),
    logWalk: Math.log(walk + 1), bike: l.dist / meta.bike / 60, car: l.car,
    gjt: l.pt ?? 0, lkm: Math.log(l.dist / 1000 + 0.5),
    core: inCore(model, t.from) || inCore(model, t.to) ? 1 : 0,
    sub: String(t.from).length > 3 || String(t.to).length > 3 ? 1 : 0,
    [`age${age}`]: 1, [groupOf(model, t.purpose)]: 1,
    cars0: t.cars === 0 ? 1 : 0, cars2: t.cars >= 2 ? 1 : 0,
    licence: t.licence ? 1 : 0, pass: t.pass ? 1 : 0,
  }
  const x = []
  for (const [i, a, name] of model.terms) if (v[name]) x.push([i, a, v[name]])
  return {
    x,
    ok: [l.dist <= meta.maxWalk, l.dist <= meta.maxBike, true, l.pt != null],
  }
}

/** A nested logit's shares; walking and transit share a nest. */
export function shares(util, ok, lambda) {
  const e = util.map((u, i) => (ok[i] ? u : -Infinity))
  const inner = [WALK, PT].map((i) => e[i] / lambda)
  const top = Math.max(...inner)
  const nest = Number.isFinite(top)
    ? top + Math.log(inner.reduce((a, x) => a + Math.exp(x - top), 0)) : -Infinity
  const levels = [e[BIKE], e[CAR], lambda * nest]
  const max = Math.max(...levels)
  const exp = levels.map((x) => Math.exp(x - max))
  const sum = exp[0] + exp[1] + exp[2]
  const [bike, car, both] = exp.map((x) => x / sum)
  const part = (i) => (Number.isFinite(e[i]) ? both * Math.exp(e[i] / lambda - nest) : 0)
  return [part(WALK), bike, car, part(PT)]
}

/** What the scenario adds to a trip, in minutes of the model's: [car, transit]. */
function added(model, t, s) {
  const from = inCore(model, t.from)
  const to = inCore(model, t.to)
  const touches = from || to
  const scope = s.scope || 'all'
  const on = scope === 'all' || (scope === 'core' && touches) || (scope === 'into' && to && !from)
  const car = (on ? s.carMin || 0 : 0) + (touches ? s.carMinCore || 0 : 0)
  const pt = on ? (s.ptMin || 0) + model.choice.meta.weights.wait * (s.ptWait || 0) : 0
  return [car, pt]
}

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const k = Math.floor(i)
  return s[k] + (i - k) * ((s[k + 1] ?? s[k]) - s[k])
}

/**
 * Shares before and after.
 *
 * s: carMin, ptMin (riding), ptWait (waiting) - minutes added to trips in
 * `scope`: 'all', 'core' (an end in the core) or 'into' (ending there, from
 * elsewhere); carMinCore - minutes for cars with an end in the core, whatever
 * the scope. Negative is quicker.
 *
 * trips: { from, to, mode, purpose, cars, age, pass, licence, w }. A trip off
 * the model's map, or made some other way, stays as it was. The intervals are
 * the model's coefficients' uncertainty (90%) and leave out how many trips the
 * filter left: say n beside them.
 *
 * lo and hi bound the change by the sample (90%); spread by the model: the same
 * change under the specifications in etl/choice.py, which the sample can't tell
 * apart. Show the wider of the two. carTrips is trips a day, on the weights.
 */
export function scenario(model, trips, s) {
  const { coef, draws } = model.choice
  const total = trips.reduce((a, t) => a + t.w, 0)
  const obs = [0, 0, 0, 0]          // the modelled part
  let fixed = 0                      // and what stays put, in trips of any mode
  const still = { [NONE]: 0, walk: 0, bike: 0, car: 0, pt: 0 }
  // only trips the scenario touches can change; the rest are their own answer
  const touched = []
  let n = 0
  for (const t of trips) {
    const mode = modeOf(model, t.mode)
    const row = mode === NONE ? null : rowOf(model, t)
    if (!row) {
      still[mode] += t.w
      fixed += t.w
      continue
    }
    n += 1
    obs[ALTS.indexOf(mode)] += t.w
    const [car, pt] = added(model, t, s)
    if (car || pt) touched.push({ ...row, w: t.w, car, pt, mode: ALTS.indexOf(mode) })
  }
  const response = (th) => {
    const lambda = th[th.length - 1]
    const base = [0, 0, 0, 0]
    const shift = [0, 0, 0, 0]
    for (const r of touched) {
      const u = [0, 0, 0, 0]
      for (const [i, a, v] of r.x) u[a] += th[i] * v
      const p = shares(u, r.ok, lambda)
      u[CAR] += th[model.ride] * r.car
      u[PT] += th[model.ride] * r.pt
      const q = shares(u, r.ok, lambda)
      for (let j = 0; j < 4; j++) {
        base[j] += r.w * p[j]
        shift[j] += r.w * q[j]
      }
    }
    return [base, shift]
  }
  // untouched trips keep their observed mode, so only the touched ones pivot
  const obsTouched = [0, 0, 0, 0]
  for (const r of touched) obsTouched[r.mode] += r.w
  const kept = obs.map((o, i) => o - obsTouched[i])
  const after = (th) => {
    const [base, shift] = response(th)
    const raw = obsTouched.map((o, i) => (base[i] > 0 ? (o * shift[i]) / base[i] : o))
    const sum = raw.reduce((a, b) => a + b, 0)
    const want = obsTouched.reduce((a, b) => a + b, 0)
    return raw.map((x, i) => kept[i] + (sum ? (x * want) / sum : 0))
  }
  const named = (xs) => Object.fromEntries(ALTS.map((a, i) => [a, total ? xs[i] / total : 0]))
  const main = after(coef)
  const each = touched.length ? draws.map(after) : []
  const others = touched.length ? Object.values(model.choice.variants || {}).map(after) : []
  // what stays put is part of every share
  const add = (xs) => xs.map((x, i) => x + still[ALTS[i]])
  const before = named(add(obs))
  const now = named(add(main))
  const bound = (q) => named(ALTS.map((_, i) => (each.length
    ? quantile(each.map((d) => d[i] - obs[i]), q) : 0)))
  const lo = bound(0.05)
  const hi = bound(0.95)
  const delta = Object.fromEntries(ALTS.map((a) => [a, now[a] - before[a]]))
  const moves = [main, ...others].map((d) => d.map((x, i) => x - obs[i]))
  const spread = Object.fromEntries(ALTS.map((a, i) => [a, [
    Math.min(...moves.map((m) => m[i])) / (total || 1), Math.max(...moves.map((m) => m[i])) / (total || 1)]]))
  return {
    n, total, modelled: total ? 1 - fixed / total : 0,
    before, after: now, delta, lo, hi, spread,
    other: total ? still[NONE] / total : 0,
    carTrips: { before: before.car * total, after: now.car * total },
    beyond: [s.carMin, s.carMinCore, s.ptMin, s.ptWait]
      .some((m) => Math.abs(m || 0) > model.choice.meta.range),
  }
}
