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
