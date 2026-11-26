// Roadworks and closures while the city was counted and asked (etl/works.py).
import { useEffect, useState } from 'react'
import { loadFile } from './data'

let known = null
let asked = null
/**
 * Only what lasted the whole study is marked: counts and diaries were of typical
 * working days, rescheduled where needed - the report names only the farmers'
 * protests of March and Pomorska, whose counting point was moved to Grodzka.
 * A shorter closure most likely missed the days that were counted.
 */
export const STUDY = ['2024-03-21', '2024-06-20']
export const wholeStudy = (w) => w.from <= STUDY[0] && w.to >= STUDY[1]

/** What is known by now: for pictures, which cannot wait. */
export const worksNow = () => (known || []).filter(wholeStudy)
/** Those that lasted the whole study; `all` for every one. */
export function useWorks(all = false) {
  const [list, setList] = useState(known)
  useEffect(() => {
    asked ||= loadFile('works').then((j) => { known = j.works; return known }).catch(() => { known = []; return known })
    asked.then(setList)
  }, [])
  return (list || []).filter((x) => all || wholeStudy(x))
}

export const WORKS_COLOR = '#ffb400'

/** Of some districts, by their numbers: dug up there, or their trams sent
 *  round it - then said so instead. */
export const worksIn = (list, districts) => list.flatMap((w) => (w.d.some((d) => districts.includes(d)) ? [w]
  : w.reroute?.d.some((d) => districts.includes(d)) ? [{ ...w, what: w.reroute.what, via: true }] : []))
/** Every district a work bears on. */
export const districtsOf = (w) => [...w.d, ...(w.reroute?.d || [])]
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
export const worksText = (list) => list.map((w) => `${w.via ? 'objazd tramwajów — ' : ''}${w.name} (${w.when})`).join('; ')
