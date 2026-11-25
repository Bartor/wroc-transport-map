// Curves between places, and points inside them.

/** A curve from a to b, bowed to the left of the way: there and back part. */
export function arc(a, b, bow = 0.16, n = 18) {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180)
  const dy = b[0] - a[0]
  const dx = (b[1] - a[1]) * k
  const c = [(a[0] + b[0]) / 2 + dx * bow, (a[1] + b[1]) / 2 - (dy * bow) / k]
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]
  })
}

const KM = 1 / 111.2
/** A loop from a point back to it, `size` km high: trips that stay in a place. */
export function loop(c, size, n = 26) {
  const k = KM / Math.cos((c[0] * Math.PI) / 180)
  const h = size * 1.33
  const w = size * 0.95
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    const side = 3 * u * u * t * -w + 3 * u * t * t * w
    const up = 3 * u * u * t * h + 3 * u * t * t * h
    return [c[0] + up * KM, c[1] + side * k]
  })
}
/** How high, by the size of the place. */
export const loopSize = (km2) => Math.min(1.5, Math.max(0.5, 0.42 * Math.sqrt(km2 || 3)))

const gap = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1])
/** The point `d` along a line, and the way it runs there. */
function along(pts, d) {
  let left = d
  for (let i = 1; i < pts.length; i++) {
    const g = gap(pts[i - 1], pts[i])
    if (g >= left && g > 0) {
      const t = left / g
      return { i, p: [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])] }
    }
    left -= g
  }
  return { i: pts.length - 1, p: pts[pts.length - 1] }
}
const length = (pts) => pts.reduce((s, p, i) => (i ? s + gap(pts[i - 1], p) : 0), 0)
const triangle = (base, tip, half) => {
  const g = gap(base, tip) || 1
  const [x, y] = [((tip[0] - base[0]) / g) * half, ((tip[1] - base[1]) / g) * half]
  return [[base[0] - y, base[1] + x], tip, [base[0] + y, base[1] - x]]
}

/**
 * A line in pixels with arrowheads: where it ends and, the other way, where it
 * begins - or a little way off, at `inner` of its length, where many begin.
 * Sizes are lengths of the heads, none for none.
 */
export function arrowed(pts, { end = 0, start = 0, inner = 0 } = {}) {
  const all = length(pts)
  const e = Math.min(end, all * 0.4)
  const s = Math.min(start, all * 0.3)
  const heads = []
  let line = pts
  if (e > 2) {
    const at = along(line, all - e)
    heads.push(triangle(at.p, pts[pts.length - 1], e * 0.62))
    // under the head a little, so that no seam shows
    const stop = along(line, all - e * 0.8)
    line = [...line.slice(0, stop.i), stop.p]
  }
  if (s > 2) {
    const tip = along(pts, inner * all).p
    const base = along(pts, inner * all + s)
    heads.push(triangle(base.p, tip, s * 0.62))
    if (!inner) { const from = along(line, s * 0.8); line = [from.p, ...line.slice(from.i)] }
  }
  return { line, heads }
}
/** How long the heads of a line are, by how much of it runs each way. */
export function headSizes(f, weight) {
  const all = (f.fw || 0) + (f.bw || 0)
  if (!all) return null
  const size = (w) => (w / all < 0.12 ? 0 : (6 + 1.35 * weight) * (0.6 + 0.4 * Math.sqrt(w / all)))
  return { end: size(f.fw), start: size(f.bw), inner: f.inner || 0 }
}

/** Numbers that look random and are the same every time. */
export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export function inside([y, x], rings) {
  let c = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][0] > y) !== (r[j][0] > y)
        && x < ((r[j][1] - r[i][1]) * (y - r[i][0])) / (r[j][0] - r[i][0]) + r[i][1]) c = !c
    }
  }
  return c
}

/** A point somewhere in a place, the same for the same seed. */
export function scatter(place, seed) {
  const all = place.rings.flat()
  const ys = all.map((p) => p[0])
  const xs = all.map((p) => p[1])
  const [s, n, w, e] = [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)]
  const r = rng(seed + 1)
  for (let i = 0; i < 40; i++) {
    const p = [s + r() * (n - s), w + r() * (e - w)]
    if (inside(p, place.rings)) return p
  }
  return place.c
}
