// Whole days: each person who went out, as a chain of districts and purposes.
import { csvNumber as num } from '@bartor-net/ui-kit'

export const DAY_MODES = [
  { label: 'samochód', color: '#e4572e' }, { label: 'transport zbiorowy', color: '#3987e5' },
  { label: 'rower', color: '#0ca30c' }, { label: 'pieszo', color: '#b5179e' }, { label: 'inne', color: '#6b7385' },
]

export function readDays(j) {
  return {
    acts: j.acts, modes: j.modes,
    rows: j.rows.map(([w, d, a, m, h], i) => {
      const home = a.indexOf(0)
      return { i, w, d, a, m, h, home: home < 0 ? -1 : d[home], key: a.join('') }
    }),
  }
}

/** The days of people living in some districts, or of everyone. */
export const daysOf = (D, districts) => (districts ? D.rows.filter((r) => districts.has(r.home)) : D.rows)

export const patternText = (D, key) => [...key].map((c) => D.acts[+c]).join(' → ')

/** How days go: the commonest chains of purposes, and how much is more than
 *  there and back. */
export function patterns(D, rows) {
  const by = new Map()
  let all = 0
  let stops = 0
  let more = 0
  for (const r of rows) {
    const p = by.get(r.key) || { key: r.key, w: 0, n: 0 }
    p.w += r.w
    p.n += 1
    by.set(r.key, p)
    all += r.w
    stops += r.w * r.m.length
    // anything but home - somewhere - home
    if (r.m.length > 2) more += r.w
  }
  return {
    n: rows.length, w: all, trips: all ? stops / all : 0, more: all ? more / all : 0,
    list: [...by.values()].sort((a, b) => b.w - a.w).map((p) => ({ ...p, share: all ? p.w / all : 0, label: patternText(D, p.key) })),
  }
}

/** Whether one mode carries the whole day: what a car makes possible, or takes. */
export function dayModes(rows) {
  const only = DAY_MODES.map(() => 0)
  let mixed = 0
  let all = 0
  for (const r of rows) {
    all += r.w
    if (r.m.every((m) => m === r.m[0])) only[r.m[0]] += r.w
    else mixed += r.w
  }
  return { only: only.map((w) => (all ? w / all : 0)), mixed: all ? mixed / all : 0 }
}

/** One day in words: "Ołbin 7 → praca, Stare Miasto (samochód) 15 → dom". */
export const dayText = (D, districts, r) => r.d.map((d, i) => {
  const place = d < 0 ? 'poza obszarem' : districts[d].name
  return i === 0 ? `${D.acts[r.a[0]]}, ${place}` : `${r.h[i - 1] < 0 ? '' : `${r.h[i - 1]}:00 `}${D.modes[r.m[i - 1]]} → ${D.acts[r.a[i]]}, ${place}`
})

export const daysTable = (D, districts, rows) => [
  ['waga', 'liczba podróży', 'łańcuch', 'dzień'],
  ...rows.map((r) => [num(r.w), r.m.length, patternText(D, r.key), dayText(D, districts, r).join('; ')]),
]
