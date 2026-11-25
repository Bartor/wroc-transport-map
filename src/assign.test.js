import { describe, expect, it } from 'vitest'
import { byStreet, load, onSegment, run, settle, unpackTrips, wobble } from './assign'

// A to B by a short street or a long way round; C hangs off the long way:
//
//   A --0 Krótka-- B
//   A --1 Długa--  C --2 Długa-- B
const JSON1 = (over = {}) => ({
  meta: { params: { alpha: 0.8, noise: 0.2, looks: 6, heed: 0.01 } },
  names: ['', 'Krótka', 'Długa'], classes: ['primary'],
  nodes: { lat: [5100000, 0, 100], lon: [1700000, 100, -50] },
  segs: {
    u: [0, 0, 2], v: [1, 2, 1], open: [3, 3, 3], tf: [600, 900, 900], tb: [600, 900, 900],
    cap: [4000, 4000, 4000], len: [500, 700, 700], name: [1, 2, 2], cls: [0, 0, 0],
    mid: [0, 1, 0], geom: [50, 10],
  },
  zones: { nodes: [0, 1, 2], off: [0, 1, 1, 1] },
  od: [-1, 10000, 100, 5000, -3, 100, -1],
  base: [0, 0, 0, 0, 0, 0],
  ...over,
})

/** The model with its own undisturbed traffic as the base. */
function ready(over) {
  const m = load(JSON1(over))
  m.base = settle(m, m.trips, 48)
  return m
}

describe('closure model', () => {
  it('reads trips packed as tenths and runs of nothing', () => {
    expect([...unpackTrips([-1, 10000, 100, 5000, -3, 100, -1], 3)])
      .toEqual([0, 1000, 10, 500, 0, 0, 0, 10, 0])
  })

  it('rebuilds geometry from node ends and steps', () => {
    const m = load(JSON1())
    expect(m.segments[1].path).toEqual([[51, 17], [51.0005, 17.0001], [51.001, 17.0005]])
    expect(m.segments[1].name).toBe('Długa')
  })

  it('looks at the streets the same way every time', () => {
    const a = wobble(1000, new Float64Array(4))
    expect([...a]).toEqual([...wobble(1000, new Float64Array(4))])
    // what etl/closure.py draws
    expect(a[0]).toBeCloseTo(0.59038981, 8)
    expect(a[3]).toBeCloseTo(0.76115043, 8)
  })

  it('sends every trip somewhere', () => {
    const { base } = ready()
    // all out of A: to B 1000, to C 10
    expect(base[0] + base[2]).toBeCloseTo(1010, 6)
    // all into A: from B 500
    expect(base[1] + base[3]).toBeCloseTo(500, 6)
  })

  it('moves a shut street onto the way round, all of it', () => {
    const m = ready()
    const { before, after, summary } = run(m, { closed: [0] })
    expect(onSegment(before, 0)).toBeGreaterThan(1000)
    expect(onSegment(after, 0)).toBe(0)
    expect(after[2]).toBeCloseTo(1010, 6)
    // past C: all but the ten who stop there, and ten more who start there
    expect(after[4]).toBeCloseTo(1010 - 10 + 10, 6)
    expect(summary.lost).toBe(0)
    expect(summary.gone).toBe(0)
    expect(summary.affected).toBeCloseTo(1500, 0)
    expect(summary.after.vehKm).toBeGreaterThan(summary.before.vehKm)
    expect(summary.after.vehHours).toBeGreaterThan(summary.before.vehHours)
  })

  it('gives the same answer twice', () => {
    const m = ready()
    expect([...run(m, { closed: [1] }).after]).toEqual([...run(m, { closed: [1] }).after])
  })

  it('changes nothing when nothing changes', () => {
    const m = ready()
    const { before, after, summary } = run(m, {})
    after.forEach((v, a) => expect(v).toBeCloseTo(before[a], 8))
    expect(summary.affected).toBe(0)
    expect(summary.after.vehKm).toBeCloseTo(summary.before.vehKm, 6)
  })

  it('shuts one way only', () => {
    const { after } = run(ready(), { oneWay: [[0, 1]] })
    expect(after[1]).toBe(0)
    expect(after[0]).toBeGreaterThan(900)
  })

  it('drops the assumed share of those who used to pass', () => {
    const m = ready()
    const { after, summary } = run(m, { closed: [0], reduce: 0.1 })
    expect(summary.gone).toBeCloseTo(0.1 * summary.affected, 6)
    expect(after[2]).toBeCloseTo(1010 - 100, 0)
  })

  it('drops it from a narrowed street too', () => {
    const { summary } = run(ready(), { capacity: [[0, 0.5]], reduce: 0.1 })
    expect(summary.affected).toBeGreaterThan(900)
    expect(summary.gone).toBeCloseTo(0.1 * summary.affected, 6)
  })

  it('reports trips left without any way', () => {
    expect(run(ready(), { closed: [0, 1] }).summary.lost).toBeCloseTo(1510, 6)
  })

  it('avoids a street squeezed to little room', () => {
    const m = ready({ od: [-1, 60000, 100, 5000, -3, 100, -1] })
    const { after } = run(m, { capacity: [[0, 0.3]] })
    expect(after[0]).toBeLessThan(m.before[0])
  })

  it('lists streets by change, without the shut ones', () => {
    const m = ready()
    const res = run(m, { closed: [0] })
    const list = byStreet(m, res, new Set([0]))
    expect(list.map((s) => s.name)).toEqual(['Długa'])
    expect(list[0].after).toBeGreaterThan(list[0].before)
  })
})
