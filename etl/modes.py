# -*- coding: utf-8 -*-
"""Network-wide estimates for cycling, transit passengers and walking.

Same idea as the car model in network.py - route the demand over a graph, then
regress the measured counts on the resulting load - but each mode gets the
network it actually uses and the observations that actually exist for it.

How much data each mode has to learn from differs by an order of magnitude, and
that shows up in the reported error. Walking has 17 points in one square
kilometre; the honest result there is "not enough", and build() says so rather
than drawing a confident line down every street.
"""
import json, math, os, sys, collections, random
import urllib.parse
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode
import network as N

CACHE = geocode.CACHE
log = N.log

# Cyclists and pedestrians use paths cars cannot.
CYCLE_CLASSES = N.DRIVABLE + ["cycleway", "path", "footway", "pedestrian",
                              "track", "steps", "service"]
CYCLE_PUBLISH = {"cycleway", "path", "footway", "pedestrian", "primary",
                 "secondary", "tertiary", "unclassified", "residential",
                 "living_street", "track"}

# Riding speeds, so the routing prefers separated infrastructure over big roads.
CYCLE_SPEED = {"cycleway": 18, "path": 14, "footway": 8, "pedestrian": 8,
               "track": 10, "steps": 2, "service": 12, "living_street": 14,
               "residential": 15, "unclassified": 15, "tertiary": 14,
               "secondary": 12, "primary": 10, "trunk": 6, "motorway": 0.1,
               "motorway_link": 0.1, "trunk_link": 6, "primary_link": 10,
               "secondary_link": 12, "tertiary_link": 14}


def fetch_cycle():
    path = os.path.join(CACHE, "overpass_cycle.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    q = '[out:json][timeout:600];way["highway"~"^(%s)$"](%f,%f,%f,%f);out body geom;' % (
        "|".join(CYCLE_CLASSES), *geocode.BBOX)
    log("querying overpass for the cycle/walk network...")
    js = json.loads(geocode._get("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": q}).encode()))
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
            "oneway": "no",                       # bikes ignore most oneways
            "lanes": t.get("lanes"), "maxspeed": None,
            "cycleway": t.get("cycleway") or t.get("cycleway:both")
            or t.get("cycleway:left") or t.get("cycleway:right"),
            "bicycle": t.get("bicycle"), "foot": t.get("foot"),
        })
    json.dump(out, open(path, "w", encoding="utf8"))
    log("  %d ways cached" % len(out))
    return out


def fetch_transit_routes():
    """Bus and tram route relations, to know which streets carry service."""
    path = os.path.join(CACHE, "overpass_transit_routes.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    q = ('[out:json][timeout:600];'
         'relation["type"="route"]["route"~"^(bus|tram|trolleybus)$"](%f,%f,%f,%f);'
         'out body;' % geocode.BBOX)
    log("querying overpass for transit routes...")
    js = json.loads(geocode._get("https://overpass-api.de/api/interpreter",
                                 data=urllib.parse.urlencode({"data": q}).encode()))
    bus, tram = collections.Counter(), collections.Counter()
    seen = set()
    for el in js.get("elements", []):
        t = el.get("tags", {})
        kind = t.get("route")
        key = (kind, t.get("ref"), t.get("name"))
        if key in seen:                            # both directions of a line
            continue
        seen.add(key)
        for m in el.get("members", []):
            if m.get("type") != "way":
                continue
            (tram if kind == "tram" else bus)[str(m["ref"])] += 1
    out = {"bus": dict(bus), "tram": dict(tram)}
    json.dump(out, open(path, "w", encoding="utf8"))
    log("  %d bus ways, %d tram ways" % (len(bus), len(tram)))
    return out


def build_cycle_graph(ways):
    for w in ways:
        w["maxspeed"] = CYCLE_SPEED.get(w["hw"], 12)
    saved = dict(N.FREE_SPEED)
    N.FREE_SPEED.update(CYCLE_SPEED)
    try:
        edges, adj, coord = N.build_graph(ways)
    finally:
        N.FREE_SPEED.clear()
        N.FREE_SPEED.update(saved)
    for e, w in zip(edges, edges):
        pass
    return edges, adj, coord


# --------------------------------------------------------------- observations
def bike_observations(road, points, bike):
    """Every cycle count in the survey, on one common 8-hour window.

    Three sources: the dedicated RR_ cycle points, bikes counted on the
    carriageway at the road cross-sections, and bikes counted on the cycle
    infrastructure beside them.
    """
    ci = {c: i for i, c in enumerate(N.VEH_CATS)} if hasattr(N, "VEH_CATS") else None
    obs = []
    for p in points:
        s = road.get(p["id"])
        if not s or not p.get("lat"):
            continue
        v = 0
        for d in s["dirs"].values():
            for h in N.COMMON_HOURS:
                for c in ("a1", "a2"):
                    v += d["h"][h][BIKE_ON_IDX[c]]
        for rows in (s.get("off") or {}).values():
            for h in N.COMMON_HOURS:
                v += sum(rows[h])                  # a3,a4,b3,b4
        if v > 0:
            obs.append({"lat": p["lat"], "lon": p["lon"], "v": v,
                        "src": "road", "id": p["id"], "name": p["name"]})
    for b in bike:
        if not b.get("lat"):
            continue
        v = sum(b["byHour"][h] for h in N.COMMON_HOURS)
        if v > 0:
            obs.append({"lat": b["lat"], "lon": b["lon"], "v": v,
                        "src": "rr", "id": b["id"], "name": b["name"]})
    return obs


BIKE_ON_IDX = {}      # filled by build() once the category order is known


def ped_observations(ped):
    return [{"lat": p["lat"], "lon": p["lon"], "src": "pp", "id": p["id"],
             "name": p["name"],
             "v": sum(p["byHour"][h] for h in N.COMMON_HOURS)}
            for p in ped if p.get("lat")]


def pt_observations(pt):
    out = []
    for p in pt:
        if not p.get("lat"):
            continue
        v = 0
        for arr in p["byHour"].values():
            v += sum(arr)
        if v > 0:
            out.append({"lat": p["lat"], "lon": p["lon"], "v": v, "src": "pt",
                        "id": p["id"], "name": p["stop"] or p["name"],
                        "tram": 1 if "tramwaj" in p.get("byTraction", {}) else 0})
    return out


# --------------------------------------------------------------------- model
def match_obs(edges, obs, tol=80.0, only=None):
    """Nearest edge to each observation, optionally restricted to a subset."""
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
            out.append((o, best[0], best[1]))
    return out


def fit_and_predict(X, rows, y, min_obs=40, folds=5):
    """Returns (predictions, stats). Refuses to extrapolate from too few points."""
    if len(y) < min_obs:
        beta, *_ = np.linalg.lstsq(X[rows], y, rcond=None)
        loo = []
        for i in range(len(y)):
            keep = [j for j in range(len(y)) if j != i]
            b, *_ = np.linalg.lstsq(X[rows][keep], y[keep], rcond=None)
            loo.append(float(X[rows][i] @ b))
        loo = np.array(loo)
        ape = np.abs(np.expm1(loo) - np.expm1(y)) / np.maximum(1, np.expm1(y))
        return None, {
            "n": int(len(y)), "usable": False,
            "r2cv": round(float(1 - np.sum((y - loo) ** 2) / np.sum((y - y.mean()) ** 2)), 3),
            "mapeCv": round(float(np.median(ape)), 3),
            "sigma": round(float(np.std(y - loo)), 3),
        }
    beta, stats = N.fit_cv(X[rows], y, folds=folds)
    stats["usable"] = True
    return np.exp(X @ beta), stats
