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
 * A line in pixels with arrowheads where it ends and, the other way, where it
 * begins. Sizes are lengths of the heads, none for none.
 */
export function arrowed(pts, { end = 0, start = 0 } = {}) {
  const all = length(pts)
  const e = Math.min(end, all * 0.4)
  const s = Math.min(start, all * 0.3)
  let line = pts
  let tip = null
  let tail = null
  if (e > 2) {
    const at = along(line, all - e)
    tip = triangle(at.p, pts[pts.length - 1], e * 0.62)
    // under the head a little, so that no seam shows
    const stop = along(line, all - e * 0.8)
    line = [...line.slice(0, stop.i), stop.p]
  }
  if (s > 2) {
    tail = triangle(along(pts, s).p, pts[0], s * 0.62)
    const from = along(line, s * 0.8)
    line = [from.p, ...line.slice(from.i)]
  }
  return { line, heads: [tip, tail].filter(Boolean), tip, tail }
}
/** How long the heads of a line are, by how much of it runs each way. */
export function headSizes(f, weight) {
  const all = (f.fw || 0) + (f.bw || 0)
  if (!all) return null
  const size = (w) => (w / all < 0.12 ? 0 : (6 + 1.1 * weight) * (0.6 + 0.4 * Math.sqrt(w / all)))
  return { end: size(f.fw), start: size(f.bw) }
}

/** A line moved sideways. */
function aside(pts, d) {
  if (!d) return pts
  return pts.map((p, i) => {
    const q = pts[Math.max(0, i - 1)]
    const r = pts[Math.min(pts.length - 1, i + 1)]
    const g = gap(q, r) || 1
    return [p[0] - ((r[1] - q[1]) / g) * d, p[1] + ((r[0] - q[0]) / g) * d]
  })
}
/** The same curve as `arc`, in pixels. */
function curve(p, q, bow = 0.16, n = 18) {
  const c = [(p[0] + q[0]) / 2 + (q[1] - p[1]) * bow, (p[1] + q[1]) / 2 - (q[0] - p[0]) * bow]
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return [u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]]
  })
}

/** Directions moved apart until each has its room; `need` is in radians. */
export function spread(list) {
  const s = [...list].sort((x, y) => x.angle - y.angle)
  if (s.length < 2) return
  const sum = s.reduce((k, x) => k + x.need, 0)
  const fit = Math.min(1, (2 * Math.PI) / sum)
  for (let pass = 0; pass < 60; pass++) {
    let moved = 0
    for (let k = 0; k < s.length; k++) {
      const x = s[k]
      const y = s[(k + 1) % s.length]
      const space = (y.angle - x.angle) + (k === s.length - 1 ? 2 * Math.PI : 0)
      const short = ((x.need + y.need) / 2) * fit - space
      if (short > 1e-3) { x.angle -= short / 2; y.angle += short / 2; moved += short }
    }
    if (moved < 1e-2) break
  }
}

/** A loop large enough for its line to leave a hole. */
function openLoop(pts, weight) {
  const [x, y] = pts[0]
  const high = Math.max(...pts.map((p) => y - p[1]))
  const k = Math.max(1, (22 + 2.4 * weight) / high)
  return k === 1 ? pts : pts.map((p) => [x + (p[0] - x) * k, y + (p[1] - y) * k])
}

const GAP = 2           // between the lines of a link, px
const HUB = [5, 38]         // how far from its middle the lines of a place end, px
/**
 * Flows as they are drawn, in pixels. A flow with `fw` or `bw` has arrowheads,
 * and its end at a place keeps clear of the ends of others there; one with
 * `parts` is so many strands side by side, as wide as their shares.
 */
export function layout(flows, project, width = 6) {
  // what stays is often most of it: it must not make threads of the rest
  const top = Math.max(1, ...flows.filter((f) => !f.loop).map((f) => f.w))
  const items = flows.map((f) => {
    const weight = f.fixed ?? Math.max(f.hotAs ? 2 : 1, width * (f.loop ? 0.7 : 1) * Math.sqrt(Math.min(1, f.w / top))) + (f.strong ? 2 : 0)
    const lines = (f.parts || []).filter((p) => p.share >= 0.04).length
    const heads = f.fixed ? null : headSizes(f, weight)
    return { f, weight, heads, lines, a: project(f.from), b: project(f.to) }
  })
  const hubs = new Map()
  for (const it of items) {
    if (!it.heads || it.f.loop || it.f.path) continue
    const mid = curve(it.a, it.b)
    const ends = [[it.f.from, it.a, mid[3], 'a', it.heads.start], [it.f.to, it.b, mid[mid.length - 4], 'b', it.heads.end]]
    for (const [at, p, toward, side, head] of ends) {
      const key = at.join()
      if (!hubs.has(key)) hubs.set(key, { p, ends: [] })
      hubs.get(key).ends.push({ it, side, angle: Math.atan2(toward[1] - p[1], toward[0] - p[0]), px: Math.max(it.weight + (it.lines > 1 ? GAP * (it.lines - 1) + 1.8 * it.lines : 0), head * 1.24) + 1.5 })
    }
  }
  for (const { p, ends } of hubs.values()) {
    if (ends.length < 2) continue
    const r = Math.min(HUB[1], Math.max(HUB[0], (ends.reduce((s, e) => s + e.px, 0) / (2 * Math.PI)) * 1.6))
    for (const e of ends) e.need = e.px / r
    spread(ends)
    for (const e of ends) e.it[e.side === 'a' ? 'a2' : 'b2'] = [p[0] + r * Math.cos(e.angle), p[1] + r * Math.sin(e.angle)]
  }
  return items.map(({ f, weight, heads, a, b, a2, b2 }) => {
    const pts = f.path ? f.path.map(project) : f.loop ? openLoop(loop(f.from, f.loop).map(project), weight) : curve(a2 || a, b2 || b)
    const bare = arrowed(pts, heads || {})
    // a line a mode, side by side with a gap: as wide as it would be alone
    // with the share it has, and never so thin that it cannot be seen
    let parts = (f.parts || []).filter((p) => p.share >= 0.04)
    if (parts.length < 2) parts = [{ color: parts.length && f.parts ? parts[0].color : f.color, share: 1 }]
    const all = parts.reduce((s, p) => s + p.share, 0)
    const widths = parts.map((p) => (parts.length > 1 ? Math.max(1.8, weight * (p.share / all)) : weight))
    const span = widths.reduce((s, x) => s + x, 0) + GAP * (parts.length - 1)
    let at = -span / 2
    const strands = []
    const tops = []
    const outlines = []
    parts.forEach((p, k) => {
      const wk = widths[k]
      const off = at + wk / 2
      at += wk + GAP
      if (parts.length === 1) {
        strands.push({ color: p.color, weight: wk, pts: bare.line })
        for (const h of bare.heads) tops.push({ color: p.color, pts: h })
        outlines.push(...bare.heads)
        return
      }
      const own = arrowed(aside(pts, off), heads ? headSizes(f, wk) : {})
      strands.push({ color: p.color, weight: wk, pts: own.line })
      for (const h of own.heads) tops.push({ color: p.color, pts: h })
      outlines.push(...own.heads)
    })
    return { f, weight: span, line: bare.line, strands, heads: tops, outlines }
  })
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
