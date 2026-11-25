// Roadworks and closures while the city was counted and asked (etl/works.py).
import { useEffect, useState } from 'react'
import { loadFile } from './data'

let known = null
let asked = null
/** What is known by now: for pictures, which cannot wait. */
export const worksNow = () => known || []
export function useWorks() {
  const [list, setList] = useState(known)
  useEffect(() => {
    asked ||= loadFile('works').then((j) => { known = j.works; return known }).catch(() => { known = []; return known })
    asked.then(setList)
  }, [])
  return list || []
}

export const WORKS_COLOR = '#ffb400'

// trips were asked about from the day before the first interview to the last
const ASKED = ['2024-04-05', '2024-06-20']
/** Of some districts, by their numbers, while people there were asked. */
export const worksIn = (list, districts) => list.filter((w) => w.to >= ASKED[0] && w.from <= ASKED[1] && w.d.some((d) => districts.includes(d)))
/** The district of a place of either level. */
export const districtOf = (p) => (p.level === 'd' ? p.i : p.d)

/** "2024-04-09" and "09.04.2024" alike. */
export const isoDate = (s) => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s || '')
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(s || '') ? s.slice(0, 10) : null
}
const KM = 111.2
const apart = (a, b) => Math.hypot((a[0] - b[0]) * KM, (a[1] - b[1]) * KM * Math.cos((a[0] * Math.PI) / 180))
/** How far a work is from a point, km: to the nearest of its vertices' middles. */
export function farFrom(w, at) {
  let best = Infinity
  for (const g of w.g) {
    for (let i = 0; i < g.length; i++) {
      best = Math.min(best, apart(g[i], at))
      if (i) best = Math.min(best, apart([(g[i][0] + g[i - 1][0]) / 2, (g[i][1] + g[i - 1][1]) / 2], at))
    }
  }
  return best
}
/** Near a point on the days it was counted; on any day where that is not known. */
export const worksNear = (list, at, dates = [], km = 0.4) => {
  const days = dates.map(isoDate).filter(Boolean)
  return list.filter((w) => farFrom(w, at) <= km && (!days.length || days.some((d) => d >= w.from && d <= w.to)))
}
export const worksText = (list) => list.map((w) => `${w.name} (${w.when})`).join('; ')
