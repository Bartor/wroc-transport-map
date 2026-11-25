// Where traffic goes when streets are shut: the model of etl/closure.py, small
// enough to run in a browser. No DOM here; assign.worker.js keeps it off the
// page's thread.
//
// A segment is a piece of street between junctions. Segment k is arc 2k along
// its geometry and 2k+1 against it; flows are vehicles on arcs over the
// model's eight hours (6-10 and 15-19).

/** Numbers stored as differences, back as they were. */
export function undelta(list) {
  const out = new Array(list.length)
  let at = 0
  for (let i = 0; i < list.length; i++) out[i] = at += list[i]
  return out
}

/** The exported model, ready to run. */
export function load(json) {
  const { meta, names, classes, nodes, segs, zones, od } = json
  const lat = undelta(nodes.lat)
  const lon = undelta(nodes.lon)
  const m = segs.u.length
  const n = lat.length
  const tail = new Int32Array(2 * m)
  const head = new Int32Array(2 * m)
  const t0 = new Float64Array(2 * m).fill(Infinity)
  const cap = new Float64Array(2 * m).fill(1)
  const len = new Float64Array(m)
  let g = 0
  const segments = []
  for (let k = 0; k < m; k++) {
    const [u, v] = [segs.u[k], segs.v[k]]
    tail[2 * k] = head[2 * k + 1] = u
    head[2 * k] = tail[2 * k + 1] = v
    if (segs.open[k] & 1) t0[2 * k] = segs.tf[k] / 10
    if (segs.open[k] & 2) t0[2 * k + 1] = segs.tb[k] / 10
    cap[2 * k] = cap[2 * k + 1] = segs.cap[k]
    len[k] = segs.len[k]
    // geometry: the ends are nodes, what lies between is steps from the start
    const path = [[lat[u] / 1e5, lon[u] / 1e5]]
    let [la, lo] = [lat[u], lon[u]]
    for (let i = 0; i < segs.mid[k]; i++) {
      la += segs.geom[g++]
      lo += segs.geom[g++]
      path.push([la / 1e5, lo / 1e5])
    }
    path.push([lat[v] / 1e5, lon[v] / 1e5])
    segments.push({
      id: k, name: names[segs.name[k]], cls: classes[segs.cls[k]], len: segs.len[k],
      path, oneway: segs.open[k] !== 3,
    })
  }
  const model = {
    meta, n, m, tail, head, t0, cap, len, segments,
    src: Int32Array.from(zones.nodes), off: Int32Array.from(undelta(zones.off)),
    trips: unpackTrips(od, zones.off.length - 1),
    base: Float64Array.from(json.base),
  }
  return index(model)
}

/** Arcs out of each node, in the order etl/closure.py has them. */
function index(model) {
  const { n, tail, t0 } = model
  const first = new Int32Array(n + 1)
  for (let a = 0; a < tail.length; a++) if (t0[a] < Infinity) first[tail[a] + 1]++
  for (let i = 0; i < n; i++) first[i + 1] += first[i]
  const at = first.slice()
  const arc = new Int32Array(first[n])
  for (let a = 0; a < tail.length; a++) if (t0[a] < Infinity) arc[at[tail[a]]++] = a
  return Object.assign(model, { first, arc })
}

/** Tenths of a vehicle, zeros as runs: -3 is three pairs without a trip. */
export function unpackTrips(list, zones) {
  const out = new Float64Array(zones * zones)
  let i = 0
  for (const v of list) {
    if (v < 0) i -= v
    else out[i++] = v / 10
  }
  return out
}

/** One look at the streets: an even number in [-1, 1) for each arc. */
export function wobble(seed, out) {
  let s = seed | 0
  for (let i = 0; i < out.length; i++) {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1
  }
  return out
}

// Times are whole fifths of a second, so that a shelf per time can stand in
// for a heap and both models add up the same. A ring of shelves is enough: no
// arc takes longer than the ring is round.
const TICK = 5
const RING = 8192
const NEVER = 1 << 30

const scratch = ({ n, tail }) => ({
  dist: new Int32Array(n), prev: new Int32Array(n), order: new Int32Array(n),
  vol: new Float64Array(n), hit: new Uint8Array(n),
  shelf: new Int32Array(RING).fill(-1), what: new Int32Array(tail.length + 4 * n),
  under: new Int32Array(tail.length + 4 * n),
  cost: new Int32Array(tail.length), look: new Float64Array(tail.length),
})

/** Arc times as look k sees them. */
function price(model, flow, k, { cost, look }) {
  const { t0, cap, meta: { params: { alpha, noise } } } = model
  wobble(1000 + k, look)
  for (let a = 0; a < cost.length; a++) {
    cost[a] = t0[a] === Infinity ? NEVER : Math.max(1, Math.min(RING - 1,
      Math.floor(seconds(t0[a], flow[a], cap[a], alpha) * (1 + noise * look[a]) * TICK + 0.5)))
  }
}

/** Quickest times from zone o; returns how many nodes were reached, in order. */
function tree({ first, arc, head, src, off }, o, w) {
  const { dist, prev, order, shelf, what, under, cost } = w
  dist.fill(NEVER)
  prev.fill(-1)
  let used = 0
  let left = 0
  for (let j = off[o]; j < off[o + 1]; j++) {
    const v = src[j]
    if (dist[v] > 0) {
      dist[v] = 0
      what[used] = v
      under[used] = shelf[0]
      shelf[0] = used++
      left++
    }
  }
  let cnt = 0
  let d = 0
  while (left) {
    let e = shelf[d & (RING - 1)]
    if (e >= 0) {
      shelf[d & (RING - 1)] = -1
      while (e >= 0) {
        const u = what[e]
        e = under[e]
        left--
        if (dist[u] === d) {
          order[cnt++] = u
          for (let q = first[u]; q < first[u + 1]; q++) {
            const a = arc[q]
            const nd = d + cost[a]
            const v = head[a]
            if (nd < dist[v]) {
              dist[v] = nd
              prev[v] = a
              what[used] = v
              under[used] = shelf[nd & (RING - 1)]
              shelf[nd & (RING - 1)] = used++
              left++
            }
          }
        }
      }
    }
    d++
  }
  return cnt
}

/** Where zone d is entered, as the last tree left it; -1 when it cannot be. */
function entry({ src, off }, dist, d) {
  let best = NEVER
  let v = -1
  for (let j = off[d]; j < off[d + 1]; j++) {
    if (dist[src[j]] < best) {
      best = dist[src[j]]
      v = src[j]
    }
  }
  return v
}

/** Every trip on its quickest way, added to flow; trips with no way at all
 *  are returned. */
function loadAll(model, trips, flow, w) {
  const { tail, off } = model
  const { dist, prev, order, vol } = w
  const Z = off.length - 1
  let lost = 0
  flow.fill(0)
  for (let o = 0; o < Z; o++) {
    const cnt = tree(model, o, w)
    vol.fill(0)
    for (let d = 0; d < Z; d++) {
      const t = trips[o * Z + d]
      if (!(t > 0) || d === o) continue
      const v = entry(model, dist, d)
      if (v >= 0) vol[v] += t
      else lost += t
    }
    for (let q = cnt - 1; q >= 0; q--) {
      const v = order[q]
      const a = prev[v]
      if (a >= 0 && vol[v] > 0) {
        flow[a] += vol[v]
        vol[tail[a]] += vol[v]
      }
    }
  }
  return lost
}

/** Seconds on an arc carrying this much. Both models spell the fourth power
 *  out, so they round alike. */
export function seconds(t0, flow, cap, alpha) {
  const x = flow / cap
  const x2 = x * x
  return t0 * (1 + alpha * (x2 * x2))
}

/** The street network with a change made to it.
 *  closed: segments shut both ways; oneWay: segment -> 1 to keep only the way
 *  along its geometry, -1 only against; capacity: segment -> factor. */
export function changed(model, { closed, oneWay, capacity } = {}) {
  const t0 = model.t0.slice()
  const cap = model.cap.slice()
  for (const k of closed || []) t0[2 * k] = t0[2 * k + 1] = Infinity
  for (const [k, way] of oneWay || []) t0[way > 0 ? 2 * k + 1 : 2 * k] = Infinity
  for (const [k, f] of capacity || []) {
    cap[2 * k] *= f
    cap[2 * k + 1] *= f
  }
  return { ...model, t0, cap }
}

/** Every trip routed by the times `flow` makes, as look k sees the streets. */
function route(model, trips, flow, k, out, w) {
  price(model, flow, k, w)
  return loadAll(model, trips, out, w)
}

const mean = (list, n) => {
  const out = new Float64Array(n)
  for (const f of list) for (let a = 0; a < n; a++) out[a] += f[a] / list.length
  return out
}

/** The undisturbed traffic, look by look; worked out once and kept. */
export function undisturbed(model, onStep = () => {}) {
  if (!model.was) {
    const { looks } = model.meta.params
    const w = scratch(model)
    model.was = []
    for (let k = 0; k < looks; k++) {
      const f = new Float64Array(model.tail.length)
      route(model, model.trips, model.base, k, f, w)
      model.was.push(f)
      onStep((k + 1) / looks)
    }
    model.before = mean(model.was, model.tail.length)
  }
  return model.was
}

/** Traffic after the network becomes `next`: each look routed at the settled
 *  traffic plus the change so far. Where the change does not reach, it equals
 *  the traffic before to the vehicle - settling both afresh would leave
 *  differences of its own all over the city. */
export function reroute(model, next, trips, onStep = () => {}) {
  const was = undisturbed(model)
  const { looks, heed } = model.meta.params
  const A = model.tail.length
  const x = new Float64Array(A)
  const at = new Float64Array(A)
  const f = new Float64Array(A)
  const after = new Float64Array(A)
  const w = scratch(model)
  let lost = 0
  for (let k = 0; k < looks; k++) {
    // too small a change to tell from the draw of looks is let pass, or it
    // would send others round in turn, all the way across the city
    for (let a = 0; a < A; a++) {
      const y = Math.max(0, Math.abs(x[a]) - heed * model.cap[a])
      at[a] = Math.max(0, model.base[a] + (x[a] < 0 ? -y : y))
    }
    lost = route(next, trips, at, k, f, w)
    for (let a = 0; a < A; a++) {
      after[a] += (f[a] - after[a]) / (k + 1)
      x[a] += (f[a] - was[k][a] - x[a]) / (k + 1)
    }
    onStep((k + 1) / looks)
  }
  return { flow: after, lost }
}

/** Traffic once drivers have tried the streets, from nothing: how the model's
 *  own base is made. The mean of rounds, each routed by the times the rounds
 *  before it left behind. */
export function settle(model, trips, rounds) {
  const A = model.tail.length
  const flow = new Float64Array(A)
  const f = new Float64Array(A)
  const w = scratch(model)
  for (let k = 0; k < rounds; k++) {
    route(model, trips, flow, k % model.meta.params.looks, f, w)
    for (let a = 0; a < A; a++) flow[a] += (f[a] - flow[a]) / (k + 1)
  }
  return flow
}

/** The share of each pair's trips that went through these arcs, and how many
 *  trips that is. */
export function through(model, arcs, looks = 2) {
  const { off, tail } = model
  const Z = off.length - 1
  const on = new Uint8Array(tail.length)
  for (const a of arcs) on[a] = 1
  const share = new Float64Array(Z * Z)
  const w = scratch(model)
  let sum = 0
  for (let k = 0; k < looks; k++) {
    price(model, model.base, k, w)
    for (let o = 0; o < Z; o++) {
      const cnt = tree(model, o, w)
      w.hit.fill(0)
      for (let q = 0; q < cnt; q++) {
        const v = w.order[q]
        const a = w.prev[v]
        if (a >= 0) w.hit[v] = on[a] | w.hit[tail[a]]
      }
      for (let d = 0; d < Z; d++) {
        const t = model.trips[o * Z + d]
        if (!(t > 0) || d === o) continue
        const v = entry(model, w.dist, d)
        if (v >= 0 && w.hit[v]) {
          share[o * Z + d] += 1 / looks
          sum += t / looks
        }
      }
    }
  }
  return { share, trips: sum }
}

/** Vehicle-kilometres, and -hours by times never checked against real ones:
 *  good for telling changes apart, not for minutes on a page. */
function tally(model, flow) {
  const { alpha } = model.meta.params
  let km = 0
  let h = 0
  for (let a = 0; a < flow.length; a++) {
    if (!(flow[a] > 0) || model.t0[a] === Infinity) continue
    const l = model.len[a >> 1] / 1000
    km += flow[a] * l
    h += (flow[a] * seconds(model.t0[a], flow[a], model.cap[a], alpha)) / 3600
  }
  return { vehKm: km, vehHours: h }
}

/**
 * What a change does. `reduce` is the share of the trips through the shut or
 * narrowed streets that stop being made by car - an assumption, none by default.
 * Returns flows on arcs before and after, and sums over the whole area.
 */
export function run(model, change = {}, onStep = () => {}) {
  const next = changed(model, change)
  const touched = []
  for (let a = 0; a < model.t0.length; a++) {
    if (model.t0[a] < Infinity && (next.t0[a] === Infinity || next.cap[a] < model.cap[a])) touched.push(a)
  }
  // who used to pass: all that a demand cut may touch
  const was = through(model, touched)
  onStep(0.1)
  let { trips } = model
  let gone = 0
  if (change.reduce > 0) {
    trips = trips.slice()
    for (let i = 0; i < trips.length; i++) {
      const cut = trips[i] * was.share[i] * change.reduce
      trips[i] -= cut
      gone += cut
    }
  }
  undisturbed(model)
  const { flow, lost } = reroute(model, next, trips, (p) => onStep(0.1 + 0.9 * p))
  const before = tally(model, model.before)
  const after = tally(next, flow)
  return {
    before: model.before, after: flow,
    summary: { before, after, affected: was.trips, gone, lost },
  }
}

/** Both ways of a segment together. */
export const onSegment = (flow, k) => flow[2 * k] + flow[2 * k + 1]

/** Streets by how much their traffic changes, the busiest place of each. */
export function byStreet(model, { before, after }, closed = new Set()) {
  const by = new Map()
  for (const s of model.segments) {
    if (!s.name || closed.has(s.id)) continue
    const a = onSegment(before, s.id)
    const b = onSegment(after, s.id)
    const was = by.get(s.name)
    if (!was || Math.abs(b - a) > Math.abs(was.after - was.before)) {
      by.set(s.name, { name: s.name, id: s.id, before: a, after: b })
    }
  }
  return [...by.values()].sort((p, q) => Math.abs(q.after - q.before) - Math.abs(p.after - p.before))
}
