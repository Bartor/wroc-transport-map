# -*- coding: utf-8 -*-
"""Freeze the expensive parts of the pipeline so models can be tried quickly.

Rebuilding the graph and rerunning the assignment costs about half a minute per
experiment, which is enough to discourage trying things. This writes one .npz
with everything a model needs - edge attributes, routing load, junction degrees,
GTFS service, transit routes, and the matched observations - so an experiment
loads in under a second.

    python etl/snapshot.py          # build or refresh
    from snapshot import load; S = load()
"""
import json, math, os, sys, collections
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode, network as N

OUT = os.path.join(geocode.CACHE, "snapshot.npz")
META = os.path.join(geocode.CACHE, "snapshot_meta.json")
DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "public", "data")
log = N.log


def _load(name):
    return json.load(open(os.path.join(DATA, name + ".json"), encoding="utf8"))


def build():
    edges, adj, coord = N.build_graph(N.fetch())
    log("graph: %d edges" % len(edges))

    road, points, survey = _load("road")["sections"], _load("points"), _load("survey")
    meas = N.measured(road, points)
    matched, unmatched = N.match_edges(edges, meas)
    origins, pool = N.demand(edges, adj, coord, survey, meas, matched)
    fwd, bwd = N.assign_parallel(edges, origins, pool)

    deg = N.junction_degrees(adj)
    sig = N.fetch_signal_kinds()

    import modes, gtfs
    routes = modes.fetch_transit_routes()
    dep = gtfs.departures_by_shape(N.COMMON_HOURS)
    svc = modes.shape_to_edges(edges, dep)

    g = lambda d, e: d.get(str(e.get("wid")), 0)
    n = len(edges)
    arrays = {
        "fwd": fwd, "bwd": bwd,
        "len": np.array([e["len"] for e in edges]),
        "lanes": np.array([e["lanes"] for e in edges]),
        "speed": np.array([e["speed"] for e in edges]),
        "lat": np.array([e["g"][len(e["g"]) // 2][0] for e in edges]),
        "lon": np.array([e["g"][len(e["g"]) // 2][1] for e in edges]),
        "distCentre": np.array([N.haversine(e["g"][len(e["g"]) // 2], N.CENTRE)
                                for e in edges]),
        "degU": np.array([deg.get(e["u"], 0) for e in edges], float),
        "degV": np.array([deg.get(e["v"], 0) for e in edges], float),
        "signals": np.array([sum(1 for x in e["nodes"]
                                 if (sig.get(str(x)) or [None])[0] == "traffic_signals")
                             for e in edges], float),
        "bridge": np.array([float(e.get("bridge") or 0) for e in edges]),
        "oneway": np.array([0.0 if (e["fwd"] and e["bwd"]) else 1.0 for e in edges]),
        "hasRef": np.array([1.0 if e.get("ref") else 0.0 for e in edges]),
        "busRoutes": np.array([g(routes["busVar"], e) for e in edges], float),
        "tramRoutes": np.array([g(routes["tramVar"], e) for e in edges], float),
        "svcBus": svc["bus"], "svcTram": svc["tram"],
        "svcDay": svc["dayBus"] + svc["dayTram"],
    }

    rows = sorted(matched.items())
    arrays["obsEdge"] = np.array([m["edge"] for _, m in rows])
    arrays["obsValue"] = np.array([meas[s]["v"] for s, _ in rows], float)
    arrays["obsDist"] = np.array([m["dist"] for _, m in rows], float)

    pt = _load("pt")
    pobs = modes.pt_observations(pt)
    served = {i for i in range(n) if arrays["svcBus"][i] or arrays["svcTram"][i]}
    pm = modes.match_obs(edges, pobs, tol=120, only=served)
    arrays["ptEdge"] = np.array([e for _, e in pm])
    arrays["ptValue"] = np.array([o["v"] for o, _ in pm], float)

    np.savez_compressed(OUT, **arrays)
    json.dump({
        "n": n, "classes": [e["hw"] for e in edges],
        "names": [e["name"] or "" for e in edges],
        "obsIds": [s for s, _ in rows], "unmatched": unmatched,
        "ptN": len(pm), "groups": N.GROUPS,
    }, open(META, "w", encoding="utf8"), ensure_ascii=False)
    log("  -> %s  %.1f MB" % (os.path.basename(OUT), os.path.getsize(OUT) / 1e6))
    return OUT


def load():
    if not os.path.exists(OUT):
        build()
    d = dict(np.load(OUT))
    d["meta"] = json.load(open(META, encoding="utf8"))
    return d


if __name__ == "__main__":
    build()
