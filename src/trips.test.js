import { describe as suite, expect, it } from 'vitest'
import {
  PAINTS, PER, TRIPS0, areas, breaks, describe, pairs, passing, perOf, perPartner, perPlace, prepare, rings,
  scale, shares, touching, tripsTable,
} from './trips'
import { ASK0, sentiment, sentimentNote, diverging, marginOf, shareOf, spanOf, startOpts, surface } from './answers'
import { changes, ringChanges } from './compare'
import { hashOf, readHash } from './urlState'
import { everythingTable, filterText, viewTable } from './surveyCards'
import { fullName } from './answers'
import { arc, inside, scatter } from './arcs'
import { dayModes, dayText, daysOf, daysTable, patterns, readDays } from './days'
import { colorsOf, partsOf } from './Stack'
import { isSmall, smallText } from './Small'
import { meanOf, onMean, perPeopleOf, valueOf } from './answers'
import { meanFor } from './trips'
import { crossTab, crossTable, digitsFor, perPlaceDim, perSpot, perThousand, placesTable, statOf } from './trips'

// two city zones in one district, one commune around, one place further out
const sq = (la, lo) => [[la * 1e5, lo * 1e5, 1000, 0, 0, 1000, -1000, 0]]
const ZONES = {
  zones: [
    { id: '1', name: 'Rynek', c: [51.11, 17.03], pop: 1000, w: 900, jobs: 5000, n: 10, km2: 1, core: 1, city: 1, d: 0, g: sq(51.11, 17.03) },
    { id: '2', name: 'Obok', c: [51.11, 17.05], pop: 3000, w: 2800, jobs: 100, n: 30, km2: 2, core: 0, city: 1, d: 0, g: sq(51.11, 17.05) },
    { id: '3001', name: 'Gmina - wieś', c: [51.2, 17.2], pop: 400, w: 200, jobs: 10, n: 4, km2: 9, core: 0, city: 0, d: 1, g: sq(51.2, 17.2) },
  ],
  districts: [{ name: 'Stare Miasto', city: 1, g: sq(51.11, 17.03) }, { name: 'Gmina', city: 0, g: sq(51.2, 17.2) }],
  outside: [{ id: '022003', name: 'Dalej' }], core: 1500,
}
// f, t, m, a0, a1, h, d, km, o, w
const ROWS = [
  [1, 0, 3, 0, 1, 7, 20, 1.5, 1, 100],   // home -> work, alone in a car
  [0, 1, 3, 1, 0, 16, 25, 1.5, 1, 100],  // and back
  [1, 1, 0, 0, 4, 10, 5, 0, 0, 50],      // on foot to the shop
  [2, 0, 8, 0, 2, 7, 40, 12, 0, 200],    // a bus to school
  [0, 3, 9, 1, 11, 12, 90, null, 0, 10], // a train out, not from home
]
const keys = ['f', 't', 'm', 'a0', 'a1', 'h', 'd', 'km', 'o', 'w']
const blank = (v) => ROWS.map(() => v)
const T = {
  n: ROWS.length, acts: ['dom', 'praca', 'szkoła', 'uczelnia', 'zakupy', 'ch', 'odwożenie', 'odwiedziny', 'rozrywka', 'zdrowie', 'urząd', 'inne'],
  modes: Array.from({ length: 12 }, (_, i) => `m${i}`), park: ['ulica'], why: ['wygoda'], ages: ['a'], jobs: ['j'],
  cols: {
    ...Object.fromEntries(keys.map((k, i) => [k, ROWS.map((r) => r[i])])),
    hs: blank(3), sx: blank(0), ed: blank(4), kd: blank(0), bd: blank(0), pk: blank(-1), x: blank(0), ag: blank(0), jb: blank(0), hc: blank(1), ps: blank(0), lc: blank(1), wr: blank(1), y: blank(0),
    sf: [1, 1, 0, 0, 0],
  },
}
const S = prepare(ZONES, T)
const all = passing(S, { filters: {}, hours: null })

suite('trips', () => {
  it('reads outlines and groups zones', () => {
    expect(rings([[100000, 200000, 5, -5]])).toEqual([[[1, 2], [1.00005, 1.99995]]])
    expect(S.Z.districts[0]).toMatchObject({ pop: 4000, jobs: 5100, km2: 3, zones: [0, 1] })
    expect([...areas(S.Z)]).toEqual([0, 1, 2, 3])
  })
  it('filters by any choice within a dimension and all of them between', () => {
    const p = (filters, hours) => passing(S, { filters, hours })
    expect(p({ mode: [2] })).toEqual([0, 1])
    expect(p({ mode: [2, 0] })).toEqual([0, 1, 2])
    expect(p({ mode: [2], goal: [1] })).toEqual([0])
    expect(p({}, [7, 8])).toEqual([0, 3])
    expect(p({ km: [0] })).toEqual([2])            // a trip off the map has no length
    expect(p({ to: [0], from: [1, 2] })).toEqual([0, 3])
    expect(p({ easy: [1] })).toEqual([0, 1])
    expect(passing(S, { filters: { mode: [2], goal: [1] } }, 'mode')).toEqual([0])
    expect(passing(S, { filters: { mode: [2] } }, 'mode')).toHaveLength(5)
  })
  it('takes trips by where they start, end, or whose they are', () => {
    expect(touching(S, all, [1], 'from')).toEqual([0, 2])
    expect(touching(S, all, [1], 'to')).toEqual([1, 2])
    expect(touching(S, all, [1], 'any')).toEqual([0, 1, 2])
    expect(touching(S, all, [0], 'home')).toEqual([])     // nobody here lives in zone 1
    expect(touching(S, all, [1], 'home')).toEqual([0, 1, 2])
  })
  it('sums up', () => {
    const d = describe(S, all)
    expect(d).toMatchObject({ n: 5, w: 460 })
    expect(d.inCar).toBe(1)
    expect(d.km).toBeCloseTo((1.5 * 200 + 0 + 12 * 200) / 450)
    expect(d.main.find((m) => m.key === 'car').share).toBeCloseTo(200 / 460)
    expect(d.main.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1)
    expect(d.hours[2][7]).toBe(100)
    expect(shares(S, all, 'mode').reduce((a, o) => a + o.n, 0)).toBe(5)
  })
  it('counts a trip once in each place it touches, or once at home', () => {
    const z = perPlace(S, all, 'z', 'any')
    expect(z[1]).toMatchObject({ any: 250, from: 150, to: 150, n: 3 })
    const h = perPlace(S, all, 'z', 'home')
    expect(h.map((p) => p.any)).toEqual([0, 250, 200])
    expect(perPlace(S, all, 'd', 'any')[0].any).toBe(460)
  })
  it('finds partners, also off the map', () => {
    const zone = touching(S, all, [0], 'any')
    const p = perPartner(S, zone, [0], 'z', 'any')
    expect([...p.w]).toEqual([0, 200, 200])
    expect(p.off).toEqual([{ id: '022003', name: 'Dalej', w: 10, n: 1 }])
    const q = perPartner(S, touching(S, all, [1], 'home'), [1], 'z', 'home')
    expect([...q.w]).toEqual([200, 50, 0])
    expect(pairs(S, all, 'z')[0]).toMatchObject({ w: 200, mode: 2, self: false })
    expect(pairs(S, all, 'z').filter((p) => p.self)).toHaveLength(1)
  })
  it('gives rates only where people live', () => {
    expect(PER.pop.of(S.Z.zones[1])).toBe(2800)
    expect(PER.pop.of(S.Z.zones[2])).toBe(null)
    expect(perOf('pop', 'pop')).toBe('km2')
    expect(perOf('any', 'pop')).toBe('pop')
    expect(PAINTS.car.v(null, perPlace(S, all, 'z', 'home')[1])).toBeCloseTo(200 / 250)
  })
  it('makes a scale without gaps', () => {
    const sc = scale(breaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false))
    expect(sc.steps[0].from).toBe(null)
    expect(sc.steps.at(-1).to).toBe(null)
    for (let i = 1; i < sc.steps.length; i++) expect(sc.steps[i].from).toBe(sc.steps[i - 1].to)
    expect(sc.color(-1)).toBe(sc.steps[0].color)
    expect(sc.color(99)).toBe(sc.steps.at(-1).color)
  })
  it('exports rows without anything finer than a zone', () => {
    const [head, ...rows] = tripsTable(S, all)
    expect(rows).toHaveLength(5)
    expect(rows.every((r) => r.length === head.length)).toBe(true)
    expect(head.join()).not.toMatch(/ulica|adres|osoba|płeć/)
  })
})

const Q = {
  key: 'tram', options: ['tak', 'nie', 'nie wiem'], good: [0], multi: 0, rho: [[0.2, 0.1], [0.2, 0.1], [0, 0]], rhoGood: null,
  tab: { all: { a: { wro: [400, 30, 8, [600, 300, 100]] },
    z: { 0: [50, 20, 6, [900, 50, 50], [700, 250, 50]], 1: [50, 5, 6, [500, 450, 50], [550, 400, 50]] } } },
}
suite('answers', () => {
  it('uses corrected shares unless told otherwise', () => {
    const row = Q.tab.all.z[0]
    expect(shareOf(row, [0])).toBeCloseTo(0.7)
    expect(shareOf(row, [0], true)).toBeCloseTo(0.9)
    expect(shareOf(Q.tab.all.a.wro, [0])).toBeCloseTo(0.6)   // wholes have no correction
    expect(shareOf(row, [0, 1])).toBeCloseTo(0.95)
    expect(shareOf(null, [0])).toBe(null)
  })
  it('widens margins with how bunched the answers are', () => {
    const [a, b] = [Q.tab.all.z[0], Q.tab.all.z[1]]
    const plain = 1.96 * Math.sqrt((0.7 * 0.3) / 50)
    expect(marginOf(Q, a, [0])).toBeGreaterThan(plain)
    expect(marginOf(Q, a, [0], true)).toBeGreaterThan(marginOf(Q, b, [0], true))
  })
  it('starts on the good options and colours around the city', () => {
    expect(startOpts(Q)).toEqual([0])
    expect(diverging(0.6, 0.6, 0.2)).toEqual([120, 126, 138])
    // more of a bad thing is orange, more of a good one green, else violet
    expect(diverging(9, 0.6, 0.2, -1)).toEqual([214, 84, 28])
    expect(diverging(9, 0.6, 0.2, 1)).toEqual([31, 161, 135])
    expect(diverging(-9, 0.6, 0.2, 1)).toEqual([214, 84, 28])
    expect(diverging(9, 0.6, 0.2, 0)).toEqual([150, 72, 178])
    expect(spanOf([{ v: 0.9, n: 50 }, { v: 0.5, n: 50 }], 0.6)).toBeGreaterThanOrEqual(0.05)
  })
  it('averages numbers', () => {
    const q = { key: 'cars0', number: 1, unit: 'aut', per: 'aut na 1000', sd: 0.8, rhoMean: [0.1, 0.1], options: ['brak', '1', '2'], good: [], rho: [[0, 0], [0, 0], [0, 0]],
      tab: { all: { a: { wro: [100, 20, 5, [300, 500, 200], null, 900, 410] } } } }
    const row = q.tab.all.a.wro
    expect(startOpts(q)).toEqual([])
    expect(onMean(q, [])).toBe(true)
    expect(valueOf(q, row, [])).toBeCloseTo(0.9)
    expect(valueOf(q, row, [1, 2])).toBeCloseTo(0.7)
    expect([meanOf(row), perPeopleOf(row)]).toEqual([0.9, 410])
    expect(marginOf(q, row, [])).toBeGreaterThan((1.96 * 0.8) / 10)
    expect(meanFor(S, all, 'in').v).toBe(1)
    expect(meanFor(S, all, 'goal')).toBe(null)
  })
  it('knows what an answer means', () => {
    const u = { key: 'u1', options: ['uciążliwy ruch kołowy', 'nie odczuwam uciążliwości', 'inne rzeczy'] }
    expect([0, 1, 2].map((o) => sentiment(u, [o]))).toEqual([-1, 1, 0])
    expect(sentiment({ key: 'tram', options: [] }, [0, 1])).toBe(1)
    expect(sentiment({ key: 'tram', options: [] }, [0, 4])).toBe(0)
    expect(sentiment({ key: 'cars', options: [] }, [3])).toBe(-1)
    expect(sentiment({ key: 'k3e', options: [] }, [3, 4])).toBe(-1)
    expect(sentiment({ key: 'zcar', options: [] }, [0])).toBe(0)
    expect(sentimentNote({ key: 'bike', options: [] }, [0])).toMatch(/poparcie/)
  })
  it('smooths towards the people nearby', () => {
    const zones = ZONES.zones.slice(0, 2).map((z, i) => ({ ...z, i }))
    const s = surface(Q, 'all', [0], zones, { km: 0.5, cols: 40, box: [51.09, 17.0, 51.13, 17.08] })
    const at = (lo) => s.v[Math.floor(s.rows / 2) * s.cols + Math.floor(((lo - 17) / 0.08) * s.cols)]
    expect(at(17.03)).toBeGreaterThan(at(17.05))
    expect(at(17.03)).toBeLessThanOrEqual(0.7)
  })
})

suite('how it is drawn', () => {
  it('bows there and back apart, and ends where it should', () => {
    const [a, b] = [[51.1, 17], [51.1, 17.1]]
    expect(arc(a, b)[0]).toEqual(a)
    expect(arc(a, b).at(-1)[1]).toBeCloseTo(17.1)
    expect(Math.sign(arc(a, b)[9][0] - 51.1)).toBe(-Math.sign(arc(b, a)[9][0] - 51.1))
  })
  it('scatters inside, the same every time', () => {
    const z = S.Z.zones[0]
    expect(inside(scatter(z, 5), z.rings)).toBe(true)
    expect(scatter(z, 5)).toEqual(scatter(z, 5))
    expect(scatter(z, 5)).not.toEqual(scatter(z, 6))
  })
  it('crosses two dimensions', () => {
    const tab = crossTab(S, all, 'mode', 'goal')
    const car = tab.rows.find((r) => r.i === 2)
    expect(car).toMatchObject({ n: 2, w: 200 })
    expect(car.parts[0]).toBe(0.5)
    expect(tab.rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1)
    expect(crossTable(tab)).toHaveLength(1 + tab.rows.length)
  })
  it('paints any statistic by place', () => {
    const km = S.D.find((d) => d.key === 'km')
    const any = perPlaceDim(S, all, 'z', 'any', km)
    // zone 2: two car trips of 1.5 km, a walk of 0; the train has no length
    expect(any.n[1]).toBe(3)
    expect(statOf(any, [0])[1].v).toBeCloseTo(50 / 250)
    expect(statOf(any, [])[1]).toMatchObject({ best: 2, n: 3 })
    expect(statOf(perPlaceDim(S, all, 'z', 'home', km), [0]).map((s) => s.n)).toEqual([0, 3, 1])
    // towards a picked place: by the other end
    const from = perPlaceDim(S, touching(S, all, [1], 'from'), 'z', 'from', km, [1])
    expect([...from.n]).toEqual([1, 1, 0])
    const [head, ...rows] = placesTable(S, perPlace(S, all, 'z', 'any'), 'z', all, 'any')
    expect(rows.every((r) => r.length === head.length)).toBe(true)
  })
  it('counts a spot once a trip', () => {
    const p = perSpot({ ...S, T: { ...S.T, cols: { ...S.T.cols, pf: [-1, 0, -1, -1, 0], pt: [0, -1, 1, 0, 0] } } }, all, 2)
    expect([...p.n]).toEqual([4, 1])
    expect(p.mode(1)).toBe(0)
  })
  it('keeps rates readable', () => {
    expect(perThousand([0.001, null, 0.2], PER.pop)).toBe(true)
    expect(perThousand([1.4], PER.pop)).toBe(false)
    expect(perThousand([0.01], PER.abs)).toBe(false)
    expect([digitsFor([1.5]), digitsFor([52]), digitsFor([820])]).toEqual([2, 1, 0])
  })
  it('marks small samples, not missing ones', () => {
    expect([0, 1, 19, 20].map((n) => isSmall(n))).toEqual([false, true, true, false])
    expect(smallText(25, 30)).toBe(' (!)')
    expect(smallText(25)).toBe('')
  })
  it('makes parts that add up', () => {
    const p = partsOf({ a: 5, b: 3, c: 1, inne: 1 }, 2)
    expect(p.map((x) => x.label)).toEqual(['a', 'inne'])
    expect(p.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
    expect(colorsOf(S.D[0])).toHaveLength(S.modes.length)
  })
})

suite('whole days', () => {
  // two people: out to work and back by car with a walk to the shop; a bus to school
  const cols = { ...S.T.cols, p: [1, 1, 1, 2, 3], q: [1, 2, 3, 1, 1], pf: [0, -1, 0, -1, -1], pt: [-1, 0, 1, -1, -1] }
  const X = { ...S, T: { ...S.T, cols } }
  const days = readDays(X)
  it('puts trips together in order', () => {
    expect(days).toHaveLength(3)
    expect(days[0]).toMatchObject({ key: '0103', home: 1, stops: [1, 0, 1, 1], modes: [0, 0, 3] })
    expect(days[2].home).toBe(-1)
  })
  it('keeps days with a trip that passes, of those who live there', () => {
    expect(daysOf(days, [0], null).map((r) => r.k)).toEqual([0])
    expect(daysOf(days, all, [2]).map((r) => r.k)).toEqual([1])
  })
  it('says how days go', () => {
    const p = patterns(days)
    expect(p.n).toBe(3)
    expect(p.list.find((y) => y.key === '0103')).toMatchObject({ n: 1, label: 'dom → praca → dom → zakupy' })
    expect(dayModes(days).reduce((a, y) => a + y.share, 0)).toBeCloseTo(1)
    expect(dayText(X, [{ name: 'Ulica' }, { name: 'Sklep' }], days[0])).toEqual(['dom, Ulica', '7:00 samochód → praca, Rynek', '16:00 samochód → dom, Ulica', '10:00 pieszo → zakupy, Sklep'])
    expect(daysTable(X, null, days)).toHaveLength(4)
  })
})

suite('exports', () => {
  const groups = [{ key: 'all', label: 'wszyscy' }, { key: 'car', label: 'kierowcy' }]
  it('tables the open question, groups without answers left out', () => {
    const rows = viewTable(Q, groups, 'a', 'wro', false)
    expect(rows[0]).toEqual(['odpowiedź', 'wszyscy — %', 'wszyscy — ± p.p.'])
    expect(rows[1].slice(0, 2)).toEqual(['tak', '60'])
    expect(rows.at(-1)).toEqual(['odpowiedzi w próbie', 400, ''])
    expect(viewTable(Q, groups, 'z', 0, true)[1][1]).toBe('90')
  })
  it('tables every question for a group', () => {
    const q = { ...Q, group: 'G', label: 'P' }
    const rows = everythingTable({ questions: [q], groups }, { districts: [] }, 'all', false)
    expect(rows).toHaveLength(1 + 3)
    expect(everythingTable({ questions: [q], groups }, { districts: [] }, 'car', false)).toHaveLength(1)
  })
  it('puts filters and questions in words', () => {
    expect(filterText(S, { mode: [0, 2], km: [0] })).toBe('środek transportu: pieszo, samochód — kierowca; długość: do 0,5 km')
    expect(filterText(S, {})).toBe('')
    expect(fullName({ group: 'Co utrudnia poruszanie się', label: 'Pieszo' })).toBe('Co utrudnia poruszanie się: pieszo')
  })
})

suite('2018 against 2024', () => {
  it('places sums of sections and adds up rings', () => {
    const rows = changes({ roads: [{ ids: ['R1_01A', 'R1_01B'], v18: 100, v24: 80, day: 0 }, { ids: ['R1_02'], v18: 100, v24: 110, day: 0 }, { ids: ['X'], v18: 1, v24: 1 }] },
      { points: [{ id: 'R1_01A', lat: 51, lon: 17, name: 'A' }, { id: 'R1_01B', lat: 51.2, lon: 17.2, name: 'B' }, { id: 'R1_02', lat: 51, lon: 17, name: 'C' }] })
    expect(rows).toHaveLength(2)
    expect(rows[0].lat).toBeCloseTo(51.1)
    expect(ringChanges(rows)[0]).toMatchObject({ n: 2, v18: 200, v24: 190, fell: 1 })
  })
})

suite('the address of a survey view', () => {
  const base = { range: [0, 24], areas: null, labels: { num: false, pct: false, declutter: true }, net: {}, sig: {}, off: new Set(), flow: {}, occupancy: null }
  const d = { range: [7, 9], flow: {} }
  it('keeps the trips', () => {
    const trip = { ...TRIPS0, level: 'z', paint: 'stat', stat: { dim: 'age', opts: [1, 2] }, way: 'to', per: 'km2', picked: ['z12', 'z3001'], show: 'flows', names: true, top: 100, rows: 'age', split: 'goal', pattern: '010', filters: { mode: [2, 3], km: [0] } }
    const back = readHash(hashOf({ ...base, view: 'trips', trip }, d))
    expect({ ...TRIPS0, ...back.trip }).toEqual(trip)
    expect(readHash(hashOf({ ...base, view: 'trips', trip: TRIPS0 }, d)).trip).toEqual({})
  })
  it('keeps the question', () => {
    const ask = { ...ASK0, q: 'bike', opts: [0, 1], group: 'car', level: 'h', km: 1.5, raw: true }
    expect({ ...ASK0, ...readHash(hashOf({ ...base, view: 'answers', ask }, d)).ask }).toEqual(ask)
  })
})
