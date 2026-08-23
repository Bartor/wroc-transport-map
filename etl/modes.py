# -*- coding: utf-8 -*-
"""Network-wide estimate of bus and tram passenger flow.

Same machinery as the car model in network.py - route the demand over a directed
graph, then regress the measured counts on the resulting load - with two extra
features: how many bus lines and how many tram lines use each street, taken from
OSM route relations. Only streets that carry a line get an estimate.

Cycling and walking were tried the same way and dropped. Cycling scored R2cv
0.04 over 116 corridor counts: volume there follows whether a given cycle track
exists and is bearable, which a shortest-path assignment cannot see. Walking had
17 points inside one square kilometre, too few and too clustered to stretch over
a city. Both are documented in README.md rather than shipped as a layer.
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


def fetch_transit_routes():
    """Which streets carry bus or tram service, and how many lines."""
    q = ('[out:json][timeout:900];'
         'relation["type"="route"]["route"~"^(bus|tram|trolleybus)$"](%f,%f,%f,%f);'
         'out body;' % geocode.BBOX)

    def parse(js):
        # Two counts per street: distinct lines, and every route variant that
        # uses it. Variants stand in for service frequency, which the relations
        # do not carry.
        bus, tram = collections.Counter(), collections.Counter()
        busv, tramv = collections.Counter(), collections.Counter()
        seen = set()
        for el in js.get("elements", []):
            t = el.get("tags", {})
            kind = t.get("route")
            first = (kind, t.get("ref")) not in seen
            seen.add((kind, t.get("ref")))
            for m in el.get("members", []):
                if m.get("type") != "way":
                    continue
                w = str(m["ref"])
                (tramv if kind == "tram" else busv)[w] += 1
                if first:
                    (tram if kind == "tram" else bus)[w] += 1
        log("  %d bus ways, %d tram ways" % (len(busv), len(tramv)))
        return {"bus": dict(bus), "tram": dict(tram),
                "busVar": dict(busv), "tramVar": dict(tramv)}
    return _overpass("overpass_transit_routes.json", q, parse)


# --------------------------------------------------------------- observations
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
def build(out_dir, survey, pt):
    log("transit: loading route relations")
    routes = fetch_transit_routes()
    edges, adj, coord = N.build_graph(N.fetch())
    g = lambda d, e: d.get(str(e.get("wid")), 0)
    busv = np.array([g(routes["busVar"], e) for e in edges], float)
    tramv = np.array([g(routes["tramVar"], e) for e in edges], float)
    served = {i for i in range(len(edges)) if busv[i] or tramv[i]}
    log("  %d of %d edges carry a bus or tram line" % (len(served), len(edges)))

    origins, pool = N.demand(edges, adj, coord, survey, {}, {})
    fwd, bwd = N.assign_parallel(edges, origins, pool)
    # Route variants stand in for service frequency; distinct line counts did
    # slightly worse in the ablation (R2cv 0.251 vs 0.258).
    X = np.column_stack([N.features(edges, adj, fwd + bwd),
                         np.log1p(busv), np.log1p(tramv)])

    obs = pt_observations(pt)
    m = match_obs(edges, obs, tol=120, only=served)
    rows = np.array([eid for _, eid in m])
    y = np.log(np.array([o["v"] for o, _ in m], float))
    pred, lo, hi, stats = _predict(X, rows, y)
    log("transit: R2cv=%(r2cv)s medianAPE=%(mapeCv)s n=%(n)s" % stats)

    stats["matched"] = len(m)
    stats["servedEdges"] = len(served)
    stats["ceiling"] = (
        "Frekwencja kursowania jest tu zmienną dominującą, a relacje tras z OSM "
        "jej nie niosą — stąd niskie R². Rozkład jazdy w formacie GTFS "
        "(liczba odjazdów na godzinę na każdym przystanku) rozwiązałby to "
        "od ręki; portal danych otwartych Wrocławia blokuje jednak dostęp "
        "automatyczny. Wgraj plik GTFS, a model da się przebudować.")
    keep = [i for i in served if pred[i] >= 20]
    meta = emit(out_dir, "network_pt.json", edges, keep, pred, lo, hi, stats,
                {"window": WINDOW})
    with open(os.path.join(out_dir, "network_modes.json"), "w", encoding="utf8") as f:
        json.dump({"pt": meta}, f, ensure_ascii=False, separators=(",", ":"))
    return {"pt": meta}


# ------------------------------------------------------ scheduled service (GTFS)
def shape_to_edges(edges, dep, tol=45.0):
    """Lay each timetable shape onto the graph: vehicles per edge, per mode."""
    items = [(eid, p[0], p[1]) for eid, e in enumerate(edges) for p in e["g"]]
    grid = N.Grid(items, cell=0.003)
    acc = {k: np.zeros(len(edges)) for k in ("tram", "bus", "dayTram", "dayBus")}
    for v in dep.values():
        used = set()
        for lat, lon in v.get("pts") or []:
            best = None
            for eid, la, lo in grid.near(lat, lon, 1):
                d = N.haversine((lat, lon), (la, lo))
                if d <= tol and (best is None or d < best[1]):
                    best = (eid, d)
            if best:
                used.add(best[0])
        for eid in used:
            for k in acc:
                acc[k][eid] += v[k]
    return acc


def build_service(out_dir):
    """Scheduled departures per street, straight from the city's GTFS.

    This is not a model: it is the published timetable laid onto the road graph.
    It answers "how much transit runs here", which turned out to be the more
    useful question, since passenger volume per street could not be predicted
    from anything we have (see build() above).
    """
    import gtfs
    edges, adj, _ = N.build_graph(N.fetch())
    dep = gtfs.departures_by_shape(WINDOW)
    acc = shape_to_edges(edges, dep)
    total = acc["tram"] + acc["bus"]
    keep = [i for i in range(len(edges)) if total[i] > 0]
    log("  %d streets carry scheduled service" % len(keep))

    recs = []
    for i in keep:
        e = edges[i]
        recs.append({
            "g": [[round(p[0], 5), round(p[1], 5)] for p in N.simplify(e["g"])],
            "c": e["hw"], "n": e["name"] or "",
            "v": int(total[i]), "tram": int(acc["tram"][i]), "bus": int(acc["bus"][i]),
            "day": int(acc["dayTram"][i] + acc["dayBus"][i]),
        })
    meta = {
        "source": "GTFS Wrocław (CC0 1.0), open-data.cui.wroclaw.pl",
        "gtfsFile": gtfs.latest_id(), "window": WINDOW, "edges": len(recs),
        "measured": True,
        "note": ("Rozkład jazdy, nie model: liczba kursów w oknie 6–10 i 15–19 "
                 "w typowy dzień roboczy, nałożona na graf ulic. Kurs liczony "
                 "wg godziny odjazdu z pierwszego przystanku, więc w środku "
                 "trasy wartość jest przybliżona."),
    }
    p = os.path.join(out_dir, "network_service.json")
    with open(p, "w", encoding="utf8") as f:
        json.dump({"meta": meta, "edges": recs}, f, ensure_ascii=False,
                  separators=(",", ":"))
    log("  -> network_service.json  %.1f MB" % (os.path.getsize(p) / 1e6))
    return meta
