# -*- coding: utf-8 -*-
"""Network-wide estimates for cycling, transit passengers and walking.

Same idea as the car model in network.py - route the demand over a graph, then
regress the measured counts on the resulting load - but each mode gets the
network it actually uses and the observations that actually exist for it.

The amount of evidence differs by an order of magnitude between modes, and that
shows up in the reported error. Walking has 17 measured points inside one square
kilometre; build() fits it, cross-validates it, and refuses to publish a layer
when the result does not generalise, rather than drawing a confident line down
every street in the city.
"""
import json, math, os, sys, collections
import urllib.parse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode
import network as N

CACHE = geocode.CACHE
log = N.log
WINDOW = N.COMMON_HOURS                      # 6-10 and 15-19, shared by all modes

# Cyclists and pedestrians use links cars cannot. Footways and service roads are
# fetched for the walking graph but kept out of the cycling one: including every
# pavement in Wroclaw put 300k edges in the graph and let the router send
# cyclists down alleyways, which is not where they were counted.
SOFT_CLASSES = N.DRIVABLE + ["cycleway", "path", "footway", "pedestrian",
                             "track", "service", "steps"]

# Riding speeds in km/h, so routing prefers separated infrastructure over big
# roads even when the big road is more direct.
CYCLE_SPEED = {"cycleway": 18, "path": 13, "pedestrian": 9,
               "track": 10, "living_street": 14,
               "residential": 15, "unclassified": 15, "tertiary": 14,
               "secondary": 12, "primary": 10, "trunk": 5, "motorway": 0.05,
               "motorway_link": 0.05, "trunk_link": 5, "primary_link": 10,
               "secondary_link": 12, "tertiary_link": 14}

WALK_SPEED = {"footway": 5, "pedestrian": 5, "path": 4.6, "steps": 1.6,
              "living_street": 4.6, "residential": 4.4, "track": 4,
              "service": 4.2, "unclassified": 4.2, "tertiary": 4,
              "secondary": 3.8, "primary": 3.5, "trunk": 1, "motorway": 0.05,
              "motorway_link": 0.05, "cycleway": 4.6, "trunk_link": 1,
              "primary_link": 3.5, "secondary_link": 3.8, "tertiary_link": 4}

CYCLE_PUBLISH = {"cycleway", "path", "primary", "secondary", "tertiary",
                 "unclassified", "residential", "living_street", "pedestrian",
                 "track", "primary_link", "secondary_link", "tertiary_link"}


# --------------------------------------------------------------------- source
def _overpass(cache_name, query, parse):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    log("querying overpass: %s" % cache_name)
    js = json.loads(geocode._get("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": query}).encode()))
    out = parse(js)
    json.dump(out, open(path, "w", encoding="utf8"))
    return out


def fetch_soft():
    """Everything walkable or rideable, including paths closed to cars."""
    q = '[out:json][timeout:900];way["highway"~"^(%s)$"](%f,%f,%f,%f);out body geom;' % (
        "|".join(SOFT_CLASSES), *geocode.BBOX)

    def parse(js):
        out = []
        for el in js.get("elements", []):
            g, ns = el.get("geometry"), el.get("nodes")
            if not g or not ns:
                continue
            t = el.get("tags", {})
            out.append({
                "id": el["id"], "nodes": ns,
                "g": [[round(p["lat"], 6), round(p["lon"], 6)] for p in g],
                "hw": t.get("highway"), "name": t.get("name"),
                "cyc": 1 if (t.get("highway") in ("cycleway",)
                             or t.get("cycleway") or t.get("cycleway:both")
                             or t.get("cycleway:left") or t.get("cycleway:right")
                             or t.get("bicycle") == "designated") else 0,
            })
        log("  %d ways" % len(out))
        return out
    return _overpass("overpass_soft.json", q, parse)


def fetch_transit_routes():
    """Which streets carry bus or tram service, and how many lines."""
    q = ('[out:json][timeout:900];'
         'relation["type"="route"]["route"~"^(bus|tram|trolleybus)$"](%f,%f,%f,%f);'
         'out body;' % geocode.BBOX)

    def parse(js):
        bus, tram, seen = collections.Counter(), collections.Counter(), set()
        for el in js.get("elements", []):
            t = el.get("tags", {})
            kind = t.get("route")
            key = (kind, t.get("ref"))
            if key in seen:                  # count a line once, not per direction
                continue
            seen.add(key)
            for m in el.get("members", []):
                if m.get("type") == "way":
                    (tram if kind == "tram" else bus)[str(m["ref"])] += 1
        log("  %d bus ways, %d tram ways" % (len(bus), len(tram)))
        return {"bus": dict(bus), "tram": dict(tram)}
    return _overpass("overpass_transit_routes.json", q, parse)


def soft_graph(speeds):
    """Graph over the walk/cycle network at the given per-class speeds."""
    return N.build_graph(N.apply_speeds(fetch_soft(), speeds))


# --------------------------------------------------------------- observations
def bike_observations(road, points, bike, cat_order):
    """Every cycle count in the survey, on the common 8-hour window.

    Three sources: the dedicated RR_ cycle points, bikes counted on the
    carriageway at the road cross-sections, and bikes counted on the cycle
    infrastructure beside them.
    """
    ci = {c: i for i, c in enumerate(cat_order)}
    obs = []
    for p in points:
        s = road.get(p["id"])
        if not s or not p.get("lat") or "off" not in s:
            # Without the off-carriageway count we would only see cyclists on the
            # carriageway, which on a street with a cycle track is close to zero
            # and would teach the model the opposite of the truth.
            continue
        v = 0
        for d in s["dirs"].values():
            for h in WINDOW:
                v += d["h"][h][ci["a1"]] + d["h"][h][ci["a2"]]
        for rows in (s.get("off") or {}).values():
            for h in WINDOW:
                v += sum(rows[h])                       # a3, a4, b3, b4
        if v >= 5:
            obs.append({"lat": p["lat"], "lon": p["lon"], "v": v, "src": "road"})
    for b in bike:
        if not b.get("lat"):
            continue
        v = sum(b["byHour"][h] for h in WINDOW)
        if v > 0:
            obs.append({"lat": b["lat"], "lon": b["lon"], "v": v, "src": "rr"})
    return obs


def ped_observations(ped):
    return [{"lat": p["lat"], "lon": p["lon"], "src": "pp",
             "v": sum(p["byHour"][h] for h in WINDOW)}
            for p in ped if p.get("lat") and sum(p["byHour"][h] for h in WINDOW) > 0]


def pt_observations(pt):
    out = []
    for p in pt:
        if not p.get("lat"):
            continue
        v = sum(sum(a) for a in p["byHour"].values())
        if v > 0:
            out.append({"lat": p["lat"], "lon": p["lon"], "v": v, "src": "pt",
                        "tram": 1 if "tramwaj" in (p.get("byTraction") or {}) else 0})
    return out


# --------------------------------------------------------------------- fitting
def match_obs(edges, obs, tol=90.0, only=None):
    """Nearest edge to each observation, optionally within a subset of edges."""
    items = []
    for eid, e in enumerate(edges):
        if only is not None and eid not in only:
            continue
        for p in e["g"]:
            items.append((eid, p[0], p[1]))
    grid = N.Grid(items, cell=0.003)
    out = []
    for o in obs:
        best = None
        for eid, lat, lon in grid.near(o["lat"], o["lon"], rings=1):
            d = min(N.haversine((o["lat"], o["lon"]), q) for q in edges[eid]["g"])
            if d <= tol and (best is None or d < best[1]):
                best = (eid, d)
        if best:
            out.append((o, best[0]))
    return out


def loo(X, rows, y):
    """Leave-one-out, for modes with too few points to split into folds."""
    pred = np.empty(len(y))
    for i in range(len(y)):
        keep = [j for j in range(len(y)) if j != i]
        b, *_ = np.linalg.lstsq(X[rows][keep], y[keep], rcond=None)
        pred[i] = X[rows][i] @ b
    ape = np.abs(np.expm1(pred) - np.expm1(y)) / np.maximum(1, np.expm1(y))
    return {
        "n": int(len(y)),
        "r2cv": round(float(1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2)), 3),
        "mapeCv": round(float(np.median(ape)), 3),
        "p90ApeCv": round(float(np.quantile(ape, 0.9)), 3),
        "sigma": round(float(np.std(y - pred)), 3),
    }


# A layer is only published if the cross-validated fit beats the naive "predict
# the average" baseline by a clear margin. R2cv <= 0.2 means it does not.
MIN_R2 = 0.2
MIN_OBS = 40


def emit(out_dir, name, edges, keep, pred, lo, hi, stats, extra):
    recs = []
    for i in keep:
        e = edges[i]
        recs.append({
            "g": [[round(p[0], 5), round(p[1], 5)] for p in N.simplify(e["g"])],
            "c": e["hw"], "n": e["name"] or "",
            "v": int(round(pred[i])), "lo": int(round(lo[i])), "hi": int(round(hi[i])),
            **({"cyc": 1} if e.get("cyc") else {}),
        })
    meta = dict(stats)
    meta.update(extra)
    meta["edges"] = len(recs)
    p = os.path.join(out_dir, name)
    with open(p, "w", encoding="utf8") as f:
        json.dump({"meta": meta, "edges": recs}, f, ensure_ascii=False,
                  separators=(",", ":"))
    log("  -> %s  %.1f MB (%d edges)" % (name, os.path.getsize(p) / 1e6, len(recs)))
    return meta


def _predict(X, rows, y, folds=5):
    if len(y) >= MIN_OBS:
        beta, stats = N.fit_cv(X[rows], y, folds=folds)
    else:
        stats = loo(X, rows, y)
        beta, *_ = np.linalg.lstsq(X[rows], y, rcond=None)
    pred = np.exp(X @ beta)
    lo = np.exp(np.log(pred) - 1.28 * stats["sigma"])
    hi = np.exp(np.log(pred) + 1.28 * stats["sigma"])
    stats["usable"] = bool(stats["r2cv"] >= MIN_R2 and stats["n"] >= MIN_OBS)
    return pred, lo, hi, stats


# ----------------------------------------------------------------------- build
def build(out_dir, road, points, survey, bike, ped, pt, cat_order):
    report = {}

    # ---- cycling -----------------------------------------------------------
    log("cycling: building network")
    edges, adj, coord = soft_graph(CYCLE_SPEED)
    log("  %d edges, %d junctions" % (len(edges), len(adj)))
    obs = bike_observations(road, points, bike, cat_order)
    log("  %d cycle counts" % len(obs))
    # Cyclists make shorter trips, so the destination pull is tighter.
    origins, pool = N.demand(edges, adj, coord, survey, {}, {}, n_dest=3000)
    fwd, bwd = N.assign_parallel(edges, origins, pool, trips=35,
                                 cache=os.path.join(CACHE, "overpass_soft.json"),
                                 speeds=CYCLE_SPEED)
    load = fwd + bwd
    X = features(edges, load)
    m = match_obs(edges, obs)
    rows = np.array([eid for _, eid in m])
    y = np.log(np.array([o["v"] for o, _ in m], float))
    pred, lo, hi, stats = _predict(X, rows, y)
    stats["matched"] = len(m)
    stats["graphEdges"] = len(edges)
    if stats["usable"]:
        keep = [i for i, e in enumerate(edges)
                if e["hw"] in CYCLE_PUBLISH and pred[i] >= 15]
        report["bike"] = emit(out_dir, "network_bike.json", edges, keep, pred,
                              lo, hi, stats, {"window": WINDOW})
    else:
        stats["reason"] = (
            "Model nie przeszedł walidacji krzyżowej — ruch rowerowy zależy od "
            "jakości konkretnej drogi rowerowej, a nie od położenia w sieci, "
            "więc rozkład najkrótszymi trasami go nie tłumaczy. Warstwa nie "
            "jest publikowana.")
        report["bike"] = stats

    # ---- walking -----------------------------------------------------------
    log("walking: 17 points, all inside the old town - fitting to see if it holds")
    wedges, wadj, wcoord = soft_graph(WALK_SPEED)
    wobs = ped_observations(ped)
    worigins, wpool = N.demand(wedges, wadj, wcoord, survey, {}, {}, n_dest=2500)
    wf, wb = N.assign_parallel(wedges, worigins, wpool, trips=25,
                               cache=os.path.join(CACHE, "overpass_soft.json"),
                               speeds=WALK_SPEED)
    WX = features(wedges, wf + wb)
    wm = match_obs(wedges, wobs, tol=60)
    wrows = np.array([eid for _, eid in wm])
    wy = np.log(np.array([o["v"] for o, _ in wm], float))
    wpred, wlo, whi, wstats = _predict(WX, wrows, wy)
    wstats["reason"] = (
        "17 punktów pomiarowych, wszystkie w obrębie Starego Miasta. Za mało "
        "i zbyt skupione, by przenosić model na całe miasto — warstwa nie jest "
        "publikowana, zostaje sam wynik walidacji."
    ) if not wstats["usable"] else ""
    report["ped"] = dict(wstats)
    report["ped"]["matched"] = len(wm)
    if wstats["usable"]:
        keep = [i for i, e in enumerate(wedges) if wpred[i] >= 20]
        report["ped"] = emit(out_dir, "network_ped.json", wedges, keep, wpred,
                             wlo, whi, wstats, {"window": WINDOW})

    # ---- transit passengers ------------------------------------------------
    log("transit: loading route relations")
    routes = fetch_transit_routes()
    redges, radj, rcoord = N.build_graph(N.fetch())
    bus = np.array([routes["bus"].get(str(e.get("wid")), 0) for e in redges], float)
    tram = np.array([routes["tram"].get(str(e.get("wid")), 0) for e in redges], float)
    served = {i for i in range(len(redges)) if bus[i] or tram[i]}
    log("  %d of %d edges carry a bus or tram line" % (len(served), len(redges)))
    origins, pool = N.demand(redges, radj, rcoord, survey, {}, {})
    fwd, bwd = N.assign_parallel(redges, origins, pool)
    RX = np.column_stack([features(redges, fwd + bwd),
                          np.log1p(bus), np.log1p(tram)])
    pobs = pt_observations(pt)
    pm = match_obs(redges, pobs, tol=120, only=served)
    prows = np.array([eid for _, eid in pm])
    py = np.log(np.array([o["v"] for o, _ in pm], float))
    ppred, plo, phi, pstats = _predict(RX, prows, py)
    keep = [i for i in served if ppred[i] >= 20]
    pstats["matched"] = len(pm)
    pstats["servedEdges"] = len(served)
    if pstats["usable"]:
        report["pt"] = emit(out_dir, "network_pt.json", redges, keep, ppred, plo,
                            phi, pstats, {"window": N.COMMON_HOURS})
    else:
        report["pt"] = pstats

    # The diagnostics matter as much as the layers: a mode that did not survive
    # validation should say so in the interface, not quietly vanish.
    with open(os.path.join(out_dir, "network_modes.json"), "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, separators=(",", ":"))
    return report


def features(edges, load):
    """Routing load, road class, and distance to the centre - one row per edge."""
    groups = N.GROUPS + ["soft"]
    X = np.zeros((len(edges), 4 + len(groups)))
    for i, e in enumerate(edges):
        mid = e["g"][len(e["g"]) // 2]
        g = N.CLASS_GROUP.get(e["hw"])
        if g is None:
            g = "soft" if e["hw"] in ("cycleway", "path", "footway", "pedestrian",
                                      "track", "steps") else "other"
        X[i, 0] = 1.0
        X[i, 1] = math.log1p(load[i])
        X[i, 2] = 1.0 if e.get("cyc") else 0.0
        X[i, 3] = math.log1p(N.haversine(mid, N.CENTRE) / 1000.0)
        X[i, 4 + groups.index(g)] = 1.0
    return X
