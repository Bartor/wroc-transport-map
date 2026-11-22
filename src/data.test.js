import { describe, expect, it } from 'vitest'
import {
  buildMarkers, familyOf, markerIndex, splitTotal, splitShares, thinText, bikeNote,
  pieceKey, resolveTarget, PCU, carGap,
} from './data'
import { fixture, OPTS } from './fixture.test-data'

const node = (mk, id) => mk.road.find((m) => m.id === id)
const slice = (m, key) => m.split.slices.find((s) => s.key === key)

describe('node modal split', () => {
  const data = fixture()
  const mk = buildMarkers(data, OPTS)
  const n1 = node(mk, 'N1')

  it('merges a point\'s sections and pairs the stop within 150 m', () => {
    expect(n1.ref.aggregate).toBe(true)
    expect(n1.ref.members.map((r) => r.id)).toEqual(['N1A', 'N1B'])
    expect(n1.pair.id).toBe('P1')
    // the paired transit node lives inside the road pie, not beside it
    expect((mk.pt || []).some((p) => p.id === 'P1')).toBe(false)
  })

  it('counts every mode from the road sections, people from the stop load', () => {
    // cars 150 x 1.2; buses 10 x (400/10); trams 10 x (500/5); bikes as counted
    expect(slice(n1, 'car').persons).toBeCloseTo(180)
    expect(slice(n1, 'bus').persons).toBeCloseTo(400)
    expect(slice(n1, 'tram').persons).toBeCloseTo(1000)
    expect(slice(n1, 'bike').persons).toBe(4)
    expect(n1.split.basis).toBe('measured')
    expect(splitTotal(n1.split)).toBeCloseTo(1584)
  })

  it('falls back to the city average without a partner', () => {
    const n2 = node(mk, 'N2A')
    expect(n2.pair).toBeUndefined()
    expect(n2.split.basis).toBe('estimate')
    expect(n2.split.load).toEqual({ bus: 30, tram: 60 })
  })

  it('ignores a stop load built on a sliver of the vehicles', () => {
    const n3 = node(mk, 'N3A')
    expect(n3.pair.id).toBe('P3A')
    expect(n3.split.local.bus).toBe(false)
    expect(n3.split.load.bus).toBe(30)
    expect(n3.split.thin.bus).toEqual({ stop: 4, road: 100 })
    expect(thinText(n3.split)).toContain('4 poj. wobec 100')
  })

  it('shares of people, vehicles and capacity each add up to one', () => {
    const rows = splitShares(n1.split)
    for (const r of rows) {
      expect(r.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1)
    }
    // capacity: cars 150, buses 10 x 2.5, trams 10 x 3, bikes 4 x 0.3
    const pcu = 150 * PCU.d + 10 * PCU.j + 10 * PCU.k + 4 * PCU.a1
    expect(rows[2].parts.find((p) => p.key === 'car').share).toBeCloseTo(150 / pcu)
  })
})

describe('carGap', () => {
  const mk = buildMarkers(fixture(), OPTS)

  it('sums up a node where cars are most vehicles and few of the people', () => {
    // N1: cars 150 of 174 vehicles (86%), 180 of 1584 people (11%)
    expect(carGap(node(mk, 'N1').split)).toMatch(/^Samochody osobowe: 86% pojazdów i \d+% przepustowości jezdni, ale 11% osób\.$/)
  })

  it('stays quiet where cars carry their share', () => {
    expect(carGap(node(mk, 'N2A').split)).toBeNull()       // cars only: 100% and 100%
  })
})

describe('leaving pieces out of a node', () => {
  const data = fixture()

  it('drops a road section from the sums but keeps it listed and in place', () => {
    const all = node(buildMarkers(data, OPTS), 'N1')
    const mk = buildMarkers(data, { ...OPTS, off: new Set([pieceKey('road', 'N1B')]) })
    const n1 = node(mk, 'N1')
    expect(n1.ref.members.map((r) => r.id)).toEqual(['N1A'])
    expect(n1.ref.all.map((r) => r.id)).toEqual(['N1A', 'N1B'])
    expect(slice(n1, 'car').persons).toBeCloseTo(120)
    expect(slice(n1, 'tram').persons).toBeCloseTo(500)
    expect([n1.lat, n1.lon]).toEqual([all.lat, all.lon])
  })

  it('with every stop left out, takes the city average', () => {
    const off = new Set([pieceKey('pt', 'P1A'), pieceKey('pt', 'P1B')])
    const n1 = node(buildMarkers(data, { ...OPTS, off }), 'N1')
    expect(n1.pair.refs).toEqual([])
    expect(n1.split.load).toEqual({ bus: 30, tram: 60 })
    expect(slice(n1, 'bus').persons).toBeCloseTo(300)
  })

  it('a lone unmerged stop can be left out too', () => {
    const off = new Set([pieceKey('pt', 'P3A')])
    const n3 = node(buildMarkers(data, { ...OPTS, off }), 'N3A')
    expect(n3.pair.refs).toEqual([])
    expect(n3.pair.all.map((r) => r.id)).toEqual(['P3A'])
  })
})

describe('familyOf', () => {
  const data = fixture()
  const mk = buildMarkers(data, { ...OPTS, off: new Set([pieceKey('road', 'N1B')]) })
  const n1 = node(mk, 'N1')

  it('lists every piece of the node, left-out ones included', () => {
    const f = familyOf(data, mk, { kind: 'road', id: 'N1', ref: n1.ref })
    expect(f.node).toBe(n1)
    expect(f.current).toBeNull()
    expect(f.groups.map((g) => [g.kind, g.members.map((m) => m.id)])).toEqual([
      ['road', ['N1A', 'N1B']], ['pt', ['P1A', 'P1B']],
    ])
  })

  it('knows which piece is open, stops included', () => {
    const stop = data.pt.find((p) => p.id === 'P1B')
    const f = familyOf(data, mk, { kind: 'pt', id: 'P1B', ref: stop })
    expect(f.node).toBe(n1)
    expect(f.current).toEqual({ kind: 'pt', id: 'P1B' })
  })

  it('a search hit inside a node selects the node', () => {
    const stop = data.pt.find((p) => p.id === 'P1A')
    expect(resolveTarget(mk, 'pt', stop).id).toBe('N1')
    expect(resolveTarget(mk, 'road', data.points[1]).id).toBe('N1')
  })
})

describe('bikeNote', () => {
  const data = fixture()
  const n1 = node(buildMarkers(data, OPTS), 'N1')

  it('calls a node without path counts a floor and names the nearest count', () => {
    const t = bikeNote(data, n1, n1.split)
    expect(t).toContain('dolna granica')
    expect(t).toContain('RR_1')
    expect(t).toContain('42 rowerzystów') // both sides summed
  })

  it('says so when every section counted the paths too', () => {
    const d = fixture()
    for (const id of ['N1A', 'N1B']) d.roadById[id].off = { 'N>S': Array(24).fill([0, 0, 0, 0]) }
    const m = node(buildMarkers(d, OPTS), 'N1')
    expect(bikeNote(d, m, m.split)).toContain('drogach rowerowych i chodnikach obok jezdni')
  })
})

describe('markerIndex', () => {
  it('indexes drawn markers by kind and id', () => {
    const mk = buildMarkers(fixture(), OPTS)
    expect(markerIndex(mk)['road:N1'].id).toBe('N1')
  })
})
