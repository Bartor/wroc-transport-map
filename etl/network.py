# -*- coding: utf-8 -*-
"""Estimate traffic on the whole road network from 244 measured cross-sections.

The measurements cover cordons and rings, not the network in between. To fill
the gaps we build a directed graph of the drivable OSM network, run a crude
all-or-nothing assignment over it to get a routing-based load for every edge,
then fit a model that maps (load, road class, lanes, speed, location) onto the
measured volumes and applies it everywhere.

The output is an estimate, not a measurement. build() reports cross-validated
error so the layer can state how wrong it typically is.
"""
import json, math, os, sys, heapq, random, collections
import urllib.parse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode

CACHE = geocode.CACHE
CENTRE = (51.1097, 17.0324)          # Rynek

# Classes we route on. Anything narrower than this carries little through
# traffic and would swamp the map.
DRIVABLE = ["motorway", "trunk", "primary", "secondary", "tertiary",
            "unclassified", "residential", "living_street",
            "motorway_link", "trunk_link", "primary_link", "secondary_link",
            "tertiary_link"]

# Classes we publish an estimate for; residential streets stay in the graph for
# connectivity but are not drawn.
PUBLISH = {"motorway", "trunk", "primary", "secondary", "tertiary",
           "unclassified", "motorway_link", "trunk_link", "primary_link",
           "secondary_link", "tertiary_link"}

FREE_SPEED = {"motorway": 120, "trunk": 90, "primary": 55, "secondary": 50,
              "tertiary": 45, "unclassified": 40, "residential": 30,
              "living_street": 20, "motorway_link": 70, "trunk_link": 60,
              "primary_link": 45, "secondary_link": 40, "tertiary_link": 35}

DEFAULT_LANES = {"motorway": 2.5, "trunk": 2, "primary": 2, "secondary": 1.6,
                 "tertiary": 1.2, "unclassified": 1, "residential": 1,
                 "living_street": 1, "motorway_link": 1, "trunk_link": 1,
                 "primary_link": 1, "secondary_link": 1, "tertiary_link": 1}

log = lambda *a: print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------- source
def fetch():
    """Drivable ways with node ids, so shared ids give us the topology."""
    path = os.path.join(CACHE, "overpass_drivable2.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    box = geocode.BBOX
    q = '[out:json][timeout:600];way["highway"~"^(%s)$"](%f,%f,%f,%f);out body geom;' % (
        "|".join(DRIVABLE), *box)
    log("querying overpass for the drivable network...")
    js = json.loads(geocode._get("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": q}).encode()))
    out = []
    for el in js.get("elements", []):
        g = el.get("geometry")
        if not g or not el.get("nodes"):
            continue
        t = el.get("tags", {})
        out.append({
            "id": el["id"], "nodes": el["nodes"],
            "g": [[round(p["lat"], 6), round(p["lon"], 6)] for p in g],
            "hw": t.get("highway"), "name": t.get("name"),
            "oneway": t.get("oneway"), "lanes": t.get("lanes"),
            "maxspeed": t.get("maxspeed"), "junction": t.get("junction"),
        })
    json.dump(out, open(path, "w", encoding="utf8"))
    log("  %d ways cached" % len(out))
    return out


# ---------------------------------------------------------------------- graph
def _num(v, default=None):
    try:
        return float(str(v).split()[0])
    except (TypeError, ValueError):
        return default


def _oneway(w):
    """(forward, backward) drivability."""
    ow = (w.get("oneway") or "").lower()
    if ow in ("yes", "true", "1"):
        return True, False
    if ow == "-1" or ow == "reverse":
        return False, True
    if ow in ("no", "false", "0"):
        return True, True
    if w.get("junction") in ("roundabout", "circular"):
        return True, False
    if w["hw"] in ("motorway", "motorway_link"):     # OSM default
        return True, False
    return True, True


def haversine(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def build_graph(ways):
    """Contract each way into edges between junctions, keeping the geometry."""
    seen = collections.Counter()
    for w in ways:
        for n in w["nodes"]:
            seen[n] += 1
    junction = set()
    for w in ways:
        junction.add(w["nodes"][0])
        junction.add(w["nodes"][-1])
        for n in w["nodes"]:
            if seen[n] > 1:
                junction.add(n)

    edges, coord = [], {}
    for w in ways:
        ns, gs = w["nodes"], w["g"]
        if len(ns) != len(gs):
            continue
        for n, p in zip(ns, gs):
            coord[n] = p
        fwd, bwd = _oneway(w)
        lanes = _num(w.get("lanes")) or DEFAULT_LANES.get(w["hw"], 1)
        speed = _num(w.get("maxspeed")) or FREE_SPEED.get(w["hw"], 40)
        start = 0
        for i in range(1, len(ns)):
            if ns[i] not in junction and i != len(ns) - 1:
                continue
            geom = gs[start:i + 1]
            length = sum(haversine(geom[k], geom[k + 1]) for k in range(len(geom) - 1))
            if length > 0:
                edges.append({
                    "u": ns[start], "v": ns[i], "g": geom, "len": length,
                    "wid": w.get("id"), "hw": w["hw"],
                    "name": w.get("name"), "lanes": lanes,
                    "speed": speed, "fwd": fwd, "bwd": bwd,
                })
            start = i

    adj = collections.defaultdict(list)              # node -> [(nbr, cost, eid, dir)]
    for eid, e in enumerate(edges):
        t = e["len"] / (e["speed"] / 3.6)
        if e["fwd"]:
            adj[e["u"]].append((e["v"], t, eid, 1))
        if e["bwd"]:
            adj[e["v"]].append((e["u"], t, eid, -1))
    return edges, adj, coord


# ----------------------------------------------------------------- assignment
def dijkstra(adj, src, limit=None):
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, math.inf):
            continue
        if limit and d > limit:
            continue
        for v, w, eid, sgn in adj[u]:
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = (u, eid, sgn)
                heapq.heappush(pq, (nd, v))
    return dist, prev


class Grid:
    """Coarse spatial index; the network is far too big for linear scans."""

    def __init__(self, items, cell=0.004):
        self.cell = cell
        self.b = collections.defaultdict(list)
        for key, lat, lon in items:
            self.b[(int(lat / cell), int(lon / cell))].append((key, lat, lon))

    def near(self, lat, lon, rings=1):
        i, j = int(lat / self.cell), int(lon / self.cell)
        out = []
        for di in range(-rings, rings + 1):
            for dj in range(-rings, rings + 1):
                out.extend(self.b.get((i + di, j + dj), ()))
        return out

    def nearest(self, lat, lon):
        for rings in (1, 2, 4, 8):
            cand = self.near(lat, lon, rings)
            if cand:
                return min(cand, key=lambda t: (t[1] - lat) ** 2 + (t[2] - lon) ** 2)[0]
        return None


# ------------------------------------------------------------------- matching
COMMON_HOURS = [6, 7, 8, 9, 15, 16, 17, 18]   # the only hours all 244 share


def measured(road, points):
    """Volume in the common window, both directions, per cross-section."""
    out = {}
    for p in points:
        s = road.get(p["id"])
        if not s or not p.get("lat"):
            continue
        v = 0
        for d in s["dirs"].values():
            for h in COMMON_HOURS:
                v += sum(d["h"][h])
        if v > 0:
            out[p["id"]] = {"v": v, "lat": p["lat"], "lon": p["lon"],
                            "name": p["name"], "area": p["area"]}
    return out


def daily_factor(road, points):
    """Daily total / common-window volume, from the 45 sections measured 24h."""
    ratios = []
    for p in points:
        s = road.get(p["id"])
        if not s:
            continue
        prof = [0] * 24
        for d in s["dirs"].values():
            for h in range(24):
                prof[h] += sum(d["h"][h])
        if all(v > 0 for v in prof):
            win = sum(prof[h] for h in COMMON_HOURS)
            if win:
                ratios.append(sum(prof) / win)
    ratios.sort()
    return ratios[len(ratios) // 2], len(ratios)


def match_edges(edges, meas, tol=90.0):
    """Attach each measured cross-section to a graph edge.

    Prefer an edge whose OSM name matches the surveyed street name; fall back to
    the nearest edge of the highest road class within `tol` metres.
    """
    items = []
    for eid, e in enumerate(edges):
        for p in e["g"]:
            items.append((eid, p[0], p[1]))
    grid = Grid(items, cell=0.003)
    rank = {c: i for i, c in enumerate(reversed(DRIVABLE))}

    out, unmatched = {}, []
    for sid, m in meas.items():
        want = geocode.norm(m["name"] or "")
        best = None
        for eid, lat, lon in grid.near(m["lat"], m["lon"], rings=1):
            e = edges[eid]
            d = min(haversine((m["lat"], m["lon"]), q) for q in e["g"])
            if d > tol:
                continue
            named = 1 if want and geocode.norm(e["name"] or "") == want else 0
            score = (named, rank.get(e["hw"], 0), -d)
            if best is None or score > best[0]:
                best = (score, eid, d, named)
        if best:
            out[sid] = {"edge": best[1], "dist": round(best[2], 1),
                        "byName": bool(best[3])}
        else:
            unmatched.append(sid)
    return out, unmatched


# ------------------------------------------------------------------ demand
def demand(edges, adj, coord, survey, meas, matched, n_dest=4000, seed=11):
    """Origins and a destination pool for the assignment.

    Internal trips start at the surveyed household addresses - a real
    stratified sample of where people in Wroclaw live. External trips start at
    the cordon crossings, weighted by the traffic actually counted there.
    Destinations are drawn with a distance decay towards the centre, which is
    where the jobs are.
    """
    rng = random.Random(seed)
    nodes = [n for n in adj if n in coord]
    grid = Grid([(n, coord[n][0], coord[n][1]) for n in nodes], cell=0.004)

    origins = []
    for s in survey:
        n = grid.nearest(s["lat"], s["lon"])
        if n:
            origins.append((n, 1.0))

    cordon = [(sid, m) for sid, m in meas.items()
              if sid.startswith(("KW_", "KO_", "AOW_")) and sid in matched]
    if cordon:
        mean = sum(m["v"] for _, m in cordon) / len(cordon)
        for sid, m in cordon:
            e = edges[matched[sid]["edge"]]
            origins.append((e["u"], max(0.2, m["v"] / mean)))

    pool_nodes = rng.sample(nodes, min(n_dest, len(nodes)))
    weights = []
    for n in pool_nodes:
        d = haversine(coord[n], CENTRE)
        weights.append(0.15 + math.exp(-d / 2500.0))
    pool = rng.choices(pool_nodes, weights=weights, k=20000)
    return origins, pool


def assign_weighted(edges, adj, origins, pool, trips=45, seed=7):
    """All-or-nothing loading: every sampled trip takes the quickest path.

    Not a calibrated model - a routing-weighted centrality that knows about
    oneways and speeds. It predicts measured volume far better than road class
    alone, which is all we need before the regression rescales it.
    """
    rng = random.Random(seed)
    fwd = np.zeros(len(edges))
    bwd = np.zeros(len(edges))
    for i, (o, w) in enumerate(origins):
        if i % 100 == 0:
            log("  assignment %d/%d" % (i, len(origins)))
        dist, prev = dijkstra(adj, o)
        for d in rng.sample(pool, trips):
            node = d
            hops = 0
            while node in prev and hops < 4000:
                u, eid, sgn = prev[node]
                if sgn > 0:
                    fwd[eid] += w
                else:
                    bwd[eid] += w
                node = u
                hops += 1
    return fwd, bwd


# ------------------------------------------------------------------- model
CLASS_GROUP = {
    "motorway": "motorway", "motorway_link": "motorway",
    "trunk": "trunk", "trunk_link": "trunk",
    "primary": "primary", "primary_link": "primary",
    "secondary": "secondary", "secondary_link": "secondary",
    "tertiary": "tertiary", "tertiary_link": "tertiary",
}
GROUPS = ["motorway", "trunk", "primary", "secondary", "tertiary", "other"]


def features(edges, load):
    """One row per edge: routing load, class, lanes, speed, distance to centre."""
    X = np.zeros((len(edges), 4 + len(GROUPS)))
    for i, e in enumerate(edges):
        mid = e["g"][len(e["g"]) // 2]
        g = CLASS_GROUP.get(e["hw"], "other")
        X[i, 0] = 1.0
        X[i, 1] = math.log1p(load[i])
        X[i, 2] = math.log(max(1.0, e["lanes"]))
        X[i, 3] = math.log1p(haversine(mid, CENTRE) / 1000.0)
        X[i, 4 + GROUPS.index(g)] = 1.0
    return X


def fit_cv(X, y, folds=5, seed=3):
    """Least squares on log volume, with k-fold cross-validation.

    Reported error is out-of-fold: what to expect on a road that was never
    measured, which is every road this layer draws.
    """
    n = len(y)
    idx = list(range(n))
    random.Random(seed).shuffle(idx)
    pred = np.zeros(n)
    for k in range(folds):
        test = [idx[i] for i in range(n) if i % folds == k]
        train = [idx[i] for i in range(n) if i % folds != k]
        beta, *_ = np.linalg.lstsq(X[train], y[train], rcond=None)
        pred[test] = X[test] @ beta
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    ss = 1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2)
    ape = np.abs(np.expm1(pred) - np.expm1(y)) / np.maximum(1, np.expm1(y))
    return beta, {
        "r2cv": round(float(ss), 3),
        "mapeCv": round(float(np.median(ape)), 3),
        "p90ApeCv": round(float(np.quantile(ape, 0.9)), 3),
        "sigma": round(float(np.std(y - pred)), 3),
        "n": int(n),
    }


# ------------------------------------------------------------------- output
def simplify(pts, eps=1.2e-4):
    """Douglas-Peucker, ~13 m, to keep the JSON small."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], (b[1] - a[1]) * 0.63
    d2 = dx * dx + dy * dy
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i][0] - a[0], (pts[i][1] - a[1]) * 0.63
        t = 0.0 if d2 == 0 else max(0.0, min(1.0, (px * dx + py * dy) / d2))
        dd = math.hypot(px - t * dx, py - t * dy)
        if dd > worst:
            worst, wi = dd, i
    if worst <= eps:
        return [a, b]
    return simplify(pts[:wi + 1], eps)[:-1] + simplify(pts[wi:], eps)


def build(out_dir, road, points, survey):
    edges, adj, coord = build_graph(fetch())
    log("graph: %d edges, %d junctions" % (len(edges), len(adj)))

    meas = measured(road, points)
    factor, nfull = daily_factor(road, points)
    matched, unmatched = match_edges(edges, meas)
    log("matched %d/%d sections (%d outside the network bbox)"
        % (len(matched), len(meas), len(unmatched)))

    origins, pool = demand(edges, adj, coord, survey, meas, matched)
    log("demand: %d origins" % len(origins))
    fwd, bwd = assign_parallel(edges, origins, pool)
    load = fwd + bwd

    X = features(edges, load)
    rows = sorted(matched.items())
    ridx = np.array([m["edge"] for _, m in rows])
    y = np.log(np.array([meas[sid]["v"] for sid, _ in rows], dtype=float))
    beta, stats = fit_cv(X[ridx], y)
    log("model: R2cv=%(r2cv)s medianAPE=%(mapeCv)s n=%(n)s" % stats)

    pred = np.exp(X @ beta)
    lo, hi = np.exp(np.log(pred) - 1.28 * stats["sigma"]), \
        np.exp(np.log(pred) + 1.28 * stats["sigma"])

    obs = {}
    for sid, m in matched.items():
        obs.setdefault(m["edge"], []).append(meas[sid]["v"])

    out = []
    for i, e in enumerate(edges):
        if e["hw"] not in PUBLISH:
            continue
        tot = fwd[i] + bwd[i]
        split = round(float(fwd[i] / tot), 2) if tot else (1.0 if not e["bwd"] else 0.5)
        rec = {
            "g": [[round(p[0], 5), round(p[1], 5)] for p in simplify(e["g"])],
            "c": e["hw"], "n": e["name"] or "",
            "v": int(round(pred[i])), "d": int(round(pred[i] * factor)),
            "lo": int(round(lo[i])), "hi": int(round(hi[i])),
            "s": split, "ow": 0 if (e["fwd"] and e["bwd"]) else 1,
        }
        if i in obs:
            rec["m"] = int(round(sum(obs[i]) / len(obs[i])))
        out.append(rec)

    meta = dict(stats)
    meta.update({
        "window": COMMON_HOURS, "dailyFactor": round(factor, 3),
        "dailyFactorFrom": nfull, "edges": len(out),
        "graphEdges": len(edges), "graphNodes": len(adj),
        "origins": len(origins), "unmatched": unmatched,
        "coef": {k: round(float(v), 4) for k, v in zip(
            ["const", "logLoad", "logLanes", "logDistCentre"] + GROUPS, beta)},
    })
    with open(os.path.join(out_dir, "network.json"), "w", encoding="utf8") as f:
        json.dump({"meta": meta, "edges": out}, f, ensure_ascii=False,
                  separators=(",", ":"))
    log("  -> network.json  %.1f MB"
        % (os.path.getsize(os.path.join(out_dir, "network.json")) / 1e6))
    return meta


# ------------------------------------------------------------- parallel assign
def _worker_init(cache_path):
    """Each worker rebuilds the graph from the cached Overpass dump; that is far
    cheaper than pickling a 26k-edge adjacency across process boundaries."""
    global _W
    ways = json.load(open(cache_path, encoding="utf8"))
    edges, adj, coord = build_graph(ways)
    _W = (edges, adj, coord)


def _worker_chunk(args):
    chunk, pool, trips, seed = args
    edges, adj, _ = _W
    rng = random.Random(seed)
    fwd = np.zeros(len(edges))
    bwd = np.zeros(len(edges))
    for o, w in chunk:
        dist, prev = dijkstra(adj, o)
        for d in rng.sample(pool, trips):
            node, hops = d, 0
            while node in prev and hops < 4000:
                u, eid, sgn = prev[node]
                if sgn > 0:
                    fwd[eid] += w
                else:
                    bwd[eid] += w
                node = u
                hops += 1
    return fwd, bwd


def assign_parallel(edges, origins, pool, trips=45, seed=7, workers=None):
    """Same all-or-nothing loading, spread over CPU cores.

    Shortest paths are pointer-chasing over an irregular graph - the wrong shape
    for a GPU, but embarrassingly parallel per origin, so cores are the win.
    """
    import concurrent.futures as cf
    workers = workers or max(1, (os.cpu_count() or 4) - 2)
    cache_path = os.path.join(CACHE, "overpass_drivable2.json")
    n = max(1, len(origins) // (workers * 3))
    chunks = [(origins[i:i + n], pool, trips, seed + i)
              for i in range(0, len(origins), n)]
    fwd = np.zeros(len(edges))
    bwd = np.zeros(len(edges))
    done = 0
    with cf.ProcessPoolExecutor(workers, initializer=_worker_init,
                                initargs=(cache_path,)) as ex:
        for f, b in ex.map(_worker_chunk, chunks):
            fwd += f
            bwd += b
            done += 1
            log("  assignment chunk %d/%d" % (done, len(chunks)))
    return fwd, bwd
