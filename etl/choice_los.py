# -*- coding: utf-8 -*-
"""Zone-to-zone times by car, on foot and by public transport, for choice.py.

The times are ours, not the respondents': a driver never reports how long the
bus would have taken, and one source has to describe every mode. Streets come
from the drivable graph of network.py, timetables from the GTFS feed.

    python etl/choice_los.py       # -> etl/cache/los.npz, some minutes
"""
import bisect, collections, math, os, random, sys, warnings, zipfile
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

import diary
import gtfs
import network as N

LOS = os.path.join(diary.ROOT, "etl", "cache", "los.npz")
FEED = os.path.join(gtfs.CACHE, "gtfs_164.zip")   # an autumn one, not holidays
log = lambda *a: print(*a, file=sys.stderr, flush=True)

WORKERS = 6
POINTS = 6                   # junctions standing for a zone
WALK = 1.3                   # metres a second, about 4.7 km/h
DETOUR = 1.3                 # street distance over the straight line
ACCESS = 900.0               # how far people walk to a stop, straight line
FOOT = 250.0                 # between two stops of a transfer
CHANGE = 120                 # seconds it takes at least
HORIZON = 2.25 * 3600
CORE = 1500.0                # metres from the Rynek to the middle of a core zone
DEPARTURES = [h * 3600 for h in (7.0, 7.2, 7.4, 7.6, 7.8, 8.0, 8.2, 8.4,
                                 12.0, 12.25, 12.5, 12.75)]
# seconds and metres; ptShare is how often a connection existed at all
KEYS = ["car", "dist", "ptWalk", "ptWait1", "ptIvt", "ptWait2", "ptBoards", "ptShare"]


# ---------------------------------------------------------------------- zones
def middle(rings):
    r = rings[0]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
        k = x0 * y1 - x1 * y0
        a += k
        cx += (x0 + x1) * k
        cy += (y0 + y1) * k
    return (cy / (3 * a), cx / (3 * a)) if a else (r[0][1], r[0][0])


def inside(la, lo, rings):
    c = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            (x1, y1), (x2, y2) = r[i], r[j]
            if (y1 > la) != (y2 > la) and lo < (x2 - x1) * (la - y1) / (y2 - y1) + x1:
                c = not c
            j = i
    return c


def core_zones():
    return {str(z["id"]) for z in diary.zones()[0]
            if N.haversine(middle(z["rings"]), N.CENTRE) <= CORE}


def zone_points(edges, coord):
    """{zone: junctions} on streets where trips start."""
    ok = {e[k] for e in edges for k in ("u", "v")
          if e["hw"] in ("residential", "living_street", "unclassified",
                         "tertiary", "secondary")}
    cells = collections.defaultdict(list)
    for n in sorted(ok):
        la, lo = coord[n]
        cells[(int(la * 100), int(lo * 100))].append((n, la, lo))
    rng = random.Random(5)
    out = {}
    for z in diary.zones()[0]:
        rings = z["rings"]
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        cand = [n for i in range(int(min(ys) * 100), int(max(ys) * 100) + 1)
                for j in range(int(min(xs) * 100), int(max(xs) * 100) + 1)
                for n, la, lo in cells.get((i, j), ()) if inside(la, lo, rings)]
        if cand:
            out[str(z["id"])] = rng.sample(cand, min(POINTS, len(cand)))
    return out


# ----------------------------------------------------------- public transport
def timetable():
    """Stops and the connections of an ordinary weekday, in departure order."""
    with zipfile.ZipFile(FEED) as z:
        services = gtfs.typical_weekday(z)
        trips = {r["trip_id"]: i for i, r in enumerate(
            r for r in gtfs._rows(z, "trips.txt") if r["service_id"] in services)}
        stops, ll = {}, []
        for r in gtfs._rows(z, "stops.txt"):
            stops[r["stop_id"]] = len(ll)
            ll.append((float(r["stop_lat"]), float(r["stop_lon"])))
        runs = collections.defaultdict(list)
        for r in gtfs._rows(z, "stop_times.txt"):
            t = trips.get(r["trip_id"])
            if t is not None:
                runs[t].append((int(r["stop_sequence"]), stops[r["stop_id"]],
                                gtfs._secs(r["arrival_time"]), gtfs._secs(r["departure_time"])))
    con = []
    for t, rows in runs.items():
        rows.sort()
        for (_, a, _, dep), (_, b, arr, _) in zip(rows, rows[1:]):
            if dep is not None and arr is not None and arr >= dep:
                con.append((dep, arr, a, b, t))
    con.sort()
    return ll, con


def near(points, ll, metres):
    """[(stop, seconds on foot)] around each point."""
    cell = 0.01
    b = collections.defaultdict(list)
    for i, (la, lo) in enumerate(ll):
        b[(int(la / cell), int(lo / cell))].append(i)
    out = []
    for p in points:
        i, j = int(p[0] / cell), int(p[1] / cell)
        rows = []
        for di in (-1, 0, 1):
            for dj in (-2, -1, 0, 1, 2):
                for s in b.get((i + di, j + dj), ()):
                    d = N.haversine(p, ll[s])
                    if d <= metres:
                        rows.append((s, d * DETOUR / WALK))
        out.append(rows)
    return out


def scan(t0, access, con, starts, foot, n):
    """Earliest arrivals off a vehicle (a connection scan), each with
    (walk, first wait, riding, later waits, boardings)."""
    INF = math.inf
    arr, lab = [INF] * n, [None] * n     # earliest at the stop, on foot too
    veh, vlab = [INF] * n, [None] * n    # off a vehicle only
    ride = {}                            # run -> the label it was boarded with
    for s, w in access:
        arr[s], lab[s] = t0 + w, (w, 0.0, 0.0, 0.0, 0)
    end = t0 + HORIZON
    for k in range(bisect.bisect_left(starts, t0), len(con)):
        dep, at, a, b, t = con[k]
        if dep > end:
            break
        on = ride.get(t)
        if on is None:
            x = arr[a]
            if x == INF:
                continue
            w, w1, ivt, w2, boards = lab[a]
            if x + (CHANGE if boards else 0) > dep:
                continue
            on = ride[t] = (w, w1 + (0 if boards else dep - x), ivt,
                            w2 + (dep - x if boards else 0), boards + 1, dep)
        if at < veh[b]:
            w, w1, ivt, w2, boards, since = on
            new = (w, w1, ivt + at - since, w2, boards)
            veh[b], vlab[b] = at, new
            if at < arr[b]:
                arr[b], lab[b] = at, new
                for s, f in foot[b]:
                    if at + f < arr[s]:
                        arr[s] = at + f
                        lab[s] = (w + f, w1, new[2], w2, boards)
    return veh, vlab


# ---------------------------------------------------------------------- table
G = {}


def _init():
    edges, adj, coord = N.build_graph(N.fetch())
    zp = zone_points(edges, coord)
    G["adj"] = adj
    G["codes"] = sorted(zp)
    G["nodes"] = [n for c in G["codes"] for n in zp[c]]
    G["zone"] = np.array([i for i, c in enumerate(G["codes"]) for _ in zp[c]])
    pts = [tuple(coord[n]) for n in G["nodes"]]
    G["pts"] = np.array(pts)
    ll, con = timetable()
    G["con"], G["starts"], G["n"] = con, [c[0] for c in con], len(ll)
    G["access"] = near(pts, ll, ACCESS)
    G["foot"] = [[(s, w) for s, w in row if s != i]
                 for i, row in enumerate(near(ll, ll, FOOT))]
    # every place's stops as one padded table, so arrivals are looked up at once
    wide = max(len(r) for r in G["access"])
    G["estop"] = np.full((len(pts), wide), G["n"], int)
    G["ewalk"] = np.full((len(pts), wide), np.inf)
    for i, row in enumerate(G["access"]):
        for j, (s, w) in enumerate(row):
            G["estop"][i, j], G["ewalk"][i, j] = s, w


def _zone(zi):
    """From one zone to all: means over the pairs of places standing for them."""
    warnings.simplefilter("ignore")
    own = np.flatnonzero(G["zone"] == zi)
    m = len(G["nodes"])
    row = np.arange(m)
    car = np.full((len(own), m), np.nan)
    pt = np.full((len(own), len(DEPARTURES), m, 5), np.nan)
    nan5 = (math.nan,) * 5
    for i, o in enumerate(own):
        dist, _ = N.dijkstra(G["adj"], G["nodes"][o])
        car[i] = [dist.get(n, math.nan) for n in G["nodes"]]
        car[i, o] = np.nan
        for j, t0 in enumerate(DEPARTURES):
            veh, vlab = scan(t0, G["access"][o], G["con"], G["starts"], G["foot"], G["n"])
            v = np.array(veh + [math.inf])
            lab = np.array([x or nan5 for x in vlab] + [nan5])
            # a change is worth a few minutes to anyone
            cost = v[G["estop"]] + G["ewalk"] + 180 * np.nan_to_num(lab[G["estop"], 4])
            best = cost.argmin(1)
            L = lab[G["estop"][row, best]].copy()
            L[:, 0] += G["ewalk"][row, best]
            L[~np.isfinite(cost[row, best])] = np.nan
            L[o] = np.nan
            pt[i, j] = L
    a, b = np.radians(G["pts"][own])[:, None], np.radians(G["pts"])[None]
    h = (np.sin((a[..., 0] - b[..., 0]) / 2) ** 2
         + np.cos(a[..., 0]) * np.cos(b[..., 0]) * np.sin((a[..., 1] - b[..., 1]) / 2) ** 2)
    d = 2 * 6371000 * np.arcsin(np.sqrt(h)) * DETOUR
    d[np.arange(len(own)), own] = np.nan
    out = np.full((len(G["codes"]), len(KEYS)), np.nan)
    for z in range(len(out)):
        k = np.flatnonzero(G["zone"] == z)
        p = pt[:, :, k].reshape(-1, 5)
        ok = np.isfinite(p[:, 0])
        out[z, 0] = np.nanmean(car[:, k])
        out[z, 1] = np.nanmean(d[:, k])
        out[z, 2:7] = p[ok].mean(0) if ok.any() else np.nan
        out[z, 7] = ok.mean()
    return out


def build():
    _init()
    n = len(G["codes"])
    log("%d zones, %d places, %d connections" % (n, len(G["nodes"]), len(G["con"])))
    with Pool(WORKERS, _init) as p:
        rows = p.map(_zone, range(n), chunksize=4)
    np.savez_compressed(LOS, codes=np.array(G["codes"]), los=np.stack(rows).astype("f4"))
    log("-> etl/cache/los.npz")


def load():
    if not os.path.exists(LOS):
        build()
    z = np.load(LOS)
    return [str(c) for c in z["codes"]], z["los"].astype(float)


if __name__ == "__main__":
    build()
