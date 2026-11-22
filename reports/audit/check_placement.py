# -*- coding: utf-8 -*-
"""Check B: placement of every point (road, bike, ped, pt, rail) + node pairing.

    python -I reports/audit/check_placement.py   -> reports/audit/cache/placement.json

References used (all independent of the etl's own placement logic):
  road  : workbook coordinates (3.3 'Wykaz', copy in 3.4) + OSM named ways
  bike/ped : OSM named ways; crossings of the street with the two segment ends
  pt    : MPK stop poles from 6.3 ('Numer slupka') / 6.4 ('Nr slupka') located via
          the city's GTFS stops.txt stop_code (etl/cache/gtfs_127.zip)
  rail  : OSM stations; cordon station pairs from 7.1 'KORDONY - pasazerowie'
"""
import os, sys, re, json, csv, io, zipfile, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import hav, Ways, split_names, toks, name_match, crossing, poly_dist, strip_dia, Boundary

ROOT = os.getcwd()
C = os.path.join(ROOT, "reports", "audit", "cache")
raw = json.load(open(os.path.join(C, "raw.json"), encoding="utf8"))
L = lambda f: json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))
ways = Ways(os.path.join(ROOT, "etl", "cache", "overpass_roads.json"))
EXTRA = json.load(open(os.path.join(C, "overpass_extra.json"), encoding="utf8"))
BRIDGES = [(x["bridge_name"] or x["name"], x["g"]) for x in EXTRA
           if x["g"] and (x["bridge_name"] or re.match(r"(?i)(most|kładka)", x["name"] or ""))]
BRIDGES += [(w["name"], w["g"]) for w in ways.ways if re.match(r"(?i)(most|mosty|kładka)\b", w["name"])]


def bridge_near(p, maxd=30.0):
    best = (None, None)
    for n, g in BRIDGES:
        d, _ = poly_dist(p, g)
        if d <= maxd and (best[0] is None or d < best[0]):
            best = (d, n)
    return best
BND = Boundary(os.path.join(C, "wroclaw_boundary.json"))
BBOX = (50.98, 16.78, 51.22, 17.20)
NEAR = 60.0
OUT = {"road": {}, "bike": {}, "ped": {}, "pt": {}, "rail": {}, "nodes": [], "clusters": [],
       "missed_pairs": []}


def inbox(p):
    return BBOX[0] <= p[0] <= BBOX[2] and BBOX[1] <= p[1] <= BBOX[3]


def r6(p):
    return [round(p[0], 6), round(p[1], 6)] if p else None


def near3(p):
    return [[round(d), n] for d, n, _ in ways.nearest_any(p, 4)]


def seg_ends(seg):
    s = re.sub(r"\(.*?\)", " ", str(seg or "")).replace("\n", " ")
    parts = re.split(r"\s+[-–—]\s*|\s*[-–—]\s+", s)
    parts = [x.strip() for x in parts if x.strip()]
    return (parts[0], parts[-1]) if len(parts) >= 2 else (None, None)


def between(ways, street, seg, p):
    """Is p between the crossings of `street` with the two segment-end streets?
    Returns dict with status ok/off/unknown and evidence."""
    a, b = seg_ends(seg)
    if not a or not b:
        return {"status": "unknown", "why": "segment not 'X - Y'"}
    nonstreet = [x for x in (a, b) if re.match(r"(?i)\s*(węzeł|tory|wjazd|granica|szalet|zoo)", x)]
    if nonstreet:
        return {"status": "unknown", "why": "segment end not a street: %s" % nonstreet}
    if not ways.names_matching(a) or not ways.names_matching(b):
        miss = [x for x in (a, b) if not ways.names_matching(x)]
        return {"status": "unknown", "why": "segment end not an OSM street name: %s" % miss}
    ca = crossing(ways, street, a, near=p)
    cb = crossing(ways, street, b, near=p)
    if not ca or not cb:
        miss = [x for x, c in ((a, ca), (b, cb)) if not c]
        return {"status": "unknown", "why": "no OSM crossing of street with %s" % miss}
    # nearest pair of crossings (a short segment), considering a few candidates
    cand = sorted(((hav(x, y), x, y) for x in ca[:30] for y in cb[:30]), key=lambda t: t[0])
    # prefer the pair that contains p best
    best = min(cand[:50], key=lambda t: hav(p, t[1]) + hav(p, t[2]) - t[0] + 0.05 * t[0])
    dab, A, B = best
    excess = hav(p, A) + hav(p, B) - dab
    tol = max(60.0, 0.25 * dab)
    mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
    return {"status": "ok" if excess <= tol else "off", "A": r6(A), "B": r6(B),
            "seg_len_m": round(dab), "excess_m": round(excess), "mid": r6(mid)}


def snap(names, p, maxd=2000):
    d, on, q = ways.nearest_named(p, names)
    return (r6(q), round(d)) if d is not None and d <= maxd else (None, None)


# ===================================================================== road
pts = L("points")
cat = {c["id"]: c for c in raw["road_cat"]}
cat34 = raw["road_cat_34"]
for p in pts:
    pid = p["id"]
    r = {"name": p["name"], "notes": [], "ok": True, "certain": True}
    c = cat.get(pid)
    jp = [p["lat"], p["lon"]] if p.get("lat") else None
    if not jp:
        r["ok"] = False
        r["notes"].append("no coordinates in JSON")
        OUT["road"][pid] = r
        continue
    wb = [c["lat_raw"], c["lon_raw"]]
    r["wb"] = wb
    if not all(isinstance(x, (int, float)) for x in wb):
        r["notes"].append("workbook coords not numeric: %s" % wb)
    else:
        dj = hav(jp, wb)
        r["json_vs_wb_m"] = round(dj, 1)
        if dj > 1:
            r["ok"] = False
            r["notes"].append("JSON lat/lon differs from workbook by %.0f m" % dj)
        if not (50.5 < wb[0] < 51.6 and 16.3 < wb[1] < 17.8):
            r["ok"] = False
            r["notes"].append("workbook coords outside region (swapped?) %s" % wb)
    c2 = cat34.get(pid)
    if c2 and isinstance(c2.get("lat_raw"), (int, float)):
        d34 = hav(wb, [c2["lat_raw"], c2["lon_raw"]])
        if d34 > 1:
            r["notes"].append("3.4 copy of coords differs by %.0f m" % d34)
    names = split_names(p["name"])
    if p["name"].strip() in ("-", ""):
        names = []
    r["inbox"] = inbox(jp)
    if not names:
        r["dist_named"] = None
        r["named_check"] = "n/a: no street name (cordon road, only road ref in 'Odcinek')"
    else:
        d, on, q = ways.nearest_named(jp, names)
        if d is None:
            r["dist_named"] = None
            r["named_check"] = "n/a: name not found among OSM named ways%s" % (
                "" if inbox(jp) else " (outside OSM cache bbox)")
        else:
            r["dist_named"] = round(d)
            r["osm_name"] = on
            r["snap"] = r6(q)
            bd, bn = bridge_near(jp)
            if d > NEAR and bn and (name_match(p["name"], bn) or any(name_match(n, bn) for n in names)):
                r["notes"].append("on bridge '%s' named in the point name (%.0f m); OSM street way %.0f m" % (bn, bd, d))
                r["dist_named"] = round(bd)
            elif d > NEAR and bn and d <= 250:
                r["notes"].append("on bridge '%s' (%.0f m) which carries/adjoins %s (%.0f m) - OK" % (bn, bd, on, d))
            elif d > NEAR:
                r["ok"] = False
                r["notes"].append("%.0f m from nearest way named like '%s' (%s)" % (d, p["name"], on))
    r["nearest"] = near3(jp)
    if p["area"].startswith("Kordon Wr"):
        r["boundary_m"] = round(BND.dist(jp))
        r["inside_city"] = BND.inside(jp)
    # segment check (secondary): is the point between the two ends of 'Odcinek'?
    if names:
        bt = between(ways, names[0], p["segment"], jp)
        r["between"] = bt
        if bt["status"] == "off":
            r["notes"].append("outside segment '%s' by %s m (len %s m)%s" % (
                p["segment"], bt["excess_m"], bt["seg_len_m"],
                "" if bt["excess_m"] > 250 else " - minor"))
            if bt["excess_m"] > 250:
                r["ok"] = False
                r["certain"] = False
    OUT["road"][pid] = r
print("road done", file=sys.stderr)

# ===================================================================== bike / ped
ov = {k: v for k, v in json.load(open(os.path.join(ROOT, "etl", "overrides.json"), encoding="utf8")).items()
      if not k.startswith("_")}
for layer, data in (("bike", L("bike")), ("ped", L("ped"))):
    for p in data:
        pid = p["id"]
        r = {"name": p["name"], "segment": p["segment"], "geo": p.get("geo"), "notes": [],
             "ok": True, "certain": True}
        jp = [p["lat"], p["lon"]] if p.get("lat") else None
        if not jp:
            r["ok"] = False
            r["notes"].append("no coordinates")
            OUT[layer][pid] = r
            continue
        street = re.sub(r"\s*\(.*", "", p["name"]).strip()
        names = split_names(street)
        d, on, q = ways.nearest_named(jp, names) if names else (None, None, None)
        r["dist_named"] = None if d is None else round(d)
        r["osm_name"] = on
        r["nearest"] = near3(jp)
        if d is None:
            r["named_check"] = "n/a: '%s' not an OSM way name" % street
        elif d > NEAR:
            r["ok"] = False
            r["notes"].append("%.0f m from nearest way named like '%s' (%s)" % (d, street, on))
        bt = between(ways, street, p["segment"], jp) if names else {"status": "unknown", "why": "no street"}
        r["between"] = bt
        if bt["status"] == "off":
            r["ok"] = False
            r["notes"].append("not between segment ends (excess %s m over %s m segment)" % (
                bt["excess_m"], bt["seg_len_m"]))
        if pid in ov:
            r["override"] = ov[pid]
        OUT[layer][pid] = r
print("bike/ped done", file=sys.stderr)

# ===================================================================== pt
z = zipfile.ZipFile(os.path.join(ROOT, "etl", "cache", "gtfs_127.zip"))
gst = list(csv.DictReader(io.StringIO(z.read("stops.txt").decode("utf-8-sig"))))
bycode = {s["stop_code"]: [float(s["stop_lat"]), float(s["stop_lon"]), s["stop_name"]] for s in gst}


def skey(n):
    n = strip_dia(str(n or "")).lower()
    n = re.sub(r"\(.*?\)", " ", n)
    return " ".join(t for t in re.split(r"[^0-9a-z]+", n) if t and t not in ("pl", "plac", "ul", "al", "os"))


byname = collections.defaultdict(list)
for s in gst:
    byname[skey(s["stop_name"])].append([float(s["stop_lat"]), float(s["stop_lon"])])
poles64 = json.load(open(os.path.join(C, "pt_poles_64.json")))
cat63 = collections.defaultdict(list)
for c in raw["pt_cat"]:
    cat63[c["id"]].append(c)
pt = L("pt")
ptref = {}
for p in pt:
    pid = p["id"]
    # poles actually recorded in the 6.4 rows win; the 6.3 catalogue is the fallback
    # (6.3 lists PR_02B twice, the second row being the Rynek poles of PR_02C)
    poles = set(poles64.get(pid, {}))
    found = [bycode[x] for x in sorted(poles) if x in bycode]
    if not found:
        for c in cat63.get(pid, []):
            poles.update(c["poles"])
        found = [bycode[x] for x in sorted(poles) if x in bycode]
    ref, how = None, None
    if found:
        ref = [sum(f[0] for f in found) / len(found), sum(f[1] for f in found) / len(found)]
        spread = max(hav(ref, f) for f in found)
        how = "gtfs-poles(%d/%d)" % (len(found), len(poles))
        if spread > 400:      # poles of one section far apart: keep note
            how += " spread %dm" % spread
    ptref[pid] = (ref, how, found, poles)
# fallback by stop name, anchored on sibling sections of the same point
for p in pt:
    pid = p["id"]
    ref, how, found, poles = ptref[pid]
    if ref:
        continue
    sib = [ptref[q["id"]][0] for q in pt if q["point"] == p["point"] and ptref[q["id"]][0]]
    anchor = sib[0] if sib else ([p["lat"], p["lon"]] if p.get("lat") else None)
    names = [p.get("stop")] + [c["stop"] for c in cat63.get(pid, [])]
    best = None
    for n in names:
        for cnd in byname.get(skey(n), []):
            d = hav(anchor, cnd) if anchor else 0
            if best is None or d < best[0]:
                best = (d, cnd, n)
    if best and best[0] < 1500:
        # average all poles with that name within 300 m of the chosen one
        grp = [c for c in byname[skey(best[2])] if hav(c, best[1]) < 300]
        ref = [sum(g[0] for g in grp) / len(grp), sum(g[1] for g in grp) / len(grp)]
        how = "gtfs-name '%s' (poles %s not in GTFS)" % (best[2], sorted(poles))
    ptref[pid] = (ref, how, found, poles)

for p in pt:
    pid = p["id"]
    ref, how, found, poles = ptref[pid]
    r = {"name": p.get("stop") or p["name"], "loc": p["loc"], "geo": p.get("geo"), "notes": [],
         "ok": True, "certain": True, "ref": r6(ref), "ref_how": how}
    jp = [p["lat"], p["lon"]] if p.get("lat") else None
    if not jp:
        r["ok"] = False
        r["notes"].append("no coordinates (geo=%s)" % p.get("geo"))
        OUT["pt"][pid] = r
        continue
    # 6.3 vs 6.4 naming
    cs = cat63.get(pid, [])
    if cs and all(skey(c["stop"]) != skey(p.get("stop")) for c in cs):
        r["notes"].append("6.4 stop '%s' vs 6.3 stop %s" % (p.get("stop"), [c["stop"] for c in cs]))
    if ref:
        d = hav(jp, ref)
        r["dist_ref_m"] = round(d)
        if d > 150:
            r["ok"] = False
            r["notes"].append("%d m from its stop poles (%s)" % (d, how))
        elif d > 75:
            r["notes"].append("%d m from its stop poles (%s) - minor" % (d, how))
    else:
        r["certain"] = False
        r["notes"].append("no reference position (poles %s not in GTFS, stop name not matched)" % sorted(poles))
    # distance to the street in 'Lokalizacja'
    locn = split_names(re.sub(r"[–—]", "-", p["loc"]))
    d2, on, q = ways.nearest_named(jp, locn) if locn else (None, None, None)
    r["dist_named"] = None if d2 is None else round(d2)
    r["osm_name"] = on
    if ref:
        d3, _, _ = ways.nearest_named(ref, locn) if locn else (None, None, None)
        r["ref_dist_named"] = None if d3 is None else round(d3)
    r["nearest"] = near3(jp)
    OUT["pt"][pid] = r
print("pt done", file=sys.stderr)

# ===================================================================== rail
stations = json.load(open(os.path.join(ROOT, "etl", "cache", "overpass_stations.json"), encoding="utf8"))


def stkey(n):
    n = str(n).lower().replace("\xa0", " ")
    n = re.sub(r"\(.*?\)", " ", n)
    return re.sub(r"[^0-9a-ząćęłńóśźż]+", " ", n).strip()


# cordon groups from the 'KORDONY - pasazerowie' header (cached by extract? read here)
import openpyxl, warnings
warnings.filterwarnings("ignore")
f71 = [os.path.join(ROOT, "data", x) for x in os.listdir(os.path.join(ROOT, "data")) if x.startswith("Załącznik 7.1")][0]
wb = openpyxl.load_workbook(f71, read_only=True, data_only=True)
hdr = []
for i, rr in enumerate(wb["KORDONY - pasażerowie"].iter_rows(values_only=True)):
    if i in (4, 5):
        hdr.append(rr)
    if i > 5:
        break
wb.close()
groups, cur = {}, None
for k, st in zip(hdr[0][1:], hdr[1][1:]):
    if k:
        cur = str(k).strip()
    if st and cur and not str(st).startswith("Suma"):
        groups.setdefault(cur, []).append(str(st).strip())
OUT["rail_groups"] = groups
for c in L("rail"):
    cid = c["id"]
    r = {"name": " / ".join(c["stations"]), "notes": [], "ok": True, "certain": True}
    for st, co in c["stationCoords"].items():
        o = stations.get(stkey(st))
        if co[0] is None:
            r["notes"].append("station %s unresolved" % st)
            continue
        if o:
            d = hav(co[:2], o)
            if d > 300:
                r["ok"] = False
                r["notes"].append("station %s %d m from OSM station" % (st, d))
        else:
            r["notes"].append("station %s not in OSM station cache (placed by %s)" % (st, co[2]))
    g = groups.get(cid, [])
    inner = [s for s in g if s.startswith("Wrocław")]
    outer = [s for s in g if not s.startswith("Wrocław")]
    co = c["stationCoords"]
    jp = [c["lat"], c["lon"]]
    extra = sorted(set(c["stations"]) - set(g))
    if extra:
        r["notes"].append("centroid also averages stations outside the cordon pair list: %s" % extra)
    if inner and outer and all(co.get(s, [None])[0] for s in inner + outer):
        # crossing = midpoint between innermost Wroclaw station and the nearest outer one
        best = min(((hav(co[a][:2], co[b][:2]), a, b) for a in inner for b in outer), key=lambda t: t[0])
        mid = [(co[best[1]][0] + co[best[2]][0]) / 2, (co[best[1]][1] + co[best[2]][1]) / 2]
        d = hav(jp, mid)
        r["cordon_pair"] = [best[1], best[2]]
        xs = BND.cross_line(co[best[1]][:2], co[best[2]][:2])
        if xs:      # where the straight inner->outer station line crosses the city boundary
            mid = min(xs, key=lambda x: hav(x, mid))
            r["suggest_how"] = "straight line %s-%s crosses Wroclaw boundary" % (best[1], best[2])
        else:
            r["suggest_how"] = "midpoint %s-%s" % (best[1], best[2])
        d = hav(jp, mid)
        r["suggest"] = r6(mid)
        r["dist_ref_m"] = round(d)
        r["marker_inside_city"] = BND.inside(jp)
        if d > 2000:
            r["ok"] = False
            r["notes"].append("marker %.1f km from where the %s-%s line crosses the city boundary" % (
                d / 1000, best[1], best[2]))
    OUT["rail"][cid] = r
print("rail done", file=sys.stderr)

# ===================================================================== nodes
def merged(items, key):
    by = collections.OrderedDict()
    for it in items:
        by.setdefault(key(it), []).append(it)
    out = []
    for k, ms in by.items():
        out.append({"id": k, "lat": sum(m["lat"] for m in ms) / len(ms),
                    "lon": sum(m["lon"] for m in ms) / len(ms), "members": ms})
    return out


rn = merged([p for p in pts if p.get("lat")], lambda p: p["point"])
pn = merged([p for p in pt if p.get("lat")], lambda p: p["point"])
# "true" positions: road = workbook coords (same as JSON); pt = GTFS pole refs
for n in pn:
    refs = [ptref[m["id"]][0] for m in n["members"] if ptref[m["id"]][0]]
    n["ref"] = [sum(x[0] for x in refs) / len(refs), sum(x[1] for x in refs) / len(refs)] if refs else None


def pair(rn, pn, pos):
    cand = []
    for r in rn:
        for p in pn:
            pp = pos(p)
            if not pp:
                continue
            d = hav([r["lat"], r["lon"]], pp)
            if d <= 150:
                cand.append((d, r["id"], p["id"]))
    cand.sort()
    used_r, used_p, out = set(), set(), {}
    for d, a, b in cand:
        if a in used_r or b in used_p:
            continue
        used_r.add(a)
        used_p.add(b)
        out[a] = (b, d)
    return out


app = pair(rn, pn, lambda p: [p["lat"], p["lon"]])
true = pair(rn, pn, lambda p: p["ref"])
rby = {r["id"]: r for r in rn}
pby = {p["id"]: p for p in pn}


def rnames(r):
    return sorted({m["name"] for m in r["members"]})


def pnames(p):
    return sorted({m["loc"] for m in p["members"]}), sorted({m.get("stop") or "" for m in p["members"]})


for a, (b, d) in sorted(app.items()):
    r, p = rby[a], pby[b]
    locs, stops = pnames(p)
    rn_ = rnames(r)
    shared = any(name_match(x, y) or name_match(y, x)
                 for x in sum((split_names(n) for n in rn_), [])
                 for y in sum((split_names(n) for n in locs), []))
    dref = hav([r["lat"], r["lon"]], p["ref"]) if p["ref"] else None
    OUT["nodes"].append({"road": a, "pt": b, "dist_m": round(d), "road_names": rn_, "pt_locs": locs,
                         "pt_stops": stops, "street_shared": shared,
                         "dist_true_m": None if dref is None else round(dref),
                         "true_partner": true.get(a, (None,))[0]})
for a, (b, d) in sorted(true.items()):
    if app.get(a, (None,))[0] != b:
        OUT["missed_pairs"].append({"road": a, "pt": b, "dist_true_m": round(d),
                                    "app_partner": app.get(a, (None,))[0],
                                    "dist_app_m": round(hav([rby[a]["lat"], rby[a]["lon"]],
                                                            [pby[b]["lat"], pby[b]["lon"]])),
                                    "road_names": rnames(rby[a]), "pt_locs": pnames(pby[b])[0]})

# ===================================================================== clusters
allp = [("road", p["id"], p["lat"], p["lon"], p["name"]) for p in pts if p.get("lat")]
allp += [("pt", p["id"], p["lat"], p["lon"], p["loc"] + " / " + (p.get("stop") or "")) for p in pt if p.get("lat")]
allp += [(lay, p["id"], p["lat"], p["lon"], p["name"]) for lay in ("bike", "ped") for p in L(lay) if p.get("lat")]
cl = collections.defaultdict(list)
for t in allp:
    cl[(round(t[2], 5), round(t[3], 5))].append(t)
for k, v in cl.items():
    if len(v) > 1:
        OUT["clusters"].append({"at": list(k), "members": [[a, b, e] for a, b, _, _, e in v]})

json.dump(OUT, open(os.path.join(C, "placement.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
for layer in ("road", "bike", "ped", "pt", "rail"):
    bad = {k: v for k, v in OUT[layer].items() if not v["ok"]}
    print("%-5s checked %3d flagged %3d" % (layer, len(OUT[layer]), len(bad)))
print("app pairs", len(app), "true pairs", len(true), "missed/different", len(OUT["missed_pairs"]))
print("clusters", len(OUT["clusters"]))
