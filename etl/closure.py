# -*- coding: utf-8 -*-
"""What closing streets does to the traffic on the others.

The network model (network.py) says how much traffic a street carries; it
cannot say where that traffic goes when the street is shut, because it has no
trips and no capacities. This one has both: trips between the survey's zones
and the roads out of the city, routed over the OSM graph by travel times that
grow with traffic (BPR), and adjusted until the routed traffic agrees with the
counts.

    python etl/closure.py build       # calibrate -> public/data/closure.json
    python etl/closure.py validate    # error on counting points left out
    python etl/closure.py closures    # a few closures, to look at
    python etl/closure.py experiment  # 2018 -> 2024: al. Wielkiej Wyspy

Nothing finer than the survey's zones goes in: zone totals of car trips,
residents (annex 3.1) and jobs (12.3).
"""
import collections, json, math, os, sys, time
import urllib.parse
import numpy as np
from numba import njit, prange

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode, diary
import network as N

ROOT = diary.ROOT
log = lambda *a: print(*a, file=sys.stderr, flush=True)

HOURS = 8                               # N.COMMON_HOURS: 6-10 and 15-19
CARS = ["c", "d", "e", "f", "g", "h", "i", "l"]   # what picks its own route
BUFFER = 1500.0                         # m of every street beyond the boundary

# vehicles an hour and lane, with the junctions of such a street priced in
CAPACITY = {"motorway": 1900, "trunk": 1700, "primary": 950, "secondary": 800,
            "tertiary": 600, "unclassified": 450, "residential": 300,
            "living_street": 150, "motorway_link": 1300, "trunk_link": 1200,
            "primary_link": 800, "secondary_link": 700, "tertiary_link": 550}
# free-flow speed as a share of the limit, before signals
PACE = {"motorway": 0.9, "trunk": 0.9, "primary": 0.82, "secondary": 0.78,
        "tertiary": 0.7, "unclassified": 0.65, "residential": 0.55,
        "living_street": 0.5}

P = {                                   # chosen on counts left out and on how
                                        # steady closures come out; both are flat
    "signal": 9.0,                      # s a signal node costs
    "alpha": 0.8,                       # BPR, to the fourth power
    "peak": 0.88,                       # share of 8 h capacity usable evenly
    "noise": 0.6,                       # how differently drivers see a street
    "looks": 24,                        # how many ways of seeing them there are
    "iters": 48,                        # rounds until traffic settles
    "heed": 0.03,                       # of capacity: a change others react to
    "decay": 0.17,                      # 1/km, car trips
    "through": 0.25,                    # of cordon traffic, crossing the city
    "scale": 1.45,                      # trips the diary misses
    "sdZone": 0.5, "sdGate": 0.7, "sdPair": 0.35, "err": 0.09,
}


# -------------------------------------------------------------------- source
def closed_to_cars():
    """OSM ways a car may not drive through."""
    path = os.path.join(geocode.CACHE, "overpass_access.json")
    keys = ("access", "vehicle", "motor_vehicle", "motorcar")
    if not os.path.exists(path):
        c = "|".join(N.DRIVABLE)
        q = "[out:json][timeout:300];(%s);out tags qt;" % "".join(
            'way["highway"~"^(%s)$"]["%s"](%f,%f,%f,%f);' % (c, k, *geocode.BBOX) for k in keys)
        js = json.loads(geocode._get("https://overpass-api.de/api/interpreter",
                                     data=urllib.parse.urlencode({"data": q}).encode()))
        out = {str(e["id"]): {k: e["tags"][k] for k in keys if k in e["tags"]}
               for e in js["elements"]}
        json.dump(out, open(path, "w", encoding="utf8"))
    shut = set()
    for wid, t in json.load(open(path, encoding="utf8")).items():
        # the most specific tag decides
        v = next((t[k] for k in reversed(keys) if k in t), "yes")
        if v in ("no", "private", "customers", "delivery", "agricultural", "forestry"):
            shut.add(int(wid))
    return shut


class Near:
    """Inside, and metres to, a set of rings."""

    def __init__(self, rings):
        self.k = (111320 * math.cos(math.radians(N.CENTRE[0])), 111320)
        self.rings = [np.array(r) for r in rings]

    def inside(self, la, lo):
        c = False
        for r in self.rings:
            y, x = r[:, 0], r[:, 1]
            y2, x2 = np.roll(y, 1), np.roll(x, 1)
            hit = (y > la) != (y2 > la)
            with np.errstate(divide="ignore", invalid="ignore"):
                xs = (x2 - x) * (la - y) / (y2 - y) + x
            c ^= bool(np.sum(hit & (lo < xs)) % 2)
        return c

    def dist(self, la, lo):
        return min(float(np.min(np.hypot((r[:, 0] - la) * self.k[1],
                                         (r[:, 1] - lo) * self.k[0]))) for r in self.rings)


def boundary():
    """The city's outline: rings joined from the cached relation's ways."""
    ways = [list(map(tuple, w)) for w in
            json.load(open(os.path.join(geocode.CACHE, "wroclaw_boundary.json"), encoding="utf8"))]
    rings = []
    while ways:
        r = ways.pop()
        while r[0] != r[-1]:
            for i, w in enumerate(ways):
                if w[0] == r[-1]:
                    r += ways.pop(i)[1:]
                    break
                if w[-1] == r[-1]:
                    r += ways.pop(i)[::-1][1:]
                    break
            else:
                break
        rings.append(r)
    return Near(rings)


# --------------------------------------------------------------------- graph
MAJOR = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link",
         "primary_link", "secondary_link"}


def lanes_of(e):
    """Lanes each way of a raw edge."""
    one = not (e["fwd"] and e["bwd"])
    if e["tagged"]:
        n = e["lanes"]
        return max(1.0, n) if one else max(1.0, n / 2)
    return 2.0 if one and e["hw"] in ("motorway", "trunk", "primary") else 1.0


def raw_edges():
    shut = closed_to_cars()
    ways = [w for w in N.fetch() if w["id"] not in shut]
    tagged = {w["id"]: N._num(w.get("lanes")) for w in ways}
    edges, _, coord = N.build_graph(ways)
    for e in edges:
        e["tagged"] = tagged[e["wid"]] is not None
    return edges, coord


def graph(without=()):
    """Streets between junctions, cut to the city and the main roads around,
    joined where nothing else meets, without dead ends.

    Returns segments on nodes numbered from 0, node coordinates, and gateways:
    the nodes where a road leaves the area.
    """
    edges, coord = raw_edges()
    if without:
        edges = [e for e in edges if e["wid"] not in without]
    city = boundary()
    sig = {int(k) for k, v in json.load(open(os.path.join(
        geocode.CACHE, "overpass_signal_kinds.json"), encoding="utf8")).items()
        if v[0] == "traffic_signals"}
    la0, lo0, la1, lo1 = geocode.BBOX
    keep = {}

    def wanted(n):
        if n not in keep:
            la, lo = coord[n]
            keep[n] = city.inside(la, lo) or city.dist(la, lo) < BUFFER
        return keep[n]

    edges = [e for e in edges if e["hw"] in MAJOR or e["hw"].startswith("tertiary")
             or wanted(e["u"]) or wanted(e["v"])]
    # ways run past the box they were asked for; cut them there
    inbox = lambda n: la0 <= coord[n][0] <= la1 and lo0 <= coord[n][1] <= lo1
    edges = [e for e in edges if inbox(e["u"]) or inbox(e["v"])]

    # roads leaving the area: one gateway for both carriageways
    nbr, at = collections.defaultdict(set), collections.defaultdict(list)
    for e in edges:
        nbr[e["u"]].add(e["v"])
        nbr[e["v"]].add(e["u"])
        at[e["u"]].append(e)
        at[e["v"]].append(e)
    ends = []
    for n, b in nbr.items():
        la, lo = coord[n]
        rim = not inbox(n) or min(la - la0, la1 - la, (lo - lo0) * .63, (lo1 - lo) * .63) < 0.002
        if rim and len(b) == 1 and (at[n][0]["hw"] in MAJOR or at[n][0]["hw"] == "tertiary"):
            ends.append(n)
    gates = []
    for n in sorted(ends):
        for g in gates:
            if any(N.haversine(coord[n], coord[m]) < 250
                   and at[n][0]["hw"] == at[m][0]["hw"] for m in g):
                g.append(n)
                break
        else:
            gates.append([n])

    # only what can reach everything and be reached from it
    import scipy.sparse as sp
    from scipy.sparse.csgraph import connected_components
    ids = {n: i for i, n in enumerate(nbr)}
    r, c = [], []
    for e in edges:
        u, v = ids[e["u"]], ids[e["v"]]
        if e["fwd"]:
            r.append(u)
            c.append(v)
        if e["bwd"]:
            r.append(v)
            c.append(u)
    for g in gates:
        for a in g:
            for b in g:
                r.append(ids[a])
                c.append(ids[b])
    _, lab = connected_components(sp.csr_matrix((np.ones(len(r)), (r, c)), (len(ids),) * 2),
                                  directed=True, connection="strong")
    big = np.bincount(lab).argmax()
    ok = {n for n, i in ids.items() if lab[i] == big}
    edges = [e for e in edges if e["u"] in ok and e["v"] in ok]
    gates = [g for g in ([n for n in g if n in ok] for g in gates) if g]
    fixed = {n for g in gates for n in g}

    segs = []
    for e in edges:
        lanes = lanes_of(e)
        pace = PACE.get(e["hw"], 0.7)
        # signals on the way, and the one at the end for whoever arrives there
        mid = sum(n in sig for n in e["nodes"][1:-1])
        segs.append({
            "u": e["u"], "v": e["v"], "g": [tuple(p) for p in e["g"]], "hw": e["hw"],
            "name": e["name"] or "", "len": e["len"], "lanes": lanes, "ref": e["ref"] or "",
            "t": e["len"] / (e["speed"] / 3.6 * pace), "cap": CAPACITY[e["hw"]] * lanes,
            "sf": mid + (e["v"] in sig), "sb": mid + (e["u"] in sig),
            "fwd": e["fwd"], "bwd": e["bwd"], "wids": [e["wid"]],
        })
    segs = trim(join(trim(segs, fixed), fixed), fixed)
    ids = {}
    for s in segs:
        for k in "uv":
            s[k] = ids.setdefault(s[k], len(ids))
    xy = np.zeros((len(ids), 2))
    for n, i in ids.items():
        xy[i] = coord[n]
    gates = [[ids[n] for n in g if n in ids] for g in gates]
    return segs, xy, [g for g in gates if g]


def trim(segs, fixed):
    """Without streets that only lead to themselves."""
    while True:
        deg = collections.Counter()
        for s in segs:
            if s["u"] != s["v"]:
                deg[s["u"]] += 1
                deg[s["v"]] += 1
        dead = lambda n: deg[n] < 2 and n not in fixed
        out = [s for s in segs if s["u"] != s["v"] and not dead(s["u"]) and not dead(s["v"])]
        if len(out) == len(segs):
            return segs
        segs = out


def join(segs, fixed):
    """Two pieces of one street meeting where nothing else does become one."""
    segs = list(segs)
    at = collections.defaultdict(list)
    for i, s in enumerate(segs):
        at[s["u"]].append(i)
        at[s["v"]].append(i)
    gone = set()
    for n in list(at):
        if n in fixed or len(at[n]) != 2:
            continue
        a, b = at[n]
        if a == b:
            continue
        A, B = segs[a], segs[b]
        if A["name"] != B["name"] or A["hw"] != B["hw"]:
            continue
        A = A if A["v"] == n else flip(A)
        B = B if B["u"] == n else flip(B)
        if (A["fwd"], A["bwd"]) != (B["fwd"], B["bwd"]) or A["u"] == B["v"]:
            continue
        segs[a] = {**A, "v": B["v"], "g": A["g"] + B["g"][1:], "len": A["len"] + B["len"],
                   "t": A["t"] + B["t"], "cap": min(A["cap"], B["cap"]),
                   "lanes": min(A["lanes"], B["lanes"]), "wids": A["wids"] + B["wids"],
                   "sf": A["sf"] + B["sf"], "sb": A["sb"] + B["sb"]}
        gone.add(b)
        at[B["v"]] = [a if i == b else i for i in at[B["v"]]]
    return [s for i, s in enumerate(segs) if i not in gone]


def flip(s):
    return {**s, "u": s["v"], "v": s["u"], "g": s["g"][::-1], "fwd": s["bwd"],
            "bwd": s["fwd"], "sf": s["sb"], "sb": s["sf"]}


class Net:
    """Arcs of the graph: segment k is arc 2k along it and 2k+1 against it."""

    def __init__(self, segs, xy, p=P):
        self.segs, self.xy = segs, xy
        m = len(segs)
        self.n = len(xy)
        self.tail = np.zeros(2 * m, np.int32)
        self.head = np.zeros(2 * m, np.int32)
        self.t0 = np.full(2 * m, np.inf)
        self.cap = np.ones(2 * m)
        self.len = np.zeros(2 * m)
        for k, s in enumerate(segs):
            for d, (a, b, open_, sg) in enumerate(((s["u"], s["v"], s["fwd"], s["sf"]),
                                                   (s["v"], s["u"], s["bwd"], s["sb"]))):
                i = 2 * k + d
                self.tail[i], self.head[i], self.len[i] = a, b, s["len"]
                self.cap[i] = s["cap"] * HOURS * p["peak"]
                if open_:
                    self.t0[i] = s["t"] + p["signal"] * sg
        order = np.argsort(self.tail, kind="stable")
        order = order[np.isfinite(self.t0[order])]
        self.arc = order.astype(np.int32)
        self.first = np.searchsorted(self.tail[order], np.arange(self.n + 1)).astype(np.int32)

    def shut(self, segs):
        """The same, with segments shut."""
        o = Net.__new__(Net)
        o.__dict__.update(self.__dict__)
        o.t0 = self.t0.copy()
        for k in segs:
            o.t0[2 * k:2 * k + 2] = np.inf
        return o


# ---------------------------------------------------------------- assignment
# Times are whole fifths of a second, so that a shelf per time can stand in for
# a heap and both models add up the same. A ring of shelves is enough: no arc
# takes longer than the ring is round.
TICK, RING, NEVER = 5, 8192, 1 << 30


def price(net, flow, k, p=P):
    """Arc times as look k sees them."""
    t = seconds(net, flow, p) * (1 + p["noise"] * wobble(1000 + k, len(net.tail)))
    out = np.full(len(t), NEVER, np.int32)
    ok = np.isfinite(t)
    out[ok] = np.maximum(1, np.minimum(RING - 1, np.floor(t[ok] * TICK + 0.5))).astype(np.int32)
    return out


@njit(cache=True)
def tree(first, arc, head, cost, src, off, o, dist, prev, order, shelf, what, under):
    """Quickest times from zone o's entry nodes; the nodes in the order reached."""
    dist[:] = NEVER
    prev[:] = -1
    used = left = cnt = d = 0
    for j in range(off[o], off[o + 1]):
        v = src[j]
        if dist[v] > 0:
            dist[v] = 0
            what[used], under[used] = v, shelf[0]
            shelf[0] = used
            used += 1
            left += 1
    while left:
        e = shelf[d & (RING - 1)]
        if e >= 0:
            shelf[d & (RING - 1)] = -1
            while e >= 0:
                u = what[e]
                e = under[e]
                left -= 1
                if dist[u] == d:
                    order[cnt] = u
                    cnt += 1
                    for q in range(first[u], first[u + 1]):
                        a = arc[q]
                        nd = d + cost[a]
                        v = head[a]
                        if nd < dist[v]:
                            dist[v] = nd
                            prev[v] = a
                            what[used], under[used] = v, shelf[nd & (RING - 1)]
                            shelf[nd & (RING - 1)] = used
                            used += 1
                            left += 1
        d += 1
    return cnt


@njit(parallel=True, cache=True)
def load_all(n, first, arc, tail, head, cost, src, off, dst, doff, od, nthread):
    """Every trip on its quickest way: flow on arcs, time of each pair."""
    Z = len(off) - 1
    flow = np.zeros((nthread, len(tail)))
    times = np.full((Z, Z), np.inf)
    for th in prange(nthread):
        dist, prev = np.empty(n, np.int32), np.empty(n, np.int32)
        order, vol = np.empty(n, np.int32), np.zeros(n)
        shelf = np.full(RING, -1, np.int32)
        what, under = np.empty(len(tail) + 4 * n, np.int32), np.empty(len(tail) + 4 * n, np.int32)
        for o in range(th, Z, nthread):
            cnt = tree(first, arc, head, cost, src, off, o, dist, prev, order, shelf, what, under)
            vol[:] = 0.0
            for d in range(Z):
                best, bv = NEVER, -1
                for j in range(doff[d], doff[d + 1]):
                    if dist[dst[j]] < best:
                        best, bv = dist[dst[j]], dst[j]
                if bv >= 0:
                    times[o, d] = best / TICK
                if bv >= 0 and d != o:
                    vol[bv] += od[o, d]
            for q in range(cnt - 1, -1, -1):
                v = order[q]
                a = prev[v]
                if a >= 0 and vol[v] > 0:
                    flow[th, a] += vol[v]
                    vol[tail[a]] += vol[v]
    out = np.zeros(len(tail))
    for th in range(nthread):
        out += flow[th]
    return out, times


@njit(parallel=True, cache=True)
def trace(n, first, arc, tail, head, cost, src, off, dst, doff, od, tag, room, nthread):
    """Which counted arcs (tag >= 0) each pair's way uses."""
    Z = len(off) - 1
    rows = np.full((nthread, room), -1, np.int32)
    cols = np.zeros((nthread, room), np.int32)
    num = np.zeros(nthread, np.int64)
    for th in prange(nthread):
        dist, prev = np.empty(n, np.int32), np.empty(n, np.int32)
        order = np.empty(n, np.int32)
        shelf = np.full(RING, -1, np.int32)
        what, under = np.empty(len(tail) + 4 * n, np.int32), np.empty(len(tail) + 4 * n, np.int32)
        k = 0
        for o in range(th, Z, nthread):
            tree(first, arc, head, cost, src, off, o, dist, prev, order, shelf, what, under)
            for d in range(Z):
                if od[o, d] <= 0 or d == o:
                    continue
                best, v = NEVER, -1
                for j in range(doff[d], doff[d + 1]):
                    if dist[dst[j]] < best:
                        best, v = dist[dst[j]], dst[j]
                while v >= 0 and prev[v] >= 0:
                    a = prev[v]
                    if tag[a] >= 0 and k < room:
                        rows[th, k] = tag[a]
                        cols[th, k] = o * Z + d
                        k += 1
                    v = tail[a]
        num[th] = k
    return rows, cols, num


@njit(cache=True)
def wobble(seed, m):
    """One look at the streets: an even number in [-1, 1) for each arc, from
    32-bit steps that come out the same in assign.js."""
    M = np.uint64(0xFFFFFFFF)
    out = np.empty(m)
    s = np.uint64(seed)
    for i in range(m):
        s = (s + np.uint64(0x6D2B79F5)) & M
        t = s
        t = ((t ^ (t >> np.uint64(15))) * (t | np.uint64(1))) & M
        t = (t ^ ((t + (((t ^ (t >> np.uint64(7))) * (t | np.uint64(61))) & M)) & M)) & M
        out[i] = np.float64((t ^ (t >> np.uint64(14))) & M) / 2147483648.0 - 1.0
    return out


THREADS = max(1, (os.cpu_count() or 8) - 4)


def seconds(net, flow, p=P):
    """BPR with the fourth power spelled out, to round as assign.js does."""
    x2 = (flow / net.cap) ** 2
    return net.t0 * (1 + p["alpha"] * (x2 * x2))


def settle(net, zones, od, p=P, want=None):
    """Traffic once drivers have tried the streets: averaged over rounds, each
    routed by the times the rounds before it left behind.

    want: tags of counted arcs, to get their share of every pair as well.
    """
    import numba
    import scipy.sparse as sp
    numba.set_num_threads(min(THREADS, numba.config.NUMBA_NUM_THREADS))
    m = len(net.tail)
    flow, acc = np.zeros(m), None
    times = np.zeros_like(od)
    for k in range(p["iters"]):
        args = (net.n, net.first, net.arc, net.tail, net.head, price(net, flow, k % p["looks"], p), *zones)
        f, tt = load_all(*args, od, THREADS)
        flow += (f - flow) / (k + 1)
        times += (tt - times) / (k + 1)
        if want is not None and k >= p["iters"] - p["looks"]:
            r, c, num = trace(*args, od, want, 400_000, THREADS)
            assert num.max() < 400_000
            r = np.concatenate([r[i, :num[i]] for i in range(THREADS)])
            c = np.concatenate([c[i, :num[i]] for i in range(THREADS)])
            M = sp.csr_matrix((np.full(len(r), 1 / p["looks"]), (r, c)),
                              (int(want.max()) + 1, od.size))
            acc = M if acc is None else acc + M
    return flow, times, acc


def looked(net, zones, od, flow, p=P):
    """The trips routed at the times this traffic makes, look by look."""
    return [load_all(net.n, net.first, net.arc, net.tail, net.head, price(net, flow, k, p),
                     *zones, od, THREADS)[0] for k in range(p["looks"])]


def change(net, nxt, zones, od, base, p=P, od2=None):
    """Traffic before and after the network becomes nxt.

    Both are means over the looks, each look routed twice: at the settled
    traffic, and at that traffic plus the change so far. Where the change does
    not reach, the two agree to the vehicle - settling both afresh would leave
    differences of its own all over the city.
    """
    was = looked(net, zones, od, base, p)
    m = len(net.tail)
    x, after, lost = np.zeros(m), np.zeros(m), 0.0
    for k in range(p["looks"]):
        # too small a change to tell from the draw of looks is let pass, or it
        # would send others round in turn, all the way across the city
        y = np.sign(x) * np.maximum(0, np.abs(x) - p["heed"] * net.cap)
        f, tt = load_all(nxt.n, nxt.first, nxt.arc, nxt.tail, nxt.head,
                         price(nxt, np.maximum(0, base + y), k, p), *zones,
                         od if od2 is None else od2, THREADS)
        after += (f - after) / (k + 1)
        x += (f - was[k] - x) / (k + 1)
        lost = float(od[~np.isfinite(tt)].sum())
    return np.mean(was, axis=0), after, lost


# -------------------------------------------------------------------- counts
HEADING = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


def bearing(a, b):
    dy = b[0] - a[0]
    dx = (b[1] - a[1]) * math.cos(math.radians(a[0]))
    return math.degrees(math.atan2(dx, dy)) % 360


def turn(a, b):
    return abs((a - b + 180) % 360 - 180)


def counts(net, tol=70.0):
    """Vehicles counted on each arc in the window, each direction on its own."""
    L = lambda f: json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))
    road, points, meta = L("road")["sections"], L("points"), L("meta")
    idx = [meta["vehCatOrder"].index(c) for c in CARS]
    ky, kx = 111320, 111320 * math.cos(math.radians(N.CENTRE[0]))
    pieces = []                          # (segment, a, b)
    for k, s in enumerate(net.segs):
        for a, b in zip(s["g"], s["g"][1:]):
            pieces.append((k, a, b))
    A = np.array([p[1] for p in pieces])
    B = np.array([p[2] for p in pieces])
    S = np.array([p[0] for p in pieces])
    rank = {c: i for i, c in enumerate(reversed(N.DRIVABLE))}
    out, lost = [], []
    for p in points:
        if p["id"] not in road or not p.get("lat"):
            continue
        ax, ay = (A[:, 1] - p["lon"]) * kx, (A[:, 0] - p["lat"]) * ky
        bx, by = (B[:, 1] - p["lon"]) * kx, (B[:, 0] - p["lat"]) * ky
        dx, dy = bx - ax, by - ay
        t = np.clip(-(ax * dx + ay * dy) / np.maximum(1e-9, dx * dx + dy * dy), 0, 1)
        dist = np.hypot(ax + t * dx, ay + t * dy)
        near = np.where(dist < tol)[0]
        # the street's last word: "ul. Pulaskiego" is "Generala K. Pulaskiego"
        words = {w for part in (p["name"] or "").split("/")
                 for w in geocode.norm(part).split()[-1:]}
        link = "łącznic" in (p["name"] or "").lower()
        for d, dd in road[p["id"]]["dirs"].items():
            v = sum(dd["h"][h][i] for h in N.COMMON_HOURS for i in idx)
            if v <= 0:
                continue
            a, b = (math.radians(HEADING[x]) for x in d.split(">"))
            head = math.degrees(math.atan2(math.sin(b) - math.sin(a), math.cos(b) - math.cos(a))) % 360
            best = None
            for q in near:
                k = S[q]
                s = net.segs[k]
                h = bearing(A[q], B[q])
                for arc, hh in ((2 * k, h), (2 * k + 1, (h + 180) % 360)):
                    if not np.isfinite(net.t0[arc]) or turn(hh, head) > 75:
                        continue
                    named = bool(words & set(geocode.norm(s["name"]).split()[-1:]))
                    if p["area"] == "AOW":
                        named = s["hw"] == "motorway"
                    isl = s["hw"].endswith("_link")
                    score = (-dist[q] - 0.35 * turn(hh, head) + (60 if named else 0)
                             + 4 * rank.get(s["hw"], 0) - (40 if isl and not link else 0)
                             + (40 if isl and link else 0)
                             # not on a side street that could not carry it
                             - (60 if v > 1.3 * HOURS * s["cap"] else 0))
                    if best is None or score > best[0]:
                        best = (score, arc, dist[q], named)
            if best and (best[3] or best[2] < 30):
                out.append({"id": p["id"], "dir": d, "point": p["point"], "area": p["area"],
                            "arc": int(best[1]), "v": float(v), "named": best[3],
                            "dist": float(best[2]), "name": p["name"]})
            else:
                lost.append((p["id"], d, p["name"], v))
    return out, lost


# -------------------------------------------------------------------- demand
def residents():
    import openpyxl
    ws = openpyxl.load_workbook(diary.find("3.1_agregacja"), data_only=True)["Agregacja rejonów"]
    return {str(r[1]): float(r[9]) for r in ws.iter_rows(values_only=True)
            if isinstance(r[1], (int, float)) and isinstance(r[9], (int, float))}


def middle(rings):
    r = rings[0]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
        q = x0 * y1 - x1 * y0
        a += q
        cx += (x0 + x1) * q
        cy += (y0 + y1) * q
    return (cy / (3 * a), cx / (3 * a)) if a else (r[0][1], r[0][0])


ENTRIES = 5


def places(net, gates):
    """Where trips start and end: zones with their entry nodes, then gateways."""
    import random
    rng = random.Random(4)
    pop = residents()
    Z = diary.zones()[0]
    kinds = collections.defaultdict(set)
    for s in net.segs:
        for n in (s["u"], s["v"]):
            kinds[n].add(s["hw"])
    soft = {"residential", "living_street", "unclassified", "tertiary", "secondary"}
    cand = np.array([n for n in range(net.n) if kinds[n] & soft
                     and not any(h.startswith(("motorway", "trunk")) for h in kinds[n])])
    xy = net.xy[cand]
    apart = lambda a, b: np.hypot(*((net.xy[a] - net.xy[b]) * (1, .63)))
    out = []
    for z in Z:
        shape = Near([[(la, lo) for lo, la in r] for r in z["rings"]])
        pts = np.concatenate(shape.rings)
        (la0, lo0), (la1, lo1) = pts.min(0), pts.max(0)
        box = np.where((xy[:, 0] >= la0) & (xy[:, 0] <= la1) & (xy[:, 1] >= lo0) & (xy[:, 1] <= lo1))[0]
        ns = [int(cand[i]) for i in box if shape.inside(*xy[i])]
        if len(ns) > ENTRIES:            # spread over the zone
            pick = [rng.choice(ns)]
            while len(pick) < ENTRIES:
                pick.append(max(ns, key=lambda n: min(apart(n, q) for q in pick)))
            ns = pick
        out.append({"id": str(z["id"]), "at": middle(z["rings"]), "nodes": ns,
                    "pop": pop.get(str(z["id"]), 0.0), "jobs": float(z["L_mp"] or 0)})
    for g in gates:
        out.append({"id": None, "gate": True, "at": tuple(net.xy[g[0]]), "nodes": g})
    return [q for q in out if q["nodes"]]


def entries(pl):
    off = np.cumsum([0] + [len(p["nodes"]) for p in pl]).astype(np.int32)
    src = np.array([n for p in pl for n in p["nodes"]], np.int32)
    return src, off, src, off


# a road leaving the area, 8 h and one way: what the outer cordon counted
GATE = {"motorway": 9000, "trunk": 4500, "primary": 4000, "secondary": 1500, "tertiary": 500}


def prior(net, pl, p=P):
    """Trips before any count is looked at."""
    d = diary.load()
    n = len(pl)
    at = {q["id"]: i for i, q in enumerate(pl) if q["id"]}
    got, smp = np.zeros(n), np.zeros(n)
    for t in d["trips"]:
        if "kierowca" not in str(t.get("leg1")) and "dostawczym" not in str(t.get("leg1")):
            continue
        if t["start"] is None or int(t["start"]) not in N.COMMON_HOURS:
            continue
        for x in (at.get(str(t["from"])), at.get(str(t["to"]))):
            if x is not None:
                got[x] += float(d["people"][t["person"]]["w"]) / 2
                smp[x] += 1
    zone = np.array([i for i, q in enumerate(pl) if q["id"]])
    from scipy.optimize import nnls
    X = np.array([[pl[i]["pop"], pl[i]["jobs"]] for i in zone])
    beta, _ = nnls(X, got[zone])
    # a zone's own sample, as far as it goes, then what its people and jobs make
    ends = (smp[zone] * got[zone] + 30 * (X @ beta)) / (smp[zone] + 30)
    ends *= got.sum() / ends.sum() * p["scale"]
    O = np.zeros(n)
    O[zone] = ends
    kind = collections.defaultdict(set)
    for s in net.segs:
        for v in (s["u"], s["v"]):
            kind[v].add(s["hw"])
    G = np.zeros(n)
    for i, q in enumerate(pl):
        if q.get("gate"):
            G[i] = max(GATE.get(h.replace("_link", ""), 300) for h in kind[q["nodes"][0]])
    ll = np.array([q["at"] for q in pl])
    km = np.hypot((ll[:, None, 0] - ll[None, :, 0]) * 111.32,
                  (ll[:, None, 1] - ll[None, :, 1]) * 111.32 * math.cos(math.radians(N.CENTRE[0])))
    inner = np.exp(-p["decay"] * km)
    np.fill_diagonal(inner, 0)
    T = balance(inner * np.outer(O > 0, O > 0), O, O)
    # in and out of the area: to where trips end, thinning with distance
    out = np.outer(G > 0, O) * np.exp(-0.05 * km)
    s = out.sum(1, keepdims=True)
    out = np.divide(out * (G * (1 - p["through"]))[:, None], s, out=np.zeros_like(out), where=s > 0)
    thr = balance(np.outer(G, G) * (km > 12), G * p["through"], G * p["through"])
    return T + out + out.T + thr


def balance(T, O, D, rounds=60):
    T = T.copy()
    for _ in range(rounds):
        s = T.sum(1)
        T *= np.divide(O, s, out=np.zeros_like(s), where=s > 0)[:, None]
        s = T.sum(0)
        T *= np.divide(D, s, out=np.zeros_like(s), where=s > 0)[None, :]
    return T


# --------------------------------------------------------------- calibration
def adjust(T0, M, v, gate, p=P):
    """Trips moved from the prior as little as the counts allow.

    T = T0 * exp(all + from + to + pair): each with a prior of its own, so the
    zones' totals move before single pairs do.
    """
    from scipy.optimize import minimize
    n = len(T0)
    t0 = T0.ravel()
    used = np.unique(M.indices)          # pairs some counted arc sees
    Mu = M[:, used].tocsr()
    o, d = used // n, used % n
    sd = np.where(gate, p["sdGate"], p["sdZone"])
    err = np.hypot(p["err"] * v, 150.0)

    def parts(x):
        return x[0], x[1:1 + n], x[1 + n:1 + 2 * n], x[1 + 2 * n:]

    def f(x):
        g, a, b, e = parts(x)
        t = t0[used] * np.exp(np.clip(g + a[o] * sd[o] + b[d] * sd[d] + e * p["sdPair"], -6, 6))
        r = (Mu @ t - v) / err
        # beyond 3 sd a count is more likely misplaced than the trips wrong
        loss = np.where(np.abs(r) < 3, r * r / 2, 3 * np.abs(r) - 4.5)
        gr = (Mu.T @ (np.clip(r, -3, 3) / err)) * t
        grad = np.concatenate([[gr.sum() + g / 0.25], np.bincount(o, gr, n) * sd + a,
                               np.bincount(d, gr, n) * sd + b, gr * p["sdPair"] + e])
        return loss.sum() + g * g / 0.5 + (a @ a + b @ b + e @ e) / 2, grad

    x = minimize(f, np.zeros(1 + 2 * n + len(used)), jac=True, method="L-BFGS-B",
                 options={"maxiter": 250}).x
    g, a, b, e = parts(x)
    u = (g + a[:, None] * sd[:, None] + b[None, :] * sd[None, :]).ravel()
    u[used] += e * p["sdPair"]
    return (t0 * np.exp(np.clip(u, -6, 6))).reshape(n, n)


def calibrate(net, pl, T0, cs, p=P, rounds=4, quiet=False):
    """Route, adjust the trips to the counts, route again."""
    zones = entries(pl)
    gate = np.array([bool(q.get("gate")) for q in pl])
    arcs = sorted({c["arc"] for c in cs})
    tag = np.full(len(net.tail), -1, np.int32)
    tag[arcs] = np.arange(len(arcs))
    v = np.array([np.mean([c["v"] for c in cs if c["arc"] == a]) for a in arcs])
    T = T0
    for r in range(rounds):
        flow, _, M = settle(net, zones, T, p, want=tag)
        if not quiet:
            log("  round %d: %s" % (r, error(flow[arcs], v)))
        T = 0.5 * T + 0.5 * adjust(T0, M, v, gate, p) if r else adjust(T0, M, v, gate, p)
    flow, times, _ = settle(net, zones, T, p)
    if not quiet:
        log("  after:   %s" % error(flow[arcs], v))
    return T, flow, times


def error(m, v):
    ape = np.abs(m - v) / v
    geh = np.sqrt(2 * (m - v) ** 2 / (m + v + 1e-9) / HOURS)
    ok = m > 1
    lv = np.log(v[ok])
    r2 = 1 - np.sum((np.log(m[ok]) - lv) ** 2) / np.sum((lv - lv.mean()) ** 2)
    return "n %d  total %.2f  median %.0f%%  p90 %.0f%%  GEH<5 %.0f%%  <10 %.0f%%  R2log %.3f  zero %d" % (
        len(v), m.sum() / v.sum(), 100 * np.median(ape), 100 * np.quantile(ape, .9),
        100 * np.mean(geh < 5), 100 * np.mean(geh < 10), r2, (~ok).sum())


# ---------------------------------------------------------------- validation
def folds(cs, k=5, seed=3):
    """Counting points, not sections or directions: those of one point see
    the same traffic."""
    import random
    pts = sorted({c["point"] for c in cs})
    random.Random(seed).shuffle(pts)
    return [set(pts[i::k]) for i in range(k)]


def held_out(net, pl, T0, cs, p=P, rounds=3, k=5):
    """Each count as the model routes it without its own counting point."""
    out, trips = np.zeros(len(cs)), []
    for f in folds(cs, k):
        T, flow, _ = calibrate(net, pl, T0, [c for c in cs if c["point"] not in f],
                               p, rounds, quiet=True)
        for i, c in enumerate(cs):
            if c["point"] in f:
                out[i] = flow[c["arc"]]
        trips.append(T)
    return out, trips


def by_section(cs, m):
    """Both directions of a section together, where both were matched."""
    g = collections.defaultdict(list)
    for c, x in zip(cs, m):
        g[c["id"]].append((x, c["v"]))
    ids = sorted(g)
    return ids, np.array([sum(x for x, _ in g[i]) for i in ids]), \
        np.array([sum(v for _, v in g[i]) for i in ids])


def setup(p=P, without=()):
    segs, xy, gates = graph(without)
    net = Net(segs, xy, p)
    cs, lost = counts(net)
    pl = places(net, gates)
    return net, pl, cs, lost


def regression(cs):
    """network.py's model on the same sections and the same folds."""
    L = lambda f: json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))
    points, survey = L("points"), L("survey")
    edges, adj, coord = N.build_graph(N.fetch())
    meas = N.measured(L("road")["sections"], points)
    matched, _ = N.match_edges(edges, meas)
    origins, pool = N.demand(edges, adj, coord, survey, meas, matched)
    fwd, bwd = N.assign_parallel(edges, origins, pool, workers=min(12, THREADS))
    X = N.features(edges, adj, fwd + bwd)
    ids, _, v = by_section(cs, [0] * len(cs))
    keep = [i for i, s in enumerate(ids) if s in matched]
    ids, v = [ids[i] for i in keep], v[keep]
    X = X[[matched[s]["edge"] for s in ids]]
    point = {c["id"]: c["point"] for c in cs}
    out = np.zeros(len(ids))
    for f in folds(cs):
        te = np.array([point[s] in f for s in ids])
        beta, *_ = np.linalg.lstsq(X[~te], np.log(v[~te]), rcond=None)
        out[te] = np.exp(X[te] @ beta)
    return ids, out, v


def named(net, words):
    """Segments of streets whose name has one of the words."""
    return [k for k, s in enumerate(net.segs) if any(w in s["name"] for w in words)]


def both(flow):
    return flow[0::2] + flow[1::2]


def vehkm(net, flow):
    return float((flow * net.len).sum() / 1000)


CLOSURES = {
    "ul. Kazimierza Wielkiego": ["Kazimierza Wielkiego"],
    "most Grunwaldzki": ["most Grunwaldzki", "Most Grunwaldzki"],
    "most Pokoju": ["Most Pokoju", "most Pokoju"],
    "al. Hallera": ["Józefa Hallera"],
}


def try_closures(net, pl, T, variants=(), p=P):
    """Shut, reroute, and see whether it makes sense. variants: other trip
    tables that fit the counts as well, for how far the answer moves."""
    zones = entries(pl)
    base = settle(net, zones, T, p)[0]
    bases = [settle(net, zones, t, p)[0] for t in variants]
    hours = lambda f: (f * np.where(np.isfinite(net.t0), seconds(net, f, p), 0)).sum() / 3600
    for label, words in CLOSURES.items():
        ks = named(net, words)
        if not ks:
            print("==", label, "- no such street")
            continue
        was, flow, lost = change(net, net.shut(ks), zones, T, base, p)
        b, a = both(was), both(flow)
        d = a - b
        alt = []
        for t, x in zip(variants, bases):
            w2, f2, _ = change(net, net.shut(ks), zones, t, x, p)
            alt.append(both(f2) - both(w2))
        print("== %s: %d segments, %.1f km; up to %d vehicles in 8 h before, %d after; trips without a way %.0f" % (
            label, len(ks), sum(net.segs[k]["len"] for k in ks) / 1000, b[ks].max(), a[ks].max(), lost))
        print("   veh-km %+.0f (%+.2f%%), veh-h %+.0f (%+.1f%%)" % (
            vehkm(net, flow) - vehkm(net, was), 100 * (vehkm(net, flow) / vehkm(net, was) - 1),
            hours(flow) - hours(was), 100 * (hours(flow) / hours(was) - 1)))
        seen = set()
        for k in np.argsort(-np.abs(d)):
            s = net.segs[k]
            if k in ks or not s["name"] or s["name"] in seen:
                continue
            seen.add(s["name"])
            c = net.cap[2 * k] * (s["fwd"] + s["bwd"])
            sp = [x[k] for x in alt]
            print("   %-34s %-9s %6d -> %6d  (%+6d)  v/c %.2f -> %.2f%s" % (
                s["name"][:34], s["hw"][:9], b[k], a[k], d[k], b[k] / c, a[k] / c,
                "   other fits %+d..%+d" % (min(sp), max(sp)) if sp else ""))
            if len(seen) >= 10:
                break
        mid = np.array([np.mean(s["g"], axis=0) for s in net.segs])
        at = mid[ks].mean(0)
        km = np.hypot((mid[:, 0] - at[0]) * 111.3, (mid[:, 1] - at[1]) * 70)
        far = np.abs(d[km > 6])
        print("   over 6 km away: change above 100 vehicles on %d of %d segments, largest %d" % (
            (far > 100).sum(), len(far), far.max()))
        if alt:
            big = [k for k in range(len(d)) if abs(d[k]) > 500 and k not in ks]
            sd = [np.std([x[k] for x in alt]) / abs(d[k]) for k in big]
            print("   segments changing by over 500: %d; spread between fits, share of the change: median %.0f%%, p90 %.0f%%; same sign in all fits %.0f%%" % (
                len(big), 100 * np.median(sd), 100 * np.quantile(sd, .9),
                100 * np.mean([all(np.sign(x[k]) == np.sign(d[k]) for x in alt) for k in big])))


def past():
    """2018 and 2024 at the same places: annex 3.3's own comparison."""
    import openpyxl
    f = [x for x in os.listdir(os.path.join(ROOT, "data")) if "3.3" in x and x.endswith(".xlsx")][0]
    wb = openpyxl.load_workbook(os.path.join(ROOT, "data", f), read_only=True, data_only=True)
    out = []
    for r in wb["Porównanie KBR"].iter_rows(values_only=True):
        r = list(r)
        while r and r[0] is None:
            r = r[1:]
        if len(r) >= 9 and isinstance(r[3], (int, float)) and isinstance(r[5], (int, float)):
            out.append((str(r[4]), float(r[3]), float(r[5])))
    return out


def experiment(net, pl, T, cs, p=P):
    """al. Wielkiej Wyspy opened between the surveys. Shut it in a model that
    has only seen 2024, and compare the change with what the counts say."""
    ks = named(net, ["Wielkiej Wyspy", "Most Olimpijski", "most Olimpijski"])
    zones = entries(pl)
    with_, wo, _ = change(net, net.shut(ks), zones, T, settle(net, zones, T, p)[0], p)
    print("al. Wielkiej Wyspy: %d segments, %.1f km, up to %d vehicles in 8 h" % (
        len(ks), sum(net.segs[k]["len"] for k in ks) / 1000, both(with_)[ks].max()))
    arcs = collections.defaultdict(list)
    for c in cs:
        arcs[c["id"]].append(c["arc"])
    rows = []
    for ids, v18, v24 in past():
        a = [x for i in ids.replace(" ", "").split("+") for x in arcs.get(i, ())]
        if a and wo[a].sum() > 100:
            at = np.mean(net.segs[a[0] // 2]["g"], axis=0)
            km = min(np.hypot((q[0] - at[0]) * 111.3, (q[1] - at[1]) * 70)
                     for k in ks for q in net.segs[k]["g"])
            rows.append((ids, math.log(v24 / v18), math.log(with_[a].sum() / wo[a].sum()), v18, v24, km))
    obs, pre = np.array([r[1] for r in rows]), np.array([r[2] for r in rows])
    calm = np.abs(pre) < 0.02
    trend = float(np.median(obs[calm]))
    print("%d places; %d the model says it hardly touched: median change there %+.0f%%" % (
        len(rows), calm.sum(), 100 * math.expm1(trend)))
    hot = np.abs(pre) > 0.05
    rel = obs - trend
    print("touched by over 5%%: n=%d, sign right %.0f%%, r %.2f; all places r %.2f; slope through zero %.2f" % (
        hot.sum(), 100 * np.mean(np.sign(rel[hot]) == np.sign(pre[hot])),
        np.corrcoef(rel[hot], pre[hot])[0, 1], np.corrcoef(rel, pre)[0, 1],
        (rel[hot] * pre[hot]).sum() / (pre[hot] ** 2).sum()))
    print("mean miss there, points of change: with the model %.0f, saying nothing %.0f" % (
        100 * np.mean(np.abs(np.expm1(rel[hot]) - np.expm1(pre[hot]))),
        100 * np.mean(np.abs(np.expm1(rel[hot])))))
    # near the street, whatever the model says
    km = np.array([r[5] for r in rows])
    far = float(np.median(obs[km > 6]))
    for lim in (2, 3, 4):
        q = km < lim
        z = obs[q] - far
        same = np.median(z)              # the best single number for all of them
        print("within %d km: n=%d, r %.2f, sign right %.0f%% (all falling: %.0f%%), mean miss with the model %.0f, without %.0f, best constant %.0f points" % (
            lim, q.sum(), np.corrcoef(z, pre[q])[0, 1],
            100 * np.mean(np.sign(z) == np.sign(pre[q])), 100 * np.mean(z < 0),
            100 * np.mean(np.abs(np.expm1(z) - np.expm1(pre[q]))), 100 * np.mean(np.abs(np.expm1(z))),
            100 * np.mean(np.abs(np.expm1(z) - np.expm1(same)))))
    for i in np.argsort(km)[:24]:
        print("   %.1f km %-10s beyond the trend %+4.0f%%   model %+4.0f%%" % (
            km[i], rows[i][0], 100 * math.expm1(obs[i] - far), 100 * math.expm1(pre[i])))
    for i in np.argsort(-np.abs(pre))[:24]:
        print("   %-14s observed %+4.0f%% (beyond the trend %+4.0f%%)   model %+4.0f%%   %d -> %d" % (
            rows[i][0], 100 * math.expm1(obs[i]), 100 * math.expm1(rel[i]), 100 * math.expm1(pre[i]),
            rows[i][3], rows[i][4]))
    print("largest observed, beyond the trend:")
    for i in np.argsort(-np.abs(rel))[:14]:
        print("   %-14s %+4.0f%%   model %+4.0f%%" % (rows[i][0], 100 * math.expm1(rel[i]), 100 * math.expm1(pre[i])))


# -------------------------------------------------------------------- export
def steps(v):
    v = np.asarray(v, int)
    return np.diff(v, prepend=0).tolist()


def tenths(T):
    """Trips to a tenth, each row's rounding carried on so its sum stays."""
    out = np.zeros(T.shape, int)
    for i, row in enumerate(T):
        c = np.round(np.cumsum(row) * 10).astype(int)
        out[i] = np.diff(c, prepend=0)
    return out


def rounded(net):
    """The network as the browser will have it."""
    o = net.shut(())
    ok = np.isfinite(o.t0)
    o.t0[ok] = np.round(o.t0[ok] * 10) / 10
    o.cap = np.round(o.cap)
    o.len = np.round(o.len)
    return o


def export(net, pl, T, stats, p=P):
    net = rounded(net)
    Q = tenths(T)
    np.fill_diagonal(Q, 0)
    zones = entries(pl)
    base = np.round(settle(net, zones, Q / 10, {**p, "iters": 6 * p["looks"]})[0])
    packed, run = [], 0
    for q in Q.ravel().tolist():
        if q:
            if run:
                packed.append(-run)
                run = 0
            packed.append(q)
        else:
            run += 1
    if run:
        packed.append(-run)
    ll = np.round(net.xy * 1e5).astype(int)
    names = sorted({s["name"] for s in net.segs})
    classes = sorted({s["hw"] for s in net.segs})
    ni, ci = {x: i for i, x in enumerate(names)}, {x: i for i, x in enumerate(classes)}
    geom, mid = [], []
    for s in net.segs:
        pts = N.simplify([list(q) for q in s["g"]], 5e-5)[1:-1]
        at = ll[s["u"]]
        for q in pts:
            q = np.round(np.array(q) * 1e5).astype(int)
            geom += (q - at).tolist()
            at = q
        mid.append(len(pts))
    t = lambda i: int(round(net.t0[i] * 10)) if np.isfinite(net.t0[i]) else 0
    m = range(len(net.segs))
    js = {
        "meta": {
            "hours": N.COMMON_HOURS,
            "params": {k: p[k] for k in ("alpha", "noise", "looks", "heed")},
            "trips": int(round(Q.sum() / 10)), "zones": sum(1 for q in pl if q["id"]),
            "gates": sum(1 for q in pl if q.get("gate")), **stats,
        },
        "names": names, "classes": classes,
        "nodes": {"lat": steps(ll[:, 0]), "lon": steps(ll[:, 1])},
        "segs": {
            "u": [s["u"] for s in net.segs], "v": [s["v"] for s in net.segs],
            "open": [int(s["fwd"]) + 2 * int(s["bwd"]) for s in net.segs],
            "tf": [t(2 * k) for k in m], "tb": [t(2 * k + 1) for k in m],
            "cap": [int(net.cap[2 * k]) for k in m], "len": [int(net.len[2 * k]) for k in m],
            "name": [ni[s["name"]] for s in net.segs], "cls": [ci[s["hw"]] for s in net.segs],
            "mid": mid, "geom": geom,
        },
        "zones": {"nodes": [n for q in pl for n in q["nodes"]],
                  "off": steps(np.cumsum([0] + [len(q["nodes"]) for q in pl]))},
        "od": packed, "base": [int(round(x)) for x in base],
    }
    path = os.path.join(ROOT, "public", "data", "closure.json")
    with open(path, "w", encoding="utf8") as f:
        json.dump(js, f, ensure_ascii=False, separators=(",", ":"))
    import gzip
    raw = open(path, "rb").read()
    log("  -> closure.json %.0f kB, %.0f kB gzipped" % (len(raw) / 1e3, len(gzip.compress(raw, 9)) / 1e3))
    # one closure, for assign.js to be checked against
    ks = named(net, CLOSURES["ul. Kazimierza Wielkiego"])
    was, after, _ = change(net, net.shut(ks), zones, Q / 10, base, p)
    with open(os.path.join(geocode.CACHE, "closure_check.json"), "w") as f:
        json.dump({"closed": ks, "base": was.tolist(), "after": after.tolist()}, f)


def main(what):
    net, pl, cs, lost = setup()
    log("%d segments, %d nodes, %d places, %d directed counts (%d off the graph)" % (
        len(net.segs), net.n, len(pl), len(cs), len(lost)))
    T0 = prior(net, pl)
    v = np.array([c["v"] for c in cs])
    if what == "validate":
        m, _ = held_out(net, pl, T0, cs)
        print("counts left out, each direction:", error(m, v))
        ids, ms, vs = by_section(cs, m)
        print("counts left out, sections:      ", error(ms, vs))
        rid, rm, rv = regression(cs)
        print("network.py, same folds:         ", error(rm, rv))
        at = [ids.index(i) for i in rid]
        print("this model, those sections:     ", error(ms[at], rv))
        print("geometric mean of the two:      ", error(np.sqrt(np.maximum(ms[at], 1) * rm), rv))
        for a in sorted({c["area"] for c in cs}):
            k = [i for i, s in enumerate(ids) if next(c["area"] for c in cs if c["id"] == s) == a]
            print("   %-22s" % a, error(ms[k], vs[k]))
        return
    T, flow, _ = calibrate(net, pl, T0, cs, rounds=4)
    if what == "closures":
        _, trips = held_out(net, pl, T0, cs)
        try_closures(net, pl, T, trips)
    elif what == "experiment":
        experiment(net, pl, T, cs)
    else:
        m, _ = held_out(net, pl, T0, cs)
        ids, ms, vs = by_section(cs, m)
        ape = np.abs(ms - vs) / vs
        export(net, pl, T, {"sections": len(ids), "medianErr": round(float(np.median(ape)), 3),
                            "p90Err": round(float(np.quantile(ape, .9)), 3)})


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1] if len(sys.argv) > 1 else "build")
