# -*- coding: utf-8 -*-
"""The household survey for the app: zones, trips between them, days, answers.

    python etl/trips.py          # data/kbr + etl/cache/diary.json -> public/data

zones.json    zone and district outlines, residents, jobs
trips.json    one row per reported trip, between zones; by column
answers.json  how each question was answered, summed over zones
days.json     each person's day as a chain of districts and purposes
places.json   places at least five people went to, see places.py
freight.json  the freight survey's trips, between zones; by column

A home is never placed closer than its zone, or in days.json its district; a
trip carries no person or household, only the traits trips are filtered by. Those
and the weight still often tell one person's trips apart from the next one's -
the city publishes far more. Answers are sums, of at least MIN_N people; groups
of people only by district.
"""
import collections, json, math, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import diary
import geocode
import places

OUT = os.path.join(diary.ROOT, "public", "data")
MIN_N = 10
CORE_M = 1500           # a zone with its middle this near the Rynek is the core
CENTRE = (51.1097, 17.0324)
KM_LON = math.cos(math.radians(51.11))

log = diary.log


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    log("  %s %.0f kB" % (name, os.path.getsize(path) / 1024))


def sheet(parts, name, skip):
    import openpyxl
    ws = openpyxl.load_workbook(diary.find(*parts, "xlsx"), read_only=True, data_only=True)[name]
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i >= skip:
            yield r


# -------------------------------------------------------------------- outlines
def osiedla():
    """The city's 48 districts, from OSM: name -> rings of (lat, lon)."""
    path = os.path.join(geocode.CACHE, "overpass_osiedla.json")
    if not os.path.exists(path):
        q = ('[out:json][timeout:180];area["name"="Wrocław"]["admin_level"="8"]->.a;'
             'rel(area.a)["boundary"="administrative"]["admin_level"="9"];out geom;')
        raw = geocode._get("https://overpass-api.de/api/interpreter",
                           data=urllib.parse.urlencode({"data": q}).encode())
        with open(path, "w", encoding="utf8") as f:
            json.dump(json.loads(raw)["elements"], f)
    out = {}
    with open(path, encoding="utf8") as f:
        elements = json.load(f)
    for el in elements:
        ways = [[(p["lat"], p["lon"]) for p in m["geometry"]] for m in el["members"]
                if m["type"] == "way" and m["role"] != "inner"]
        rings = []
        while ways:
            r = ways.pop()
            while r[0] != r[-1]:
                for i, w in enumerate(ways):
                    if w[0] == r[-1]:
                        r = r + w[1:]
                    elif w[-1] == r[-1]:
                        r = r + w[-2::-1]
                    else:
                        continue
                    ways.pop(i)
                    break
                else:
                    break
            rings.append(r)
        out[el["tags"]["name"]] = rings
    return out


def inside(la, lo, rings):
    c = False
    for r in rings:
        j = len(r) - 1
        for i in range(len(r)):
            (y1, x1), (y2, x2) = r[i], r[j]
            if (y1 > la) != (y2 > la) and lo < (x2 - x1) * (la - y1) / (y2 - y1) + x1:
                c = not c
            j = i
    return c


def middle(ring):
    """Centroid, and area in square degrees."""
    a = cx = cy = 0.0
    for (y0, x0), (y1, x1) in zip(ring, ring[1:] + ring[:1]):
        q = x0 * y1 - x1 * y0
        a += q
        cx += (x0 + x1) * q
        cy += (y0 + y1) * q
    return (cy / (3 * a), cx / (3 * a)), abs(a) / 2


def dp(pts, eps):
    """Douglas-Peucker, in degrees of latitude."""
    if len(pts) < 3:
        return pts
    (ay, ax), (by, bx) = pts[0], pts[-1]
    dx, dy = (bx - ax) * KM_LON, by - ay
    size = math.hypot(dx, dy)
    worst, at = 0, 0
    for i in range(1, len(pts) - 1):
        px, py = (pts[i][1] - ax) * KM_LON, pts[i][0] - ay
        d = abs(px * dy - py * dx) / size if size else math.hypot(px, py)
        if d > worst:
            worst, at = d, i
    if worst <= eps:
        return [pts[0], pts[-1]]
    return dp(pts[:at + 1], eps)[:-1] + dp(pts[at:], eps)


def _key(p):
    return round(p[0], 6), round(p[1], 6)


def _open(r):
    r = [_key(p) for p in r]
    return r[:-1] if r[0] == r[-1] else r


def simplify(shapes, eps):
    """Outlines with shared borders simplified once, so neighbours still meet.

    `shapes` is a list of lists of rings. Vertices where the set of borders
    changes hold still; what runs between two of them is simplified the same
    whichever side it is met from."""
    nb = collections.defaultdict(set)
    use = collections.Counter()
    rings = [[_open(r) for r in s] for s in shapes]
    for s in rings:
        for r in s:
            for a, b in zip(r, r[1:] + r[:1]):
                nb[a].add(b)
                nb[b].add(a)
                use[frozenset((a, b))] += 1

    def fixed(p):
        ns = list(nb[p])
        return len(ns) != 2 or use[frozenset((p, ns[0]))] != use[frozenset((p, ns[1]))]

    memo = {}

    def arc(pts):
        k = (pts[0], pts[1], pts[-1], len(pts))
        if k not in memo:
            s = dp(pts, eps)
            memo[k] = s
            memo[(pts[-1], pts[-2], pts[0], len(pts))] = s[::-1]
        return memo[k]

    out = []
    for s in rings:
        rs = []
        for r in s:
            at = [i for i, p in enumerate(r) if fixed(p)]
            if len(at) < 2:
                at = [0, len(r) // 2]
            ring = []
            for i, j in zip(at, at[1:] + [at[0] + len(r)]):
                ring += arc([r[k % len(r)] for k in range(i, j + 1)])[:-1]
            if len(ring) >= 3:
                rs.append(ring)
        out.append(rs)
    return out


def dissolve(shapes):
    """One outline around several that share borders exactly."""
    edges = set()
    for s in shapes:
        for r in s:
            r = _open(r)
            for a, b in zip(r, r[1:] + r[:1]):
                if a == b:
                    continue
                if (b, a) in edges:
                    edges.remove((b, a))
                else:
                    edges.add((a, b))
    nxt = collections.defaultdict(list)
    for a, b in edges:
        nxt[a].append(b)
    rings = []
    while nxt:
        ring = [next(iter(nxt))]
        while True:
            a = ring[-1]
            b = nxt[a].pop()
            if not nxt[a]:
                del nxt[a]
            if b == ring[0] or b not in nxt:
                break
            ring.append(b)
        if len(ring) > 3:
            rings.append(ring)
    # borders that do not match leave pieces that do not add up; then the
    # shapes themselves, with the lines between them
    area = lambda rs: sum(_signed(r) for r in rs)
    own = [_open(r) for s in shapes for r in s]
    return rings if abs(area(rings) - area(own)) < 0.005 * abs(area(own)) else own


def _signed(r):
    return sum(x0 * y1 - x1 * y0 for (y0, x0), (y1, x1) in zip(r, r[1:] + r[:1])) / 2


def code(rings):
    """Rings as running differences of whole 1e-5 degrees."""
    out = []
    for r in rings:
        flat, la, lo = [], 0, 0
        for y, x in r:
            y, x = round(y * 1e5), round(x * 1e5)
            flat += [y - la, x - lo]
            la, lo = y, x
        out.append(flat)
    return out


def stage_zones(d):
    Z, _, _ = diary.zones()
    names, pop = {}, {}
    for r in sheet(("3.1_agregacja",), "Agregacja rejonów", 5):
        if isinstance(r[1], (int, float)):
            names[str(int(r[1]))] = str(r[0]).strip()
            pop[str(int(r[1]))] = r[9]
    for r in sheet(("10.3",), "Przewozy towarów baza danych", 4):
        for c, n in ((r[5], r[6]), (r[12], r[13])):
            if c is not None and n:
                names.setdefault(str(c), str(n).strip())
    gmina = {c[:-3]: n.split(" - ")[0] for c, n in names.items() if len(c) in (4, 5)}
    # one way round, or the borders of neighbours would not cancel out
    def turn(r):
        a = sum(x0 * y1 - x1 * y0 for (y0, x0), (y1, x1) in zip(r, r[1:] + r[:1]))
        return r if a > 0 else r[::-1]
    shapes = [[turn([(y, x) for x, y in r]) for r in z["rings"]] for z in Z]
    D = osiedla()
    people = collections.Counter(str(p["zone"]) for p in d["people"])
    # residents outside the city: the survey's own weights, which stand for
    # everyone aged 6 and more; the city's list gives the share of the rest
    est = collections.Counter()
    for p in d["people"]:
        est[str(p["zone"])] += float(p["w"])
    listed = [z for z in pop if z in est and len(z) < 4]
    grow = sum(pop[z] for z in listed) / sum(est[z] for z in listed)
    zones, member = [], collections.defaultdict(list)
    for i, z in enumerate(Z):
        zid = str(z["id"])
        city = len(zid) < 4
        big = max(shapes[i], key=lambda r: middle(r)[1])
        c, area = middle(big)
        # the district most of the zone lies in
        ys, xs = [p[0] for p in big], [p[1] for p in big]
        votes = collections.Counter()
        for a in range(1, 8):
            for b in range(1, 8):
                la = min(ys) + (max(ys) - min(ys)) * a / 8
                lo = min(xs) + (max(xs) - min(xs)) * b / 8
                if city and inside(la, lo, shapes[i]):
                    votes.update(n for n, rings in D.items() if inside(la, lo, rings))
        names.setdefault(zid, gmina.get(zid[:-3], zid) + " - " + zid)
        where = votes.most_common(1)[0][0] if votes else names[zid].split(" - ")[0]
        dist = math.hypot((c[0] - CENTRE[0]) * 111320, (c[1] - CENTRE[1]) * 111320 * KM_LON)
        zones.append({"id": zid, "name": names.get(zid, zid),
                      "c": [round(c[0], 5), round(c[1], 5)],
                      "pop": pop.get(zid) if zid in pop else round(est[zid] * grow) or None,
                      "popEst": int(zid not in pop),
                      # people the trips stand for: the base of every rate
                      "w": round(est[zid]), "jobs": z["L_mp"], "firms": z["L_pg"],
                      "n": people.get(zid, 0), "km2": round(area * 111.32 ** 2 * KM_LON, 3),
                      "core": int(dist <= CORE_M and city), "city": int(city)})
        member[where].append(i)
    simple = simplify(shapes, 0.00012)
    districts = []
    for where, idx in sorted(member.items(), key=lambda kv: (not zones[kv[1][0]]["city"], kv[0])):
        # drawn from the simplified zones, so the two levels share their borders
        for i in idx:
            zones[i]["d"] = len(districts)
        districts.append({"name": where, "city": zones[idx[0]]["city"],
                          "g": code(dissolve([simple[i] for i in idx]))})
    for z, s in zip(zones, simple):
        z["g"] = code(s)
    known = {z["id"] for z in zones}
    outside = {}
    for t in d["trips"]:
        for c, g in ((str(t["from"]), t.get("gmina0")), (str(t["to"]), t.get("gmina1"))):
            if c not in known:
                outside.setdefault(c, str(g or "poza obszarem").title())
    out = [{"id": c, "name": n} for c, n in sorted(outside.items(), key=lambda kv: kv[1])]
    write("zones.json", {"zones": zones, "districts": districts, "outside": out, "core": CORE_M})
    return zones, out, shapes


# ----------------------------------------------------------------------- trips
MODES = ["pieszo", "rower", "hulajnoga / UTO", "samochód — kierowca", "samochód — pasażer",
         "taxi", "motocykl", "tramwaj", "autobus", "pociąg", "KZ z przesiadką", "inne"]


def mode_of(t):
    m = t.get("mode1")
    if m == "samochodem osobowym":
        return 4 if "pasażer" in str(t.get("leg1")) else 3
    if m == "autobusem/tramwajem":
        return 7 if t.get("mode3") == "tramwajem" else 8
    return {"pieszo": 0, "rowerem": 1, "hulajnogą/hulajnogą elektryczną/UTO": 2,
            "taxi/uberem/boltem": 5, "motocyklem/skuterem/motorowerem": 6, "pociągiem": 9,
            "komunikacją zbiorową z przesiadkami": 10}.get(m, 11)


ACTS = ["dom", "praca", "szkoła", "uczelnia", "zakupy i usługi", "centrum handlowe",
        "odwożenie / odprowadzanie", "odwiedziny", "rozrywka, wypoczynek", "zdrowie",
        "sprawy służbowe, urząd", "inne"]
ACT_OF = (("dom", 0), ("praca", 1), ("szkoła", 2), ("wyższa", 3), ("miejsce zakupów", 4),
          ("centrum handlowe", 5), ("miejsce podwoż", 6), ("miejsce wizyty", 7),
          ("miejsce rozrywki", 8), ("przychodnia", 9), ("miejsce załatwiania", 10), ("urząd", 10))


def act_of(v):
    v = str(v or "")
    return next((i for k, i in ACT_OF if v.startswith(k)), 11)


PARK = ["przy ulicy", "parking prywatny, firmowy", "bezpłatny parking ogólnodostępny",
        "wnętrze podwórzowe", "parking centrum handlowego", "garaż",
        "parking w strefie płatnego parkowania", "parking strzeżony (płatny)",
        "parking Park&Ride", "w innym miejscu"]
WHY = ["większa wygoda podróży", "krótszy czas podróży", "niższy koszt podróży", "przewóz rzeczy",
       "podwożenie dzieci lub innych osób", "brak możliwości dojazdu do celu inaczej niż samochodem",
       "brak odpowiedniej oferty komunikacji zbiorowej", "inny powód"]
AGES = ["6–15", "16–24", "25–44", "45–60/65", "60/65+"]
AGE = {"6-15 lat": 0, "16-19 lat": 1, "20-24 lata": 1, "25-44 lata": 2,
       "45-60 lat (K) i 45-65 lat (M)": 3, "pow. 60 lat (K) i pow. 65 lat (M)": 4}
JOBS = ["pracujący poza domem", "pracujący zdalnie lub hybrydowo", "uczeń", "student",
        "emeryt/rencista", "pozostali"]


def minutes(v):
    m = re.match(r"(?:(\d+) days?, )?(\d+):(\d+)", str(v or ""))
    if m:
        return int(m.group(1) or 0) * 1440 + int(m.group(2)) * 60 + int(m.group(3))
    n = diary.num(v)
    return None if n is None else round(n)


def columns(rows, keys):
    rows = sorted(rows, key=lambda r: [(-1 if x is None else x) for x in r])
    return {k: [r[i] for r in rows] for i, k in enumerate(keys)}


def stage_trips(d, zones, outside, spots, ends):
    at = {z["id"]: i for i, z in enumerate([*zones, *outside])}
    P = d["people"]
    # the reason for driving was asked once a person, not once a trip
    why = {}
    for t in d["trips"]:
        if t.get("whyCar1"):
            why[t["person"]] = [t.get("whyCar1"), t.get("whyCar2")]
    reason = lambda v: WHY.index(v) if v in WHY else len(WHY) - 1
    rows = []
    for t, end in zip(d["trips"], ends):
        p = P[t["person"]]
        m = mode_of(t)
        km, dur = diary.num(t.get("km")), minutes(t.get("min"))
        car = m == 3
        y = why.get(t["person"]) if car else None
        rows.append((
            at[str(t["from"])], at[str(t["to"])],
            m, act_of(t.get("act0")), act_of(t.get("act1")),
            int(t["start"]) % 24 if t.get("start") is not None else None,
            None if dur is None else min(240, 5 * round(dur / 5)),
            None if km is None else round(km, 1),
            int(diary.num(t.get("inCar")) or 0) if car else 0,
            PARK.index(t["parked"]) if car and t.get("parked") in PARK else -1,
            {"1 przesiadka": 1, "2 przesiadki": 2}.get(t.get("changes"), 0),
            AGE[p["age"]], JOBS.index(p["job"]),
            0 if p["cars"].startswith("brak") else min(3, int(p["cars"][0])),
            int(p["pass"] == "tak"), int(p["licence"] == "posiada"),
            int(p["area"] == "Wrocław"),
            reason(y[0]) if y else -1,
            # comfort, time or cost only
            int(bool(y) and all(v in (None, "", *WHY[:3]) for v in y)),
            round(float(p["w"])), *end,
        ))
    cols = columns(rows, ["f", "t", "m", "a0", "a1", "h", "d", "km", "o", "pk", "x", "ag", "jb",
                          "hc", "ps", "lc", "wr", "y", "sf", "w", "pf", "pt"])
    write("trips.json", {
        "n": len(rows), "modes": MODES, "acts": ACTS, "park": PARK, "why": WHY, "ages": AGES,
        "jobs": JOBS, "cols": cols,
        "meta": {"people": len(P), "wro": sum(p["area"] == "Wrocław" for p in P),
                 "expanded": round(sum(float(P[t["person"]]["w"]) for t in d["trips"]))},
    })


# ------------------------------------------------------------------------ days
# dom, praca, nauka, zakupy, odwożenie, inne
ACT6 = [0, 1, 2, 2, 3, 3, 4, 5, 5, 5, 5, 5]
MODE4 = [3, 2, 2, 0, 0, 4, 4, 1, 1, 1, 1, 4]      # car, public transport, bike, on foot, other


def stage_days(d, zones):
    """One row a person who went out: weight, the district of each stop in turn,
    what it was for, and how and when they got to the next."""
    dist = {z["id"]: z["d"] for z in zones}
    by = collections.defaultdict(list)
    for t in d["trips"]:
        by[t["person"]].append(t)
    rows = []
    for person, ts in by.items():
        ts.sort(key=lambda t: t["n"] or 0)
        stops = [ts[0]["from"], *(t["to"] for t in ts)]
        acts = [act_of(ts[0].get("act0")), *(act_of(t.get("act1")) for t in ts)]
        rows.append((round(float(d["people"][person]["w"])),
                     [dist.get(str(s), -1) for s in stops], [ACT6[a] for a in acts],
                     [MODE4[mode_of(t)] for t in ts],
                     [int(t["start"]) % 24 if t.get("start") is not None else -1 for t in ts]))
    rows.sort(key=lambda r: (r[1], r[2], r[3], r[4]))
    write("days.json", {"acts": ["dom", "praca", "nauka", "zakupy", "odwożenie", "inne"],
                        "modes": ["samochód", "transport zbiorowy", "rower", "pieszo", "inne"],
                        "rows": rows})


# --------------------------------------------------------------------- freight
CLASSES = ["poj. poniżej 3,5 tony: Kurier", "poj. poniżej 3,5 tony: Handel",
           "poj. poniżej 3,5 tony: Usługi", "poj. 3,5 - 9 ton", "poj. 9 - 12 ton",
           "poj. 12 - 18 ton", "poj. >18 ton"]
PLACES = ["centrum logistyczne", "MŚP", "przemysł", "handel", "magazyn", "woh"]


def stage_freight(zones):
    at = {z["id"]: i for i, z in enumerate(zones)}
    out, names, rows = {}, {}, []
    place = lambda v: PLACES.index(str(v).replace("przemysl", "przemysł"))
    for r in sheet(("10.3",), "Przewozy towarów baza danych", 4):
        if r[0] is None or r[29] not in CLASSES:
            continue
        ends = []
        for c, n in ((str(r[5]), r[6]), (str(r[12]), r[13])):
            if c not in at:
                out.setdefault(c, len(zones) + len(out))
                names[c] = str(n or c).strip()
            ends.append(at.get(c, out.get(c)))
        h = re.match(r"(\d+)", str(r[3] or ""))
        rows.append((ends[0], ends[1], CLASSES.index(r[29]), place(r[7]), place(r[14]),
                     int(h.group(1)) if h else None))
    write("freight.json", {
        "n": len(rows),
        "classes": [c.replace("poj. poniżej 3,5 tony: ", "do 3,5 t — ").replace("poj. ", "")
                    for c in CLASSES],
        "places": ["centrum logistyczne", "mała / średnia firma", "przemysł", "handel", "magazyn",
                   "wielki obiekt handlowy"],
        "outside": [{"id": c, "name": names[c]} for c in out],
        "cols": columns(rows, ["f", "t", "m", "a0", "a1", "h"]),
    })


# --------------------------------------------------------------------- answers
SCALE = ["to bardzo dobry pomysł", "to raczej dobry pomysł", "to ani dobry, ani zły pomysł",
         "to raczej zły pomysł", "to bardzo zły pomysł", "nie wiem nie mam zdania"]
SCALE_SHORT = ["bardzo dobry", "raczej dobry", "ani dobry, ani zły", "raczej zły", "bardzo zły",
               "nie wiem"]
GRADE = ["bardzo dobrze", "raczej dobrze", "ani dobrze, ani źle", "raczej źle", "bardzo źle",
         "nie mam zadania"]
GRADE_SHORT = [*GRADE[:5], "nie mam zdania"]


def questions(d):
    """The questions, each with f(person): None when it was not put to them,
    else the options they chose. `good` are the options a map starts on."""
    Q = []

    def add(key, group, label, options, f, good=(), multi=0, full=None):
        Q.append({"key": key, "group": group, "label": label, "options": list(options),
                  "good": list(good), "multi": multi, "full": full, "f": f,
                  # facts do not depend on who asks; what looks like it is the
                  # interviewer's territory
                  "opinion": int(G.startswith(("Opinie", "Co utrudnia", "Dlaczego", "Oceny")) and key != "home")})

    def one(key, group, label, src, options, short=None, good=(), get=None):
        at = {o: i for i, o in enumerate(options)}
        get = get or (lambda p: p["ans"].get(src))
        add(key, group, label, short or options,
            lambda p: [at[get(p)]] if get(p) in at else None, good,
            full=d["questions"].get(src))

    def several(key, group, label, pre):
        ks = sorted((k for k in d["questions"] if re.match(pre + r"\d+$", k)),
                    key=lambda k: int(k.split("_")[1]))
        text = [d["questions"][k] for k in ks]
        add(key, group, label, [re.split(r"\? *", t)[-1].strip() for t in text],
            lambda p: [i for i, k in enumerate(ks) if p["ans"].get(k) == "tak"]
            if any(k in p["ans"] for k in ks) else None,
            multi=1, full=text[0].split("?")[0] + "?")

    def reasons(key, group, label, pre):
        ks = [k for k in d["questions"] if re.match(pre, k)]
        seen = collections.Counter(p["ans"][k] for p in d["people"] for k in ks if k in p["ans"])
        opts = [o for o, n in seen.most_common() if n >= 25 and not o.startswith("inny")]
        at = {o: i for i, o in enumerate(opts)}
        add(key, group, label, opts,
            lambda p: sorted({at[p["ans"][k]] for k in ks if p["ans"].get(k) in at})
            if any(k in p["ans"] for k in ks) else None, multi=1)

    G = "Opinie o zmianach w mieście"
    one("tram", G, "Priorytet dla tramwajów i autobusów", "F2", SCALE, SCALE_SHORT, (0, 1))
    one("bike", G, "Drogi rowerowe kosztem jezdni lub chodnika", "F3", SCALE, SCALE_SHORT, (0, 1))
    one("cars", G, "Jakie samochody powinny wjeżdżać do centrum", "F1",
        ["żadne", "tylko samochody z silnikami bezemisyjnymi lub niskoemisyjnymi",
         "samochody z silnikami spalinowymi, młodsze niż 20-letnie i samochody z silnikami "
         "bezemisyjnymi lub niskoemisyjnymi", "wszystkie", "nie wiem, nie mam zdania"],
        ["żadne", "tylko bez- i niskoemisyjne", "także spalinowe, młodsze niż 20 lat", "wszystkie",
         "nie wiem"], (0, 1, 2))
    G = "Co utrudnia poruszanie się"
    several("u1", G, "Pieszo", "U1_")
    several("u2", G, "Komunikacją zbiorową", "U2_")
    several("u3", G, "Rowerem, hulajnogą", "U3_")
    G = "Dlaczego tak, a nie inaczej"
    reasons("zcar", G, "Dlaczego samochodem (kierowcy)", r"Z2_2x")
    reasons("zpt", G, "Dlaczego komunikacją zbiorową", r"Z3_\d+x")
    reasons("zwalk", G, "Dlaczego pieszo", r"Z1x")
    reasons("zbike", G, "Dlaczego rowerem lub hulajnogą", r"Z4_\d+x")
    reasons("home", G, "Dlaczego bez wychodzenia z domu", r"X2$")
    G = "Na co dzień"
    one("usual", G, "Najczęstszy środek transportu", "K1",
        ["samochodem osobowym", "transportem zbiorowym", "pieszo", "rowerem|hulajnogą|UTO"],
        ["samochód", "transport zbiorowy", "pieszo", "rower, hulajnoga, UTO"])
    one("chg", G, "W ostatnich 3 latach zmienił(a) środek transportu", "O16_1", ["tak", "nie"])
    one("hol", G, "W wakacje podróżuje inaczej lub rzadziej", None, ["tak", "nie"],
        get=lambda p: {"tak": "nie", "nie": "tak"}.get(p["ans"].get("O15_3")))
    one("cars0", G, "Samochody w gospodarstwie", None,
        ["brak samochodów", "1 samochód", "2 samochody", "3  lub więcej samochodów"],
        ["brak", "1", "2", "3 lub więcej"], get=lambda p: p["cars"])
    one("bikes0", G, "Rowery w gospodarstwie", None,
        ["brak rowerów", "1 rower", "2 rowery", "3 rowery", "4 lub więcej rowerów"],
        ["brak", "1", "2", "3", "4 lub więcej"], get=lambda p: p["bikes"])
    one("pass", G, "Bilet okresowy", None, ["tak", "nie"], get=lambda p: p["pass"])
    one("lic", G, "Prawo jazdy (20 lat i więcej)", None, ["posiada", "nie posiada"], ["tak", "nie"],
        get=lambda p: None if p["age"] in ("6-15 lat", "16-19 lat") else p["licence"])
    one("out", G, "Wychodził(a) z domu poprzedniego dnia", None, ["tak", "nie"],
        get=lambda p: p["out"])
    G = "Oceny komunikacji zbiorowej (pasażerowie)"
    for k, lab in (("K3a", "Wygoda jazdy autobusami"), ("K3b", "Wygoda jazdy tramwajami"),
                   ("K3c", "Czystość w pojazdach"), ("K3d", "Temperatura w pojazdach"),
                   ("K3e", "Zatłoczenie w pojazdach"), ("K4a", "Informacja wewnątrz pojazdów"),
                   ("K4b", "Informacja na zewnątrz pojazdów"),
                   ("K4c", "Informacja na przystankach")):
        one(k.lower(), G, lab, k, GRADE, GRADE_SHORT, (0, 1))
    for k, lab in (("K6", "Punktualność autobusów"), ("K7", "Punktualność tramwajów")):
        one(k.lower(), G, lab, k,
            ["zawsze", "prawie zawsze", "prawie nigdy", "nigdy", "trudno powiedzie"],
            ["zawsze", "prawie zawsze", "prawie nigdy", "nigdy", "trudno powiedzieć"], (0, 1))
    return Q


GROUPS = [
    ("all", "wszyscy", lambda p: True),
    ("car", "na co dzień samochodem", lambda p: p["usual"] == "samochodem osobowym"),
    ("pt", "na co dzień transportem zbiorowym", lambda p: p["usual"] == "transportem zbiorowym"),
    ("act", "na co dzień pieszo lub rowerem",
     lambda p: p["usual"] in ("pieszo", "rowerem|hulajnogą|UTO")),
    ("young", "16–24 lata", lambda p: p["age"] in ("16-19 lat", "20-24 lata")),
    ("mid", "25–60/65 lat", lambda p: p["age"].startswith(("25", "45"))),
    ("old", "powyżej 60/65 lat", lambda p: p["age"].startswith("pow")),
    ("nocar", "bez samochodu w gospodarstwie", lambda p: p["cars"].startswith("brak")),
]


def icc(y, key):
    """Share of the variance that lies between groups (one-way ANOVA)."""
    import numpy as np
    k = key.max() + 1
    n = np.bincount(key, minlength=k).astype(float)
    m = np.bincount(key, y, k) / np.maximum(n, 1)
    used = n > 0
    if used.sum() < 3 or len(y) <= used.sum():
        return 0.0
    msb = (n * (m - y.mean()) ** 2)[used].sum() / (used.sum() - 1)
    msw = ((y - m[key]) ** 2).sum() / (len(y) - used.sum())
    n0 = (len(y) - (n ** 2).sum() / len(y)) / (used.sum() - 1)
    return float(max(0.0, (msb - msw) / (msb + (n0 - 1) * msw))) if msb > 0 else 0.0


def without_asker(y, asker, place, rounds=25):
    """Answers less what the interviewer adds to them.

    People answer some interviewers differently than others, far more than they
    do in one district than in the next, and an interviewer works in few
    districts. Two sets of effects, interviewers' and districts', each shrunk
    by how much of it could be chance, are fitted in turn until they settle;
    the interviewers' is taken off."""
    import numpy as np
    mu = y.mean()
    u, v = np.zeros(asker.max() + 1), np.zeros(place.max() + 1)
    na, np_ = np.bincount(asker, minlength=len(u)), np.bincount(place, minlength=len(v))
    for _ in range(rounds):
        for key, n, e, other in ((place, np_, v, u[asker]), (asker, na, u, v[place])):
            r = y - mu - other
            rho = icc(r, key)
            lam = (1 - rho) / rho if rho > 1e-4 else 1e6
            e[:] = np.bincount(key, r, len(e)) / (n + lam)
    return y - u[asker]


def stage_answers(d, zones):
    import numpy as np
    at = {z["id"]: i for i, z in enumerate(zones)}
    P = d["people"]
    zi = np.array([at.get(str(p["zone"]), -1) for p in P])
    di = np.array([zones[z]["d"] if z >= 0 else -1 for z in zi])
    w = np.array([float(p["w"]) for p in P])
    asker, walk = (np.array([p[k] for p in P]) for k in ("asker", "round"))
    wro = np.array([p["area"] == "Wrocław" for p in P])
    tested = {g: np.array([bool(test(p)) for p in P]) for g, _, test in GROUPS}
    out = []
    for q in questions(d):
        got = [q["f"](p) for p in P]
        asked = np.array([x is not None for x in got]) & (zi >= 0)
        k = len(q["options"])
        Y = np.zeros((len(P), k))
        for i, x in enumerate(got):
            for o in x or ():
                Y[i, o] = 1
        idx = np.flatnonzero(asked)
        _, ai = np.unique(asker[idx], return_inverse=True)
        _, wi = np.unique(walk[idx], return_inverse=True)
        A = Y.copy()
        rho = []
        sets = [[o] for o in range(k)] + ([q["good"]] if len(q["good"]) > 1 else [])
        for s in sets:
            y = Y[idx][:, s].sum(axis=1)
            a = without_asker(y, ai, di[idx])
            if len(s) == 1 and q["opinion"]:
                A[idx, s[0]] = a
            # between interviewers; then between rounds, the interviewer taken off
            rho.append([round(icc(y, ai), 3), round(icc(a, wi), 3)])
        tabs = {}
        for g, _, _ in GROUPS:
            me = asked & tested[g]
            if me.sum() < 30:
                continue
            tabs[g] = {}
            for lv, keys in (("z", zi), ("d", di), ("a", None)):
                rows = {}
                groups = ([("wro", wro), ("out", ~wro), ("all", np.ones(len(P), bool))] if lv == "a"
                          else [(int(x), keys == x) for x in np.unique(keys[me])])
                for name, where in groups:
                    i = np.flatnonzero(me & where)
                    if len(i) < MIN_N:
                        continue
                    ww = w[i]
                    if lv == "z" and g != "all":
                        continue
                    raw = ww @ Y[i] / ww.sum()
                    # how bunched: people per interviewer, and per round, as a
                    # random one of them sees it
                    bunch = lambda key: (np.bincount(np.unique(key[i], return_inverse=True)[1]) ** 2).sum() / len(i)
                    rows[name] = [len(i), round(bunch(asker), 1), round(bunch(walk), 1),
                                  [round(1000 * x) for x in raw]]
                    if lv != "a" and q["opinion"]:
                        # shares again: none below nothing, adding up as they did
                        fixed = np.maximum(0, ww @ A[i] / ww.sum())
                        if not q["multi"] and fixed.sum() > 0:
                            fixed *= raw.sum() / fixed.sum()
                        rows[name].append([round(1000 * x) for x in np.minimum(1, fixed)])
                tabs[g][lv] = rows
        out.append({**{x: v for x, v in q.items() if x != "f"}, "rho": rho[:k],
                    "rhoGood": rho[k] if len(rho) > k else None, "tab": tabs})
    write("answers.json", {"groups": [{"key": g, "label": lab} for g, lab, _ in GROUPS],
                           "questions": out, "minN": MIN_N})


def main():
    d = diary.load()
    zones, outside, shapes = stage_zones(d)
    spots, ends = places.build(d, zones, shapes, inside)
    write("places.json", {"spots": spots, "minWho": places.MIN_WHO})
    stage_trips(d, zones, outside, spots, ends)
    stage_days(d, zones)
    stage_freight(zones)
    stage_answers(d, zones)


if __name__ == "__main__":
    main()
