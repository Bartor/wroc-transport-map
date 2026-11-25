// What is under the pointer in a survey view - an area, a mode, a pattern - for
// the map and the panel to light up together. Apart from the app's state, so
// that moving the mouse redraws only those two.
import { useSyncExternalStore } from 'react'

let hot = {}
const listeners = new Set()

export function setHot(next) {
  const same = Object.keys({ ...hot, ...next }).every((k) => hot[k] === next[k])
  if (same) return
  hot = next
  for (const f of listeners) f()
}
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f) }
export const useHot = () => useSyncExternalStore(subscribe, () => hot)

/** Handlers that light something up while the pointer is on it. */
export const hotOn = (what) => ({ onMouseEnter: () => setHot(what), onMouseLeave: () => setHot({}) })
