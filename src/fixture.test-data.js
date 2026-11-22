// A tiny survey for the tests, small enough to work out by hand. All counts
// are in hour 7; the stop survey ran 5-9 and 14-18 as in KBR.
//
//   N1  road node, sections N1A + N1B, paired with stops P1A + P1B (~10 m)
//   N3  road node far away, one section, its stop P3A saw a sliver of buses
//   N2  road node with no stop nearby
const CATS = ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'a1', 'a2', 'b1', 'b2']
const row = (o = {}) => CATS.map((c) => o[c] || 0)
const day = (at7) => Array.from({ length: 24 }, (_, h) => (h === 7 ? row(at7) : row()))
const series = (v) => Array.from({ length: 24 }, (_, h) => (h === 7 ? v : 0))

const section = (at7) => ({ dirs: { 'N>S': { h: day(at7) } } })
const point = (id, point, lat, lon, name) => ({
  id, point, lat, lon, name, segment: `${name} odcinek`, area: 'Ring 1',
})
const stop = (id, point, lat, lon, loc, { busPax = 0, busVeh = 0, tramPax = 0, tramVeh = 0 }) => ({
  id, point, lat, lon, loc, stop: `${point} przystanek`, name: `${point} przystanek`,
  byHour: { autobus: series(busPax), tramwaj: series(tramPax) },
  vehByHour: { autobus: series(busVeh), tramwaj: series(tramVeh) },
  byHourDir: {}, byHourLine: {},
})

export function fixture() {
  const roadById = {
    N1A: section({ d: 100, j: 10, k: 5, a1: 4 }),
    N1B: section({ d: 50, k: 5 }),
    N2A: section({ d: 80 }),
    N3A: section({ d: 10, j: 100 }),
  }
  return {
    meta: {
      vehCatOrder: CATS,
      offCatOrder: ['a3', 'a4', 'b3', 'b4'],
      windows: {
        pt: [5, 6, 7, 8, 14, 15, 16, 17],
        bike: [6, 7, 8, 9, 15, 16, 17, 18],
        ped: [6, 7, 8, 9, 15, 16, 17, 18],
      },
      carOccupancy: { default: 1.2, value: '1,207' },
    },
    points: [
      point('N1A', 'N1', 51.1, 17.0, 'ul. Pierwsza'),
      point('N1B', 'N1', 51.1001, 17.0001, 'ul. Druga'),
      point('N2A', 'N2', 51.3, 17.3, 'ul. Daleka'),
      point('N3A', 'N3', 51.2, 17.2, 'al. Szeroka'),
    ],
    roadById,
    road: { sections: roadById },
    pt: [
      stop('P1A', 'P1', 51.10005, 17.00005, 'Pierwsza', { busPax: 200, busVeh: 5, tramPax: 500, tramVeh: 5 }),
      stop('P1B', 'P1', 51.10006, 17.00006, 'Druga', { busPax: 200, busVeh: 5 }),
      stop('P3A', 'P3', 51.2002, 17.2, 'Szeroka', { busPax: 2, busVeh: 4 }),
    ],
    bike: [
      { id: 'RR_1A', name: 'ul. Rowerowa', lat: 51.101, lon: 17.0, where: ['strona północna'], byHour: series(30) },
      { id: 'RR_1B', name: 'ul. Rowerowa', lat: 51.101, lon: 17.0002, where: ['strona południowa'], byHour: series(12) },
    ],
    ped: [],
    rail: [],
    transitOcc: { bus: 30, tram: 60 },
  }
}

export const OPTS = {
  visible: { road: true, pt: true }, hours: [7], metric: 'all', areas: null,
  aggregate: true, split: true, wholeDay: false, people: true, occupancy: 1.2,
}
