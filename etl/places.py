# -*- coding: utf-8 -*-
"""Where people went, more closely than a zone: addresses that at least MIN_WHO
of them named as something other than home - malls, offices, schools.

The only step that reads addresses from the survey, and never one of a home: an
end of a trip counts only when its purpose is not home. An address fewer people
named is not kept; it falls back to its street within the zone, if that has
enough, and otherwise stays at the zone.
"""
import collections, json, math, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import diary
import geocode

MIN_WHO = 5
KM_LON = math.cos(math.radians(51.11))
log = diary.log

# words that say what kind of street or who the patron was
NOISE = set("ul ulica al aleja aleje pl plac os osiedle gen generala generał generała ks ksiedza księdza "
            "dr doktora prof profesora im bp sw św swietego świętego mjr majora kpt kapitana plk płk "
            "pulkownika pułkownika marszalka marszałka marsz rondo skwer bulwar droga szosa".split())
KINDS = {"mall": 5, "hospital": 4, "university": 4, "college": 3, "department_store": 3, "school": 3,
         "townhall": 3, "marketplace": 3, "theatre": 2, "cinema": 2, "supermarket": 2, "sports_centre": 2,
         "stadium": 3, "kindergarten": 1, "clinic": 1, "library": 1}


def words(street):
    out = re.findall(r"[^\W_]+", str(street or "").lower())
    return tuple(w for w in out if w not in NOISE and not (len(w) == 1 and not w.isdigit())) or tuple(out)


def number(nr):
    s = str(nr or "").strip().upper().replace(" ", "")
    # Excel made dates of 4/6 and the like: "04.CZE"
    m = re.match(r"^(\d{1,2})\.([A-ZĄĆĘŁŃÓŚŹŻ]{3})$", s)
    months = ["STY", "LUT", "MAR", "KWI", "MAJ", "CZE", "LIP", "SIE", "WRZ", "PAŹ", "LIS", "GRU"]
    if m and m.group(2) in months:
        s = "%d/%d" % (int(m.group(1)), months.index(m.group(2)) + 1)
    return re.sub(r"\.0$", "", s)


def _overpass(name, q):
    path = os.path.join(geocode.CACHE, name)
    if not os.path.exists(path):
        log("querying overpass for", name, "...")
        raw = geocode._get("https://overpass-api.de/api/interpreter",
                           data=urllib.parse.urlencode({"data": q}).encode())
        with open(path, "w", encoding="utf8") as f:
            json.dump(json.loads(raw)["elements"], f)
    with open(path, encoding="utf8") as f:
        return json.load(f)


def addresses():
    """House numbers from OSM: number -> [(street words, lat, lon)]."""
    out = collections.defaultdict(list)
    box = "(50.95,16.70,51.35,17.35)"
    for el in _overpass("overpass_addr.json", '[out:json][timeout:600][maxsize:1073741824];'
                        'nwr["addr:housenumber"]%s;out tags center qt;' % box):
        t, c = el.get("tags", {}), el.get("center") or el
        street = t.get("addr:street") or t.get("addr:place")
        if street and "lat" in c:
            for n in re.split(r"[;,]", t["addr:housenumber"]):
                out[number(n)].append((words(street), c["lat"], c["lon"]))
    return out


def names():
    """Named places people go to, for telling an address by what is there."""
    out = []
    box = "(50.95,16.70,51.35,17.35)"
    q = ('[out:json][timeout:300];(nwr["shop"~"^(mall|department_store|supermarket)$"]["name"]%s;'
         'nwr["amenity"~"^(university|college|hospital|school|townhall|marketplace|theatre|cinema|clinic|library|kindergarten)$"]["name"]%s;'
         'nwr["leisure"~"^(sports_centre|stadium)$"]["name"]%s;);out tags center qt;' % (box, box, box))
    for el in _overpass("overpass_poi.json", q):
        t, c = el.get("tags", {}), el.get("center") or el
        kind = t.get("shop") or t.get("amenity") or t.get("leisure")
        if "lat" in c:
            out.append((KINDS.get(kind, 0), t["name"], c["lat"], c["lon"],
                        words(t.get("addr:street")), number(t.get("addr:housenumber"))))
    return out


def metres(a, b):
    return math.hypot(a[0] - b[0], (a[1] - b[1]) * KM_LON) * 111320


def build(d, zones, shapes, inside):
    """-> [spot], and per trip of the diary the spots of its two ends (-1)."""
    import openpyxl
    ws = openpyxl.load_workbook(diary.find("Baza danych_gospodarstwa"), read_only=True,
                                data_only=True)["BAZA - DANE OGÓŁEM"]
    head, ends = None, []
    for row in ws.iter_rows(values_only=True):
        if head is None:
            if row and row[0] == "podrozID":
                head = {n: i for i, n in enumerate(row) if n}
            continue
        if not row or row[0] is None or row[head["STARTrejon"]] is None or row[head["STOPrejon"]] is None:
            continue
        pair = []
        for e in ("START", "STOP"):
            if str(row[head[e + "mot"]]) == "dom":
                pair.append(None)
                continue
            street, nr = row[head[e + "ul"]], number(row[head[e + "nr"]])
            pair.append((str(row[head[e + "rejon"]]), words(street), nr, str(street or "").strip(),
                         row[head["osobaID"]]) if street else None)
        ends.append(pair)
    assert len(ends) == len(d["trips"])
    who = collections.defaultdict(set)
    label = collections.defaultdict(collections.Counter)
    for pair in ends:
        for e in pair:
            if e:
                z, w, nr, name, person = e
                for key in ((w, nr, z) if nr else None, (w, None, z)):
                    if key:
                        who[key].add(person)
                        label[key][name] += 1
    keep = {k for k, v in who.items() if len(v) >= MIN_WHO}
    at = {z["id"]: i for i, z in enumerate(zones)}
    addr, poi = addresses(), names()
    roads = collections.defaultdict(list)
    for r in geocode.overpass_roads():
        if r["name"]:
            roads[words(r["name"])[-1]].append((words(r["name"]), r["g"]))

    def near(z, p, slack):
        return inside(p[0], p[1], shapes[z]) or metres(p, zones[z]["c"]) < slack

    def pretty(key):
        s = label[key].most_common(1)[0][0].title()
        s = re.sub(r"\b(Gen|Ks|Dr|Prof|Pl|Al|Ul|Św)\b\.?", lambda m: m.group(1).lower() + ".", s)
        return (s + " " + key[1]).strip() if key[1] else s

    spots, index, lost = [], {}, 0
    for key in sorted(keep, key=lambda k: (k[1] is None, -len(who[k]))):
        w, nr, zid = key
        z = at.get(zid)
        if z is None:
            continue
        found = None
        if nr:
            cands = []
            for n in dict.fromkeys([nr, *re.split(r"[/-]", nr), re.sub(r"[A-Z]+$", "", nr)]):
                for ow, la, lo in addr.get(n, ()):
                    if ow and w[-1] in ow and near(z, (la, lo), 1500):
                        cands.append((n == nr, len(set(ow) & set(w)), -metres((la, lo), zones[z]["c"]), la, lo))
            if cands:
                found = max(cands)[-2:]
        else:
            pts = [p for ow, g in roads.get(w[-1], ()) if set(w) & set(ow) for p in g if inside(p[0], p[1], shapes[z])]
            if pts:
                found = min(pts, key=lambda p: sum(metres(p, q) for q in pts[::max(1, len(pts) // 40)]))
        if not found:
            lost += 1
            continue
        name = pretty(key)
        if nr:
            # what stands there, when the map names it
            here = [(k, n) for k, n, la, lo, pw, pn in poi
                    if metres((la, lo), found) < 90 or (pn == nr and pw and w[-1] in pw and metres((la, lo), found) < 400)]
            if here and max(here)[0] >= 2:
                name = "%s (%s)" % (max(here)[1], name)
        index[key] = len(spots)
        spots.append({"name": name, "lat": round(found[0], 5), "lon": round(found[1], 5), "z": z,
                      "who": len(who[key]), "street": int(not nr)})
    out = []
    for pair in ends:
        p = []
        for e in pair:
            k = -1
            if e:
                z, w, nr, _, _ = e
                k = index.get((w, nr, z), -1) if nr else -1
                if k < 0:
                    k = index.get((w, None, z), -1)
            p.append(k)
        out.append(p)
    n = sum(e is not None for p in ends for e in p)
    hit = [k for p in out for k in p if k >= 0]
    log("  places: %d (%d by number), %d not found; %d of %d ends away from home placed, %d by number" % (
        len(spots), sum(not s["street"] for s in spots), lost, len(hit), n,
        sum(not spots[k]["street"] for k in hit)))
    return spots, out
