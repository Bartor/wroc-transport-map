// Whole days: each person who went out, as the chain of their trips.
import { csvNumber as num } from '@bartor-net/ui-kit'

export const DAY_ACTS = ['dom', 'praca', 'nauka', 'zakupy', 'odwożenie', 'inne']
// the survey's purposes, and the modes of the trips view, as those of a day
const ACT6 = [0, 1, 2, 2, 3, 3, 4, 5, 5, 5, 5, 5]
const MODE5 = [3, 2, 0, 0, 1, 1, 1, 1, 4]
export const DAY_MODES = [
  { label: 'samochód', color: '#e4572e' }, { label: 'transport zbiorowy', color: '#3987e5' },
  { label: 'rower', color: '#0ca30c' }, { label: 'pieszo', color: '#b5179e' }, { label: 'inne', color: '#6b7385' },
]

/** Trips put together by person, in the order they were made. */
export function readDays(S) {
  const c = S.T.cols
  const by = new Map()
  for (let i = 0; i < S.T.n; i++) {
    if (!by.has(c.p[i])) by.set(c.p[i], [])
    by.get(c.p[i]).push(i)
  }
  return [...by.values()].map((trips, k) => {
    trips.sort((a, b) => c.q[a] - c.q[b])
    const first = trips[0]
    const stops = [c.f[first], ...trips.map((i) => c.t[i])]
    const spots = [c.pf[first], ...trips.map((i) => c.pt[i])]
    const acts = [ACT6[c.a0[first]], ...trips.map((i) => ACT6[c.a1[i]])]
    const home = acts.indexOf(0)
    return { k, w: c.w[first], trips, stops, spots, acts, modes: trips.map((i) => MODE5[S.modeAt[c.m[i]]]),
      hours: trips.map((i) => c.h[i]), home: home < 0 ? -1 : stops[home], key: acts.join('') }
  })
}

/** Days with at least one of the given trips, of people living in some zones. */
export function daysOf(days, trips, zones) {
  const has = new Set(trips)
  const z = zones && new Set(zones)
  return days.filter((r) => (!z || z.has(r.home)) && r.trips.some((i) => has.has(i)))
}

export const patternText = (key) => [...key].map((a) => DAY_ACTS[+a]).join(' → ')

/** How days go: the commonest chains of purposes, and how many are more than
 *  there and back. */
export function patterns(rows) {
  const by = new Map()
  let all = 0
  let trips = 0
  let more = 0
  for (const r of rows) {
    const p = by.get(r.key) || { key: r.key, w: 0, n: 0 }
    p.w += r.w
    p.n += 1
    by.set(r.key, p)
    all += r.w
    trips += r.w * r.trips.length
    if (r.trips.length > 2) more += r.w
  }
  return {
    n: rows.length, w: all, trips: all ? trips / all : 0, more: all ? more / all : 0,
    list: [...by.values()].sort((a, b) => b.w - a.w).map((p) => ({ ...p, share: all ? p.w / all : 0, label: patternText(p.key) })),
  }
}

/** Whether one mode carries the whole day, as parts of all days. */
export function dayModes(rows) {
  const only = DAY_MODES.map(() => 0)
  let mixed = 0
  let all = 0
  for (const r of rows) {
    all += r.w
    if (r.modes.every((m) => m === r.modes[0])) only[r.modes[0]] += r.w
    else mixed += r.w
  }
  return [...only.map((w, i) => ({ key: String(i), label: `tylko ${DAY_MODES[i].label}`, color: DAY_MODES[i].color, share: all ? w / all : 0 })),
    { key: 'mixed', label: 'różne środki', color: '#c98500', share: all ? mixed / all : 0 }]
}

/** One day in words, a stop at a time. */
export function dayText(S, spots, r) {
  const { Z } = S
  const name = (k, s) => (spots && s >= 0 ? spots[s].name : k < Z.count ? Z.zones[k].name : Z.outside[k - Z.count].name)
  return r.stops.map((z, i) => `${i === 0 ? '' : `${r.hours[i - 1] == null ? '' : `${r.hours[i - 1]}:00 `}${DAY_MODES[r.modes[i - 1]].label} → `}`
    + `${DAY_ACTS[r.acts[i]]}, ${name(z, r.spots[i])}`)
}

export const daysTable = (S, spots, rows) => [
  ['waga', 'wiek', 'zajęcie', 'samochody w domu', 'liczba podróży', 'łańcuch', 'dzień'],
  ...rows.map((r) => {
    const c = S.T.cols
    const i = r.trips[0]
    return [num(r.w), S.T.ages[c.ag[i]], S.T.jobs[c.jb[i]], c.hc[i], r.trips.length, patternText(r.key), dayText(S, spots, r).join('; ')]
  }),
]
