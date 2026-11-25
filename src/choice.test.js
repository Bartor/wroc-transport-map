import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALTS, los, modeOf, prepare, scenario, shares } from './choice'

// A city of two zones: "1" in the core and "20" outside it, ten minutes by car,
// 4 km, twenty felt minutes by tram. Only time and a constant matter.
const choice = {
  meta: { walk: 1.3, bike: 3.9, maxWalk: 8000, maxBike: 25000, range: 10, weights: { wait: 1.5 } },
  modes: { pieszo: 'walk', rower: 'bike', 'komunikacja samochodowa': 'car', 'komunikacja zbiorowa': 'pt' },
  purposes: { 'dom - praca': 'work' },
  ages: ['6–15', '16–24', '25–44', '45–64', '65+'],
  core: ['1'],
  names: ['ride', 'asc.pt', 'cars0.pt', 'walk'],
  terms: [['ride', 'car', 'car'], ['ride', 'pt', 'gjt'], ['asc.pt', 'pt', 'one'],
    ['cars0.pt', 'pt', 'cars0'], ['walk', 'walk', 'walk']],
  coef: [-0.03, -0.2, 1.5, -0.1, 0.5],
  draws: [[-0.02, -0.2, 1.5, -0.1, 0.5], [-0.04, -0.2, 1.5, -0.1, 0.5]],
  variants: { plain: [-0.06, -0.2, 1.5, -0.1, 1] },
  zones: ['1', '20', '300'],
  los: {
    from: [0, 1], to: [[1, 2], [0]], car: [[100, 100], [100]], dist: [[400, 400], [400]],
    pt: [[200, -1], [200]],
  },
}
const model = prepare(choice)
const trip = (o) => ({
  from: '20', to: '1', mode: 'car', purpose: 'dom - praca', cars: 1, age: '25–44',
  pass: false, licence: true, w: 10, ...o,
})
const four = [trip({}), trip({ mode: 'pt', w: 6 }), trip({ mode: 'walk', w: 2 }), trip({ mode: 'bike', w: 2 })]
const sum = (o) => ALTS.reduce((a, k) => a + o[k], 0)

describe('level of service', () => {
  it('reads minutes and metres, and null where there is none', () => {
    expect(los(model, '20', '1')).toEqual({ car: 10, dist: 4000, pt: 20 })
    expect(los(model, '1', '300').pt).toBe(null)
    expect(los(model, '300', '1')).toBe(null)
    expect(los(model, '999', '1')).toBe(null)
  })
  it('takes the survey\'s names for modes', () => {
    expect(modeOf(model, 'pieszo')).toBe('walk')
    expect(modeOf(model, 'car')).toBe('car')
    expect(modeOf(model, 'inne')).toBe('other')
  })
})

describe('shares', () => {
  it('sum to one, and an unavailable mode has none', () => {
    const p = shares([0, 0.2, 0.4, 0.6], [true, true, true, true], 0.5)
    expect(p.reduce((a, b) => a + b)).toBeCloseTo(1, 12)
    expect(shares([0, 0, 0, 0], [true, true, true, false], 0.5)[3]).toBe(0)
    expect(shares([0, 0, 0, 0], [false, false, true, false], 0.5)).toEqual([0, 0, 1, 0])
  })
  it('are a plain logit when the nest is as large as the rest', () => {
    const u = [0.1, -0.4, 0.7, 0.2]
    const e = u.map(Math.exp)
    const s = e.reduce((a, b) => a + b)
    shares(u, [true, true, true, true], 1).forEach((x, i) => expect(x).toBeCloseTo(e[i] / s, 12))
  })
  it('draw more from the nest mate than from the rest', () => {
    const at = (pt) => shares([0, 0, 0, pt], [true, true, true, true], 0.5)
    const [a, b] = [at(0), at(-0.5)]
    expect((b[0] - a[0]) / a[0]).toBeGreaterThan((b[2] - a[2]) / a[2])
  })
})

describe('scenario', () => {
  it('starts from what was observed, whatever the model says', () => {
    const r = scenario(model, four, { carMin: 5, scope: 'all' })
    expect(r.before).toEqual({ walk: 0.1, bike: 0.1, car: 0.5, pt: 0.3 })
    expect(sum(r.after)).toBeCloseTo(1, 12)
  })
  it('changes nothing when nothing changes', () => {
    const r = scenario(model, four, { scope: 'all' })
    expect(r.after).toEqual(r.before)
    expect(r.lo).toEqual({ walk: 0, bike: 0, car: 0, pt: 0 })
  })
  it('moves people out of slower cars and into quicker trams', () => {
    const car = scenario(model, four, { carMin: 5, scope: 'all' })
    const pt = scenario(model, four, { ptMin: -5, scope: 'all' })
    const wait = scenario(model, four, { ptWait: -5, scope: 'all' })
    expect(car.delta.car).toBeLessThan(0)
    expect(car.delta.pt).toBeGreaterThan(0)
    expect(pt.delta.pt).toBeGreaterThan(0)
    expect(wait.delta.pt).toBeGreaterThan(pt.delta.pt)
    expect(car.lo.car).toBeLessThanOrEqual(car.delta.car)
    expect(car.hi.car).toBeGreaterThanOrEqual(car.delta.car)
    expect(car.spread.car[0]).toBeLessThan(car.delta.car)   // the plain logit moves more
  })
  it('keeps to its scope', () => {
    const away = four.map((t) => ({ ...t, from: '1', to: '20' }))
    expect(scenario(model, away, { carMin: 5, scope: 'into' }).delta.car).toBe(0)
    expect(scenario(model, away, { carMin: 5, scope: 'core' }).delta.car).toBeLessThan(0)
    expect(scenario(model, away, { carMinCore: 5, scope: 'into' }).delta.car).toBeLessThan(0)
  })
  it('leaves trips it has no model for as they were', () => {
    const off = [...four, trip({ from: '999', w: 20 }), trip({ mode: 'inne', w: 10 })]
    const r = scenario(model, off, { carMin: 5, scope: 'all' })
    expect(r.n).toBe(4)
    expect(r.before.car).toBeCloseTo(30 / 50, 12)
    expect(r.other).toBeCloseTo(0.2, 12)
    const half = scenario(model, four, { carMin: 5, scope: 'all' })
    expect(r.delta.car * 50).toBeCloseTo(half.delta.car * 20, 9)
  })
  it('says when the minutes are further than the survey reaches', () => {
    expect(scenario(model, four, { carMin: 11 }).beyond).toBe(true)
    expect(scenario(model, four, { carMin: 10 }).beyond).toBe(false)
  })
})

const FILE = 'public/data/choice.json'
describe.runIf(existsSync(FILE))('the published file', () => {
  it('has a coefficient for every name, and the draws to go with them', () => {
    const c = JSON.parse(readFileSync(FILE, 'utf8'))
    expect(c.coef).toHaveLength(c.names.length + 1)
    for (const d of [...c.draws, ...Object.values(c.variants)]) expect(d).toHaveLength(c.names.length + 1)
    expect(c.coef[c.names.indexOf('ride')]).toBeLessThan(0)
    const m = prepare(c)
    const o = c.zones[c.los.from[0]]
    const l = los(m, o, c.zones[c.los.to[0][0]])
    expect(l.car).toBeGreaterThan(0)
  })
})
