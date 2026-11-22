import { useRef, useState } from 'react'

/**
 * Drag a bottom sheet by its handle: it follows the finger, and on release
 * snaps open or shut by distance or flick speed. A short touch stays a tap.
 *
 * Touch and pen only - with a mouse the handle is a plain button. Returns the
 * current drag offset (null when not dragging) and the handlers to spread on
 * the handle element.
 */
export function useSheetDrag(open, setOpen) {
  const start = useRef(null)
  const moved = useRef(false)
  const [dy, setDy] = useState(null)

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return
    start.current = { y: e.clientY, t: performance.now() }
    moved.current = false
  }
  const onPointerMove = (e) => {
    const s = start.current
    if (!s) return
    const d = e.clientY - s.y
    if (Math.abs(d) > 6) moved.current = true
    // an open sheet only goes down, a closed one only up
    if (moved.current) setDy(open ? Math.max(0, d) : Math.min(0, d))
  }
  const onPointerUp = (e) => {
    const s = start.current
    start.current = null
    if (!s) return
    if (moved.current) {
      const d = e.clientY - s.y
      const speed = d / Math.max(1, performance.now() - s.t) // px per ms
      if (open ? d > 80 || speed > 0.5 : d < -50 || speed < -0.5) setOpen(!open)
    }
    setDy(null)
  }
  const onPointerCancel = () => { start.current = null; setDy(null) }
  // the click that ends a drag is not a tap
  const onClickCapture = (e) => {
    if (moved.current) {
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
    }
  }
  return {
    dy,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  }
}
