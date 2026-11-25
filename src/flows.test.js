import { describe, expect, it } from 'vitest'
import {
  dirName, dirPieceKey, flowPieces, flowTable, leftDirs, modesText, onlyDir, perVehicle, roadFlows,
  stopFlows, walkFlows, whole, withoutDirs,
} from './flows'
import { buildMarkers, familyOf, nodeSplit, splitTotal } from './data'
import { markersTable } from './csv'
import { fixture, OPTS } from './fixture.test-data'

// N1B gets a second direction: 30 cars and 2 trams back, 7 bikes beside the road
function twoWay() {
  const d = fixture()
  const row = (o) => d.meta.vehCatOrder.map((c) => o[c] || 0)
  const h = Array.from({ length: 24 }, (_, i) => row(i === 7 ? { d: 30, k: 2 } : {}))
  const off = Array.from({ length: 24 }, (_, i) => (i === 7 ? [7, 0, 0, 0] : [0, 0, 0, 0]))
  d.roadById.N1B = { dirs: { ...d.roadById.N1B.dirs, 'S>N': { h } }, off: { 'S>N': off } }
  return d
}
const refs = (d, ...ids) => d.points.filter((p) => ids.includes(p.id))
const BACK = new Set([dirPieceKey('N1B', 'S>N')])
const sum = (pieces) => pieces.reduce((a, p) => a + p.values.reduce((x, v) => x + v, 0), 0)
const split = (d, ids) => nodeSplit(d, {
  roadIds: ids, ptRefs: d.pt.slice(0, 2), hours: [7], occupancy: 1.2,
})

describe('a direction', () => {
  it('is named where it goes', () => {
    expect(dirName('W>E')).toBe('na wschód (W → E)')
    expect(dirName('SE>NW')).toBe('na północny zachód (SE → NW)')
  })

  it('counts alone, its bikes beside the road included', () => {
    const d = twoWay()
    const one = onlyDir(d, 'road', refs(d, 'N1B')[0], 'S>N')
    const v = Object.fromEntries(split(one.data, ['N1B']).slices.map((x) => [x.key, x.vehicles]))
    expect([v.car, v.tram, v.bike]).toEqual([30, 2, 7])
    expect(one.ref.total).toBe(32)
    expect(onlyDir(d, 'road', refs(d, 'N1B')[0], 'W>E')).toBeNull()
  })

  it('and the other one make the section', () => {
    const d = twoWay()
    const ref = refs(d, 'N1B')[0]
    const of = (dir) => split(onlyDir(d, 'road', ref, dir).data, ['N1B']).slices.map((x) => x.vehicles)
    expect(of('N>S').map((v, i) => v + of('S>N')[i]))
      .toEqual(split(d, ['N1B']).slices.map((x) => x.vehicles))
  })

  it('left out of a node leaves its numbers, and nothing else does', () => {
    const d = twoWay()
    const cut = withoutDirs(d, BACK)
    const car = (x) => split(x, ['N1A', 'N1B']).slices[0].vehicles
    expect([car(d), car(cut), car(whole(cut))]).toEqual([180, 150, 180])
    expect(leftDirs(cut, BACK, 'N1B')).toEqual(['S>N'])
    expect(withoutDirs(d, new Set(['road:N1A', 'pt:P1A']))).toBe(d)
  })

  it('left out is named in the table of all points', () => {
    const d = twoWay()
    const cut = withoutDirs(d, BACK)
    const t = markersTable({
      markers: buildMarkers(cut, OPTS), layers: ['road'], period: 'x', people: true, data: cut, off: BACK,
    })
    expect(t.find((r) => r[0] === 'N1').at(-1)).toBe('N1B:S>N')
  })

  it('makes a lone section a family of its directions', () => {
    const d = twoWay()
    d.roadById.N2A = d.roadById.N1B
    const mk = buildMarkers(d, OPTS)
    const n2 = mk.road.find((m) => m.id === 'N2A')
    const fam = (dir) => familyOf(d, mk, { kind: 'road', id: 'N2A', ref: n2.ref, dir })
    expect(fam()).toMatchObject({ lone: true, current: null })
    expect(fam('S>N').current).toEqual({ kind: 'road', id: 'N2A', dir: 'S>N' })
  })
})

describe('flows', () => {
  const d = twoWay()
  const node = split(d, ['N1A', 'N1B'])
  const rows = roadFlows(d, refs(d, 'N1A', 'N1B'))
  const persons = perVehicle({ occupancy: 1.2, load: node.load })
  const pieces = (by, unit = 'persons') => flowPieces(rows, {
    kind: 'road', by, unit, persons, hours: [7],
    isOut: (r, dir) => BACK.has(dirPieceKey(r.id, dir || '')),
  })

  it('add up to the pie, however they are split', () => {
    const tot = (f) => node.slices.reduce((a, s) => a + s[f], 0)
    for (const by of ['section', 'dir', 'mode']) {
      expect(sum(pieces(by))).toBeCloseTo(splitTotal(node), 6)
      expect(sum(pieces(by, 'vehicles'))).toBe(tot('vehicles'))
      expect(sum(pieces(by, 'pcu'))).toBeCloseTo(tot('pcu'), 6)
    }
  })

  it('stand for sections, directions and modes', () => {
    expect(pieces('section').map((p) => p.id)).toEqual(['N1A', 'N1B'])
    const dirs = pieces('dir')
    expect(dirs.map((p) => p.id)).toEqual(['N1A@N>S', 'N1B@N>S', 'N1B@S>N'])
    expect(dirs[2]).toMatchObject({ out: true, dir: 'S>N', hot: { kind: 'road', id: 'N1B', dir: 'S>N' } })
    expect(pieces('mode').map((p) => p.mode)).toEqual(['car', 'bus', 'tram', 'bike'])
  })

  it('keep to the categories of the road view, off the paths', () => {
    const car = roadFlows(d, refs(d, 'N1B'), { cats: ['d'], roadway: true })
    expect(car.map((r) => r.mode)).toEqual(['car', 'car'])
    const any = roadFlows(d, refs(d, 'N1B'), { roadway: true })
    expect(any.some((r) => r.mode === 'bike')).toBe(false)
  })

  it('say which modes they count', () => {
    expect(modesText(null)).toBe('')
    expect(modesText(['bus', 'tram'])).toBe(': autobusy, tramwaje')
    expect(modesText(['car', 'goods', 'bus', 'bike', 'other'])).toBe(' oprócz: tramwaje')
  })

  it('make a table without what is left out', () => {
    const t = flowTable(pieces('dir', 'vehicles'), 'pojazdów')
    expect(t).toHaveLength(25)
    expect(t[0]).toHaveLength(4)
    expect(t[8]).toEqual(['7:00', '119,0', '55,0', '174,0'])
  })

  it('split stops by mode, and by their biggest lines', () => {
    const at = (by, list) => flowPieces(stopFlows(list, by), { kind: 'pt', by, unit: 'persons', hours: [7] })
    const byMode = flowPieces(stopFlows(d.pt.slice(0, 2), 'mode'),
      { kind: 'pt', by: 'mode', unit: 'vehicles', hours: [7] })
    expect(byMode.map((p) => [p.mode, p.values[7]])).toEqual([['bus', 10], ['tram', 5]])
    const lines = Array.from({ length: 9 }, (_, i) => [`L${i}`, Array(24).fill(i + 1)])
    const byHourLine = Object.fromEntries([...lines, ['inne', Array(24).fill(50)]])
    const top = at('line', [{ ...d.pt[0], byHourLine }])
    expect(top.map((p) => p.id)).toEqual(['L8', 'L7', 'L6', 'L5', 'L4', 'L3', 'inne'])
    expect(top.at(-1).values[7]).toBe(50 + 1 + 2 + 3)
  })

  it('split walkers by where they go', () => {
    const ref = { id: 'RR_1A', byHour: [], byHourDir: { E: Array(24).fill(2) } }
    expect(walkFlows([ref], 'dir')[0].dir).toBe('E>W')
    expect(onlyDir(d, 'bike', ref, 'E>W').ref.total).toBe(48)
  })
})
