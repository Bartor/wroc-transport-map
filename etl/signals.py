# -*- coding: utf-8 -*-
"""Signalised junctions, with what actually passes through them.

Wroclaw has 1294 traffic-signal nodes in OSM. Grouped into junctions and joined
to the estimated traffic on each approach, that answers a question the survey
alone cannot: which signals sit on junctions that carry very little traffic.

This is a screening aid, not a recommendation. Whether a signal can go depends
on sight lines, pedestrian crossings, tram priority and collision history, none
of which are in here - so the output ranks junctions by how little traffic they
serve and leaves the judgement to a person.
"""
import json, math, os, sys, collections
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode, network as N

log = N.log
CLASS_RANK = {c: i for i, c in enumerate(reversed(N.DRIVABLE))}


def cluster(nodes, coord, node_edges, tol=45.0):
    """One junction can carry a signal node per approach; group them."""
    ids = list(nodes)
    parent = {i: i for i in ids}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_edge = collections.defaultdict(list)
    for nid in ids:
        for eid in node_edges.get(nid, ()):
            by_edge[eid].append(nid)
    for group in by_edge.values():                 # same edge -> same junction
        for other in group[1:]:
            union(group[0], other)

    grid = N.Grid([(nid, coord[nid][0], coord[nid][1]) for nid in ids
                   if nid in coord], cell=0.002)
    for nid in ids:
        if nid not in coord:
            continue
        for other, la, lo in grid.near(coord[nid][0], coord[nid][1], 1):
            if other != nid and N.haversine(coord[nid], (la, lo)) <= tol:
                union(nid, other)

    out = collections.defaultdict(list)
    for nid in ids:
        out[find(nid)].append(nid)
    return list(out.values())


def build(out_dir):
    edges, adj, coord = N.build_graph(N.fetch())
    sig = N.fetch_signal_kinds()
    signals = {int(k): v for k, v in sig.items() if v[0] == "traffic_signals"}
    log("%d signal nodes" % len(signals))

    pred_path = os.path.join(geocode.CACHE, "network_pred.npy")
    if not os.path.exists(pred_path):
        raise SystemExit("run the network stage first (npm run etl)")
    pred = np.load(pred_path)

    import snapshot
    S = snapshot.load()
    svc = S["svcBus"] + S["svcTram"]

    node_edges = collections.defaultdict(list)
    for eid, e in enumerate(edges):
        for nid in e["nodes"]:
            node_edges[nid].append(eid)

    ped = json.load(open(os.path.join(out_dir, "ped.json"), encoding="utf8"))
    bike = json.load(open(os.path.join(out_dir, "bike.json"), encoding="utf8"))
    soft = [(p["lat"], p["lon"], p["id"], sum(p["byHour"]), kind)
            for kind, rows in (("pieszy", ped), ("rowerowy", bike))
            for p in rows if p.get("lat")]

    groups = cluster(set(signals) & set(node_edges), coord, node_edges)
    log("%d signalised junctions" % len(groups))

    out = []
    for g in groups:
        pts = [coord[n] for n in g if n in coord]
        if not pts:
            continue
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        eids = sorted({eid for n in g for eid in node_edges.get(n, ())})
        if not eids:
            continue
        # A signal node interior to a single way is a mid-block pedestrian
        # crossing, not a junction; there the edge's own volume is the answer.
        # At a real junction a through street contributes two edges, so halving
        # the sum approximates vehicles entering rather than double counting.
        crossing = len(eids) < 2
        vehicles = float(pred[eids[0]]) if crossing else float(sum(pred[e] for e in eids)) / 2.0
        names = sorted({edges[e]["name"] for e in eids if edges[e]["name"]})
        cls = max((edges[e]["hw"] for e in eids), key=lambda c: CLASS_RANK.get(c, 0))
        runs = float(svc[eids[0]]) if crossing else float(sum(svc[e] for e in eids)) / 2.0
        tram = any(S["svcTram"][e] > 0 for e in eids)
        # "minor" = every approach is a local street, so the junction is a
        # candidate worth a human look rather than an obvious arterial.
        minor = all(edges[e]["hw"] in ("residential", "living_street",
                                       "unclassified", "tertiary", "tertiary_link")
                    for e in eids)
        near = None
        for la, lo, pid, tot, kind in soft:
            d = N.haversine((lat, lon), (la, lo))
            if d < 350 and (near is None or d < near["dist"]):
                near = {"id": pid, "dist": round(d), "total": int(tot), "kind": kind}
        out.append({
            "lat": round(lat, 6), "lon": round(lon, 6),
            "n": len(g), "arms": len(eids), "streets": names[:4],
            "c": cls, "v": int(round(vehicles)), "runs": int(round(runs)),
            "kind": "crossing" if crossing else "junction",
            "tram": 1 if tram else 0, "minor": 1 if minor else 0,
            "near": near,
        })

    out.sort(key=lambda r: r["v"])
    meta = {
        "signalNodes": len(signals), "junctions": len(out),
        "crossings": sum(1 for r in out if r["kind"] == "crossing"),
        "minorNoTram": sum(1 for r in out
                           if r["minor"] and not r["tram"] and r["kind"] == "junction"),
        "window": N.COMMON_HOURS,
        "note": ("Skrzyżowania z sygnalizacją z OpenStreetMap, połączone z "
                 "modelowym natężeniem na wlotach i liczbą kursów KZ z rozkładu. "
                 "Natężenie jest szacunkiem (mediana błędu 24%), a o możliwości "
                 "wyłączenia sygnalizacji decydują też widoczność, przejścia dla "
                 "pieszych, priorytet tramwaju i historia zdarzeń — tego tu nie ma. "
                 "Lista sortowana od najmniej obciążonych."),
    }
    p = os.path.join(out_dir, "signals.json")
    with open(p, "w", encoding="utf8") as f:
        json.dump({"meta": meta, "junctions": out}, f, ensure_ascii=False,
                  separators=(",", ":"))
    log("  -> signals.json  %.1f MB" % (os.path.getsize(p) / 1e6))
    return meta


if __name__ == "__main__":
    build(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "public", "data"))
