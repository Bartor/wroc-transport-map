# -*- coding: utf-8 -*-
"""Feature-based checks for bike/road points whose 'street' is not a street
(promenades, embankments, footbridges, bridges, railway crossings).
Uses etl/cache/overpass_roads.json + reports/audit/cache/overpass_extra.json.
Prints evidence; results are written to cache/special.json for the report."""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import hav, poly_dist, Ways, crossing

ROOT = os.getcwd()
ways = Ways(os.path.join(ROOT, "etl", "cache", "overpass_roads.json"))
X = json.load(open(os.path.join(ROOT, "reports", "audit", "cache", "overpass_extra.json"), encoding="utf8"))


def feat(pred):
    return [x["g"] for x in X if pred(x) and x["g"]]


def dist_to(p, geoms):
    best = (1e18, None)
    for g in geoms:
        d, q = poly_dist(p, g)
        if d < best[0]:
            best = (d, q)
    return best


def street_near_feature(street, geoms, near=None):
    """Point(s) where a named street comes closest to / crosses a feature."""
    best = (1e18, None)
    for g in ways.geoms(street):
        for p in g:
            d, q = dist_to(p, geoms)
            if near and hav(p, near) > 3000:
                continue
            if d < best[0]:
                best = (d, p)
    return best


def mid(a, b):
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]


def r6(p):
    return [round(p[0], 6), round(p[1], 6)] if p else None


def nearest_on(geoms, p):
    return dist_to(p, geoms)[1]


L = lambda f: {p["id"]: p for p in json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))}
bike, road = L("bike"), L("points")
out = {}


def report(pid, layer, jp, feature_name, geoms, ends, extra=""):
    """ends: two cross-street names; ref = midpoint of where they meet the feature,
    snapped onto the feature."""
    d_feat, _ = dist_to(jp, geoms)
    ea = street_near_feature(ends[0], geoms, jp) if ends[0] else (None, None)
    eb = street_near_feature(ends[1], geoms, jp) if ends[1] else (None, None)
    ref = None
    note = ""
    if ea[1] and eb[1] and ea[0] < 400 and eb[0] < 400:
        m = mid(nearest_on(geoms, ea[1]), nearest_on(geoms, eb[1]))
        ref = nearest_on(geoms, m)
        note = "ends meet feature at %s (%.0f m off) and %s (%.0f m off)" % (r6(ea[1]), ea[0], r6(eb[1]), eb[0])
    else:
        note = "segment ends not located on feature: %s=%s, %s=%s" % (
            ends[0], None if ea[0] is None else round(ea[0]), ends[1], None if eb[0] is None else round(eb[0]))
    o = {"layer": layer, "feature": feature_name, "json": r6(jp), "dist_feature_m": round(d_feat),
         "ref": r6(ref), "dist_ref_m": round(hav(jp, ref)) if ref else None, "note": note + extra}
    out[pid] = o
    print(pid, o)


def P(d, pid):
    return [d[pid]["lat"], d[pid]["lon"]]


water = lambda *names: feat(lambda x: x["waterway"] in ("river", "canal") and x["name"] in names)
named = lambda *names: feat(lambda x: x["name"] in names or x["bridge_name"] in names) + \
    [w["g"] for w in ways.ways if w["name"] in names]
rail = feat(lambda x: x["railway"] == "rail")

report("RR_08", "bike", P(bike, "RR_08"), "Promenada Oławska (path)", named("Promenada Oławska"),
       ("Most Oławski", "ul. Walońska"))
report("RR_26", "bike", P(bike, "RR_26"), "Promenada Krzycka (path)", named("Promenada Krzycka"),
       ("ul. Borowska", "ul. Pirenejska"))
report("RR_27", "bike", P(bike, "RR_27"), "Promenada Krzycka (path)", named("Promenada Krzycka"),
       ("ul. Bardzka", "ul. Ziębicka"))
report("RR_20", "bike", P(bike, "RR_20"), "Ślęza river", water("Ślęza"), ("ul. Trawowa", "ul. Francuska"))
report("RR_30", "bike", P(bike, "RR_30"), "Stara Odra", water("Stara Odra"), ("ul. Sopocka", "ul. Pasteura"))
report("RR_31", "bike", P(bike, "RR_31"), "Kanał Powodziowy", water("Kanał Powodziowy"), ("ul. Pilata", "ul. Czackiego"))
report("RR_32B", "bike", P(bike, "RR_32B"), "Kanał Żeglugowy", water("Kanał Żeglugowy"), ("ul. Długosza", "ul. Łąka Mazurska"))
jaz = feat(lambda x: x["name"] == "Jaz Psie Pole")
report("RR_32A", "bike", P(bike, "RR_32A"), "Odra / Kanał Miejski (embankment between)",
       water("Odra", "Kanał Miejski"), (None, None),
       extra="; Jaz Psie Pole at %s, %.0f m from point" % (r6(jaz[0][0]) if jaz else None,
                                                           dist_to(P(bike, "RR_32A"), jaz)[0] if jaz else -1))
report("RR_28", "bike", P(bike, "RR_28"), "Kładka Siedlecka", named("Kładka Siedlecka"), ("ul. Wilcza", "ul. Krzywa Grobla"))
# Hallera at the railway: where does Hallera cross a railway line?
hal = ways.geoms("al. Hallera")
best = (1e18, None)
for g in hal:
    for i in range(len(g) - 1):
        for p in (g[i], g[i + 1]):
            d, q = dist_to(p, rail)
            if d < best[0] and hav(p, P(bike, "RR_21A")) < 1500:
                best = (d, p)
jp = P(bike, "RR_21A")
out["RR_21A"] = {"layer": "bike", "feature": "Hallera x railway", "json": r6(jp),
                 "dist_feature_m": round(dist_to(jp, hal)[0]), "ref": r6(best[1]),
                 "dist_ref_m": round(hav(jp, best[1])),
                 "note": "Hallera vertex nearest a railway line (%.0f m from rail); point is %.0f m from Hallera"
                         % (best[0], dist_to(jp, hal)[0])}
print("RR_21A", out["RR_21A"])
# Park Zachodni path between Pilczycka and Milenijna
jp = P(bike, "RR_13")
pil, mil = ways.geoms("ul. Pilczycka"), ways.geoms("ul. Milenijna")
dp, qp = dist_to(jp, pil)
dm, qm = dist_to(jp, mil)
# nearest pair of points between the two streets (the cobbled link runs between them)
bp = min(((hav(a, b), a, b) for g1 in pil for a in g1 for g2 in mil for b in g2), key=lambda t: t[0])
out["RR_13"] = {"layer": "bike", "feature": "link Pilczycka-Milenijna", "json": r6(jp),
                "dist_feature_m": None, "ref": r6(mid(bp[1], bp[2])), "dist_ref_m": round(hav(jp, mid(bp[1], bp[2]))),
                "note": "point %.0f m from Pilczycka, %.0f m from Milenijna; streets closest (%.0f m apart) at %s / %s"
                        % (dp, dm, bp[0], r6(bp[1]), r6(bp[2]))}
print("RR_13", out["RR_13"])
# road: Most Olimpijski, AOW_04 on most Redzinski (A8)
for pid, nm in (("R2_15B", "Most Olimpijski"), ("AOW_04", "most Rędziński")):
    jp = P(road, pid)
    g = named(nm, nm.lower(), nm[0].upper() + nm[1:])
    out[pid] = {"layer": "road", "feature": nm, "json": r6(jp), "dist_feature_m": round(dist_to(jp, g)[0]),
                "ref": None, "dist_ref_m": None, "note": "distance to the way carrying bridge name '%s'" % nm}
    print(pid, out[pid])
json.dump(out, open(os.path.join(ROOT, "reports", "audit", "cache", "special.json"), "w", encoding="utf8"),
          ensure_ascii=False, indent=1)
