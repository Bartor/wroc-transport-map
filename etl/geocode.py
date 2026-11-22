# -*- coding: utf-8 -*-
"""Resolve coordinates for KBR measurement points that have no lat/lon in the
source workbooks (bicycle RR_*, pedestrian PP_*, railway cordon stations).

Strategy: pull the named road network for the Wroclaw area from Overpass once
(cached on disk), compute street-street intersections locally, then place each
point at the midpoint of the two intersections named in its "Odcinek" column.
Anything that does not resolve falls back to Nominatim, then to overrides.json.
"""
import json, os, re, sys, time, urllib.parse, urllib.request, math

CHR_NL = chr(10)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)
UA = "wroc-kbr-map/1.0 (local analysis tool)"
BBOX = (50.98, 16.78, 51.22, 17.20)  # s,w,n,e  - Wroclaw + margin


def _get(url, data=None, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:
            sys.stderr.write("  retry %d: %s\n" % (i + 1, e))
            time.sleep(5 * (i + 1))
    raise RuntimeError("failed: " + url)


def overpass_roads():
    """All named ways (roads, paths, bridges) in the bbox, with node geometry."""
    path = os.path.join(CACHE, "overpass_roads.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    q = """[out:json][timeout:300];
(
  way["highway"]["name"](%f,%f,%f,%f);
  way["man_made"="bridge"]["name"](%f,%f,%f,%f);
);
out geom;""" % (BBOX + BBOX)
    sys.stderr.write("querying overpass for named ways...\n")
    raw = _get("https://overpass-api.de/api/interpreter",
               data=urllib.parse.urlencode({"data": q}).encode())
    js = json.loads(raw)
    # keep it small: name + list of (lat,lon)
    out = []
    for el in js.get("elements", []):
        g = el.get("geometry")
        if not g:
            continue
        out.append({"name": el["tags"].get("name"),
                    "hw": el["tags"].get("highway"),
                    "g": [[round(p["lat"], 6), round(p["lon"], 6)] for p in g]})
    json.dump(out, open(path, "w", encoding="utf8"))
    sys.stderr.write("  %d named ways cached\n" % len(out))
    return out


def nominatim(q):
    path = os.path.join(CACHE, "nominatim.json")
    db = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {}
    if q in db:
        return db[q]
    url = ("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
           + urllib.parse.quote(q))
    time.sleep(1.1)
    try:
        r = json.loads(_get(url, tries=2))
    except Exception:
        r = []
    db[q] = [float(r[0]["lat"]), float(r[0]["lon"])] if r else None
    json.dump(db, open(path, "w", encoding="utf8"), ensure_ascii=False)
    return db[q]


# ---------------------------------------------------------------- name matching
PREFIX = re.compile(
    r"^\s*(?:"
    r"(?:ul|al|pl|os|gen|św)\.\s*"                       # abbreviations need the dot
    r"|(?:plac|aleja|aleje|alei|bulwar|bulwary|most|kladka|kładka|rondo|skwer|"
    r"park|promenada|wały|wał|wybrzeże|estakada|trasa|ulica)\s+"   # words need a space
    r")", re.I)
STOP = {"nad", "pod", "przy", "przez", "rzeka", "rzeką", "rzeki", "kanal", "kanał",
        "kanale", "kanału", "miejska", "miejskiej", "miejskim", "stronie", "obu",
        "i", "a", "o", "na", "w", "do", "z", "od", "między", "wysokości"}


def norm(s):
    if not s:
        return ""
    s = str(s).replace(CHR_NL, " ").replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip().lower()
    prev = None
    while prev != s:                      # "ul. bulwar Słoneczny" -> "słoneczny"
        prev = s
        s = PREFIX.sub("", s)
    return re.sub(r"[.,;]+$", "", s).strip()


def _denom(w):
    """Very rough Polish oblique-case -> nominative for street adjectives."""
    out = {w}
    for pat, rep in (("skiej$", "ska"), ("ckiej$", "cka"), ("iej$", "ia"),
                     ("ej$", "a"), ("ą$", "a"), ("ę$", "a"), ("y$", "y")):
        if re.search(pat, w):
            out.add(re.sub(pat, rep, w))
    return out


def variants(name):
    n = norm(name)
    if not n:
        return set()
    out = {n}
    # "kladka X nad Fosa Miejska" -> also try just "X"
    for cut in (" nad ", " przy ", " miedzy ", " między ", " pomiędzy ", " wzdłuż "):
        if cut in n:
            out.add(n.split(cut)[0].strip())
    for v in list(out):
        ws = v.split()
        if ws:
            for last in _denom(ws[-1]):
                out.add(" ".join(ws[:-1] + [last]))
    for v in list(out):
        out.add(v.replace("św. ", "świętego ").replace("św ", "świętego "))
        out.add(v.replace("świętego ", "św. "))
    return {norm(v) for v in out if v and norm(v)}


def _tokens(n):
    return [t for t in re.split(r"[^0-9a-ząćęłńóśźż]+", n) if t and t not in STOP]


def build_index(ways):
    idx = {}
    for w in ways:
        n = norm(w["name"])
        if n:
            idx.setdefault(n, []).append(w["g"])
    return idx


def lookup(idx, name):
    """Geometries for a street name: exact on any variant, else fuzzy on tokens."""
    vs = variants(name)
    gs = [g for v in vs if v in idx for g in idx[v]]
    if gs:
        return gs
    best, best_score = None, 0.0
    for v in vs:
        q = {t for t in _tokens(v) if len(t) > 2}
        if not q:
            continue
        for cand, geoms in idx.items():
            c = set(_tokens(cand))
            hit = q & c
            if not hit or not any(len(t) >= 4 for t in hit):
                continue
            score = len(hit) / len(q) - 0.05 * len(c - q)
            if score > best_score:
                best, best_score = cand, score
    if best is not None and best_score >= 0.55:
        return idx[best]
    return []


CENTRE = [51.1097, 17.0324]


def _pt_seg(p, a, b):
    """Distance (deg, lat-scaled) from point p to segment ab."""
    kx = 0.63                                    # cos(51 deg): lon -> lat scale
    px, py = (p[1] - a[1]) * kx, p[0] - a[0]
    bx, by = (b[1] - a[1]) * kx, b[0] - a[0]
    d2 = bx * bx + by * by
    t = 0.0 if d2 == 0 else max(0.0, min(1.0, (px * bx + py * by) / d2))
    dx, dy = px - t * bx, py - t * by
    return math.hypot(dx, dy)


def _cluster(geoms, anchor):
    """Ways sharing a name may sit in different towns; keep the relevant group."""
    if len(geoms) < 2:
        return geoms
    cs = [[sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)] for g in geoms]
    groups = []                                  # greedy single-link within 1.5 km
    for i, c in enumerate(cs):
        for gr in groups:
            if any(math.dist(c, cs[j]) < 0.015 for j in gr):
                gr.append(i)
                break
        else:
            groups.append([i])
    if anchor:
        key = lambda gr: min(math.dist(cs[j], anchor) for j in gr)
        best = min(groups, key=key)
    else:                                        # biggest, tie-break towards centre
        key = lambda gr: (-sum(len(geoms[j]) for j in gr),
                          min(math.dist(cs[j], CENTRE) for j in gr))
        best = min(groups, key=key)
    return [geoms[j] for j in best]


def intersections(idx, name_a, name_b, tol=3.6e-4):
    """Points where two named ways meet, within ~40 m."""
    gs_a, gs_b = lookup(idx, name_a), lookup(idx, name_b)
    hits = []
    for ga in gs_a:
        for gb in gs_b:
            for p in ga:
                best = min((_pt_seg(p, gb[i], gb[i + 1]) for i in range(len(gb) - 1)),
                           default=None)
                if best is not None and best <= tol:
                    hits.append(p)
    out = []
    for h in hits:
        if not any(abs(h[0] - o[0]) < 3e-4 and abs(h[1] - o[1]) < 3e-4 for o in out):
            out.append(list(h))
    return out


def street_centroid(idx, name, anchor=None):
    """Centroid of a named way; with an anchor, of its nearest quarter of vertices."""
    geoms = _cluster(lookup(idx, name), anchor)
    pts = [p for g in geoms for p in g]
    if not pts:
        return None
    if anchor:
        pts = sorted(pts, key=lambda p: math.dist(p, anchor))
        pts = pts[:max(2, len(pts) // 4)]
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


def split_odcinek(s):
    if not s:
        return None, None
    s = str(s).replace(CHR_NL, " ").replace(" ", " ")
    parts = re.split(r"\s[–—-]\s|\s–|–\s", s)
    parts = [p.strip() for p in parts if p and p.strip()]
    if len(parts) < 2:
        return None, None
    return parts[0], parts[-1]


def resolve(idx, street, odcinek, hint=None, overrides=None, key=None):
    """Return [lat, lon, method] or None."""
    if overrides and key and key in overrides:
        o = overrides[key]
        return [o[0], o[1], "manual"]
    a, b = split_odcinek(odcinek)
    if street and a and b:
        ia, ib = intersections(idx, street, a), intersections(idx, street, b)
        if ia and ib:
            best = min(((math.dist(p, q), p, q) for p in ia for q in ib),
                       key=lambda t: t[0])
            if best[0] < 0.03:                       # ~3 km apart at most
                return [(best[1][0] + best[2][0]) / 2,
                        (best[1][1] + best[2][1]) / 2, "intersections"]
        one = ia or ib
        if one:
            return [one[0][0], one[0][1], "one-intersection"]
        cross = intersections(idx, a, b)             # street unknown (bridge, path)
        if cross:
            anchor = cross[0]
            c = street_centroid(idx, street, anchor)
            if c and math.dist(c, anchor) < 0.02:
                return [c[0], c[1], "street-near-cross"]
            return [anchor[0], anchor[1], "cross-only"]
    anchor = None
    if a and b:
        ca, cb = street_centroid(idx, a), street_centroid(idx, b)
        if ca and cb and math.dist(ca, cb) < 0.03:
            anchor = [(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2]
    c = street_centroid(idx, street, anchor) if street else None
    if c:
        return [c[0], c[1], "street-centroid" if not anchor else "street-anchored"]
    if anchor:
        return [anchor[0], anchor[1], "cross-centroid"]
    for q in filter(None, [hint, (street or "") + ", Wrocław"]):
        r = nominatim(q)
        if r:
            return [r[0], r[1], "nominatim"]
    return None


def overpass_stops():
    """Named bus/tram stops in the bbox, so transit points can be placed by
    stop name. Poles sharing a name are averaged into one location."""
    path = os.path.join(CACHE, "overpass_stops.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    q = """[out:json][timeout:300];
(
  node["highway"="bus_stop"]["name"](%f,%f,%f,%f);
  node["railway"="tram_stop"]["name"](%f,%f,%f,%f);
  node["public_transport"="platform"]["name"](%f,%f,%f,%f);
  node["public_transport"="stop_position"]["name"](%f,%f,%f,%f);
);
out;""" % (BBOX * 4)
    sys.stderr.write("querying overpass for transit stops...\n")
    js = json.loads(_get("https://overpass-api.de/api/interpreter",
                         data=urllib.parse.urlencode({"data": q}).encode()))
    acc = {}
    for el in js.get("elements", []):
        n = el["tags"].get("name")
        if not n or "lat" not in el:
            continue
        a = acc.setdefault(n, [0.0, 0.0, 0])
        a[0] += el["lat"]
        a[1] += el["lon"]
        a[2] += 1
    out = {n: [round(a[0] / a[2], 6), round(a[1] / a[2], 6)] for n, a in acc.items()}
    json.dump(out, open(path, "w", encoding="utf8"), ensure_ascii=False)
    sys.stderr.write("  %d named stops cached\n" % len(out))
    return out


def stop_index(stops):
    idx = {}
    for n, c in stops.items():
        idx.setdefault(_stopkey(n), []).append(c)
    return idx


def _stopkey(n):
    n = str(n).lower().replace("\xa0", " ")
    n = re.sub(r"\(.*?\)", " ", n)                  # drop "(stacja kolejowa)" etc.
    n = re.sub(r"^(plac|aleja|ulica|osiedle|pl|al|ul|os)\.?\s+", "", n)
    n = re.sub(r"[^0-9a-ząćęłńóśźż]+", " ", n).strip()
    return n


def find_stop(sidx, name):
    """Coordinates for an MPK stop name; the data sometimes joins several stop
    names with '/', so try each part."""
    for part in re.split(r"\s*/\s*", str(name or "")):
        k = _stopkey(part)
        if not k:
            continue
        cs = sidx.get(k)
        if not cs:
            hits = [v for kk, v in sidx.items() if kk.startswith(k) or k.startswith(kk)]
            cs = hits[0] if len(hits) == 1 else None
        if cs:
            return [sum(c[0] for c in cs) / len(cs), sum(c[1] for c in cs) / len(cs)]
    return None


def overpass_stations():
    """Railway stations and halts across the wider region (rail cordons reach
    well outside the city bbox)."""
    path = os.path.join(CACHE, "overpass_stations.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    box = (50.70, 16.30, 51.60, 17.70)
    q = """[out:json][timeout:300];
(
  node["railway"~"^(station|halt)$"]["name"](%f,%f,%f,%f);
  way["railway"~"^(station|halt)$"]["name"](%f,%f,%f,%f);
);
out center;""" % (box + box)
    sys.stderr.write("querying overpass for railway stations...\n")
    js = json.loads(_get("https://overpass-api.de/api/interpreter",
                         data=urllib.parse.urlencode({"data": q}).encode()))
    out = {}
    for el in js.get("elements", []):
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat and lon:
            out.setdefault(_stopkey(el["tags"]["name"]), [round(lat, 6), round(lon, 6)])
    json.dump(out, open(path, "w", encoding="utf8"), ensure_ascii=False)
    sys.stderr.write("  %d stations cached\n" % len(out))
    return out


def find_station(stations, name):
    k = _stopkey(name)
    if k in stations:
        return stations[k]
    hits = [v for kk, v in stations.items() if kk.startswith(k) or k.startswith(kk)]
    return hits[0] if len(hits) == 1 else None


def city_boundary():
    """Outer ways of the Wroclaw municipal boundary, as lists of [lat, lon]."""
    path = os.path.join(CACHE, "wroclaw_boundary.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    q = """[out:json][timeout:120];
rel["boundary"="administrative"]["name"="Wrocław"]["admin_level"="8"];
out geom;"""
    js = json.loads(_get("https://overpass-api.de/api/interpreter",
                         urllib.parse.urlencode({"data": q}).encode()))
    ways = [[[p["lat"], p["lon"]] for p in m["geometry"]]
            for m in js["elements"][0]["members"]
            if m["type"] == "way" and m.get("role") == "outer" and m.get("geometry")]
    json.dump(ways, open(path, "w"))
    return ways


def cross_boundary(a, b, ways):
    """Where the straight line a-b crosses the boundary, or None."""
    def cut(p, q, r, s):
        d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
        if not d:
            return None
        t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
        u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
        return t if 0 <= t <= 1 and 0 <= u <= 1 else None
    ts = [t for w in ways for r, s in zip(w, w[1:]) for t in [cut(a, b, r, s)] if t is not None]
    if not ts:
        return None
    t = min(ts)                                   # first crossing going outwards
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
