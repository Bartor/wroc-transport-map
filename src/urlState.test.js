import { describe, expect, it } from 'vitest'
import { readHash, hashOf, findSelection } from './urlState'
import { buildMarkers, markerIndex } from './data'
import { fixture, OPTS } from './fixture.test-data'

const DEFAULTS = {
  view: 'nodes', range: [7, 9], metric: 'all', aggregate: true, roadPeople: true,
  basemap: 'darkGray', occupancy: 1.2,
}
const STATE = {
  view: 'nodes', range: [7, 9], metric: 'all', areas: null, aggregate: true, wholeDay: false,
  roadPeople: true, occupancy: 1.2, labels: { num: false, pct: false, declutter: true },
  basemap: 'darkGray', survey: false, net: { on: false, mode: 'road' },
  sig: { on: false, filter: 'candidates' }, selected: null, off: new Set(),
}

describe('the address', () => {
  it('is empty for the defaults', () => {
    expect(hashOf(STATE, DEFAULTS)).toBe('')
  })

  it('round-trips what differs', () => {
    const s = {
      ...STATE, view: 'road', range: [22, 6], wholeDay: true, occupancy: 1.5,
      labels: { num: true, pct: true, declutter: false }, net: { on: true, mode: 'pt' },
      selected: { kind: 'road', id: 'R1_06A' }, off: new Set(['pt:R1_06F', 'road:R1_06C']),
      areas: ['Ring 1', 'Ring 2'],
    }
    const h = hashOf(s, DEFAULTS)
    expect(h).toContain('sel=road:R1_06A')          // readable, not %3A
    const r = readHash(h)
    expect(r.view).toBe('road')
    expect(r.range).toEqual([22, 6])
    expect(r.wholeDay).toBe(true)
    expect(r.occupancy).toBe(1.5)
    expect(r.labels).toEqual({ num: true, pct: true, declutter: false })
    expect(r.net).toBe('pt')
    expect(r.sel).toEqual({ kind: 'road', id: 'R1_06A' })
    expect(r.off.sort()).toEqual(['pt:R1_06F', 'road:R1_06C'])
    expect(r.areas).toEqual(['Ring 1', 'Ring 2'])
  })

  it('ignores a malformed range', () => {
    expect(readHash('#h=9-9').range).toBeUndefined()
    expect(readHash('#h=30-2').range).toBeUndefined()
    expect(readHash('#h=abc').range).toBeUndefined()
  })

  it('finds a linked node, or a raw section inside one', () => {
    const data = fixture()
    const idx = markerIndex(buildMarkers(data, OPTS))
    expect(findSelection(data, idx, { kind: 'road', id: 'N1' }).ref.aggregate).toBe(true)
    expect(findSelection(data, idx, { kind: 'road', id: 'N1B' }).ref.name).toBe('ul. Druga')
    expect(findSelection(data, idx, { kind: 'road', id: 'NOPE' })).toBeNull()
  })
})
