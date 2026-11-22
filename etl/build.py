# -*- coding: utf-8 -*-
"""Turn the raw KBR Wroclaw 2024 deliverables into compact JSON for the viewer.

Run:  python etl/build.py [stage ...]
Stages: points road pt bike ped rail survey  (default: all)
"""
import json, os, re, sys, math, collections, warnings, datetime
warnings.filterwarnings("ignore")
import openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode

OVERRIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "overrides.json")


def load_overrides():
    if os.path.exists(OVERRIDES):
        return {k: v for k, v in json.load(open(OVERRIDES, encoding="utf8")).items() if not k.startswith("_")}
    return {}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(OUT, exist_ok=True)

F33 = os.path.join(DATA, "Załącznik 3.3 wyniki pomiarów ruchu drogowego.xlsx")
F34 = os.path.join(DATA, "Załącznik 3.4 wyniki pomiarów natężenia ruchu rowerowego.xlsx")
F35 = os.path.join(DATA, "Załącznik 3.5 wyniki pomiarów natężenia ruchu pieszego.xlsx")
F61 = os.path.join(DATA, "Załącznik 6.1 napełnienie pojazdów Wrocław matryca do przeliczania liczby pasażerów.xlsx")
F63 = os.path.join(DATA, "Załącznik 6.3 wykaz punktów pomiarowych.docx")
F64 = os.path.join(DATA, "Załącznik 6.4 wyniki pomiarów potoków pasażerskich w autobusach miejskich, podmiejskich.xlsx")
F65 = os.path.join(DATA, "Załącznik 6.5 podróże w punktach przypisanych do regionów i osiedli.xlsx")
F66 = os.path.join(DATA, "Załącznik 6.6 podróże w punktach kordonu przypisanych do regionów i osiedli.xlsx")
F71 = os.path.join(DATA, "Załącznik 7.1 wyniki pomiarów wielkości potoków pasażerskich w pociągach.xlsx")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def sheet(path, name, skip=0):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[name]
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if i >= skip:
            yield r
    wb.close()


def txt(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip()


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def hour_of(s):
    m = re.match(r"(\d{1,2}):", txt(s))
    return int(m.group(1)) if m else None


def quarter_of(s):
    m = re.match(r"(\d{1,2}):(\d{2})", txt(s))
    return int(m.group(1)) * 4 + int(m.group(2)) // 15 if m else None


def write(name, obj):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    log("  -> %s  %.1f MB" % (name, os.path.getsize(p) / 1e6))


def dstr(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return txt(v)


# --------------------------------------------------------------------- catalogue
AREA_LABEL = {
    "AOW": "Autostradowa Obwodnica Wrocławia",
    "Kordon obszaru": "Kordon obszaru",
    "Kordon Wrocławia": "Kordon Wrocławia",
    "Ring 1": "Ring 1", "Ring 2": "Ring 2", "Ring 3": "Ring 3",
    "Poza ringami": "Poza ringami",
}

VEH_CATS = ["c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
            "a1", "a2", "b1", "b2"]
OFF_CATS = ["a3", "a4", "b3", "b4"]


def read_catalogue():
    """244 road cross-sections with exact coordinates - the spatial backbone."""
    rows = []
    for r in sheet(F33, "Wykaz - przekroje pomiarowe", 4):
        if not r[1]:
            continue
        lon, lat = num(r[9]), num(r[10])
        rows.append({
            "point": txt(r[0]), "id": txt(r[1]), "area": txt(r[2]),
            "name": txt(r[3]), "segment": txt(r[4]),
            "in1": txt(r[5]), "in2": txt(r[6]), "where": txt(r[7]),
            "date": dstr(r[8]), "lat": lat, "lon": lon,
        })
    # measurement hours come from the cycling workbook's copy of the same list
    hrs = {}
    for r in sheet(F34, "Wykaz przekroje drogowe ", 4):
        if r[1]:
            hrs[txt(r[1])] = txt(r[9])
    for r in rows:
        r["hours"] = hrs.get(r["id"], "")
    return rows


# ------------------------------------------------------------------ road traffic
def stage_road(cat):
    """3.3: vehicle counts on the carriageway + on adjacent bike/foot infra."""
    ci = {c: i for i, c in enumerate(VEH_CATS)}
    oi = {c: i for i, c in enumerate(OFF_CATS)}
    sec = {}

    def slot(sid, dirs, key, size):
        s = sec.setdefault(sid, {})
        d = s.setdefault(dirs, {})
        if key not in d:
            d[key] = [0] * size
        return d[key]

    log("reading 'DANE - na jezdni' (431k rows, ~40s)...")
    n = 0
    for r in sheet(F33, "DANE - na jezdni", 4):
        sid = txt(r[1])
        if not sid:
            continue
        v = num(r[12])
        if not v:
            continue
        c = ci.get(txt(r[8]))
        if c is None:
            continue
        h, q = hour_of(r[7]), quarter_of(r[6])
        d = txt(r[10]) + ">" + txt(r[11])
        s = sec.setdefault(sid, {"dirs": {}})
        dd = s["dirs"].setdefault(d, {"h": [[0] * len(VEH_CATS) for _ in range(24)],
                                      "q": [0] * 96, "qm": [0] * 96})
        if h is not None:
            dd["h"][h][c] += v
        if q is not None:
            dd["q"][q] += v
            if r[9] == 1 or txt(r[8]) in ("c", "d", "e", "f", "g", "h", "i", "j", "k", "l"):
                dd["qm"][q] += v
        n += 1
    log("  %d non-zero rows" % n)

    log("reading 'DANE - poza jezdnią' (63k rows)...")
    for r in sheet(F33, "DANE - poza jezdnią", 4):
        sid = txt(r[1])
        v = num(r[12])
        if not sid or not v:
            continue
        c = oi.get(txt(r[9]))
        if c is None:
            continue
        h = hour_of(r[7])
        d = txt(r[10]) + ">" + txt(r[11])
        s = sec.setdefault(sid, {"dirs": {}})
        off = s.setdefault("off", {})
        dd = off.setdefault(d, [[0] * len(OFF_CATS) for _ in range(24)])
        if h is not None:
            dd[h][c] += v

    byid = {c["id"]: c for c in cat}
    out = {}
    for sid, s in sec.items():
        e = {"dirs": {}}
        for d, dd in s.get("dirs", {}).items():
            e["dirs"][d] = {"h": dd["h"], "q": dd["q"], "qm": dd["qm"]}
        if "off" in s:
            e["off"] = s["off"]
        meta = byid.get(sid)
        if meta:
            e["date"] = meta["date"]
        out[sid] = e
    write("road.json", {"cats": VEH_CATS, "offCats": OFF_CATS, "sections": out})
    return out


# ------------------------------------------------------------- bicycles (RR_xx)
BIKE_PLACE = {1: "jezdnia (pas samochodowy)", 2: "jezdnia (pas rowerowy)",
              3: "droga dla pieszych i rowerów", 4: "droga dla rowerów",
              5: "chodnik"}
BIKE_MODE = {1: "rower prywatny", 2: "rower miejski", 3: "rower cargo",
             4: "UTO / hulajnoga"}
BIKE_USER = {1: "dorosły samodzielnie", 2: "dziecko samodzielnie",
             3: "dorosły z dzieckiem w foteliku/przyczepce",
             4: "dziecko na własnym rowerze z dorosłym"}
SEX = {1: "mężczyzna", 2: "kobieta"}


def stage_bike(idx):
    """3.4: dedicated cycle counts, one source row per passing cyclist."""
    ov = load_overrides()
    meta = {}
    for r in sheet(F34, "Wykaz - przekroje rowerowe", 4):
        if not r[1]:
            continue
        pid = txt(r[2]) or txt(r[1])
        m = meta.setdefault(pid, {"id": pid, "name": txt(r[5]), "segment": txt(r[6]),
                                  "where": [], "date": dstr(r[8]), "hours": txt(r[9]),
                                  "in1": txt(r[3]), "in2": txt(r[4])})
        if txt(r[7]):
            m["where"].append(txt(r[7]))

    pts = {}
    for r in sheet(F34, "DANE - pomiary rowerowe", 5):
        pid = txt(r[1])
        if not pid:
            continue
        p = pts.setdefault(pid, {"q": collections.Counter(), "h": collections.Counter(),
                                 "dir": collections.Counter(), "place": collections.Counter(),
                                 "sex": collections.Counter(), "mode": collections.Counter(),
                                 "user": collections.Counter(), "helmet": collections.Counter(),
                                 "hdir": collections.Counter(), "n": 0})
        q, h, d = quarter_of(r[6]), hour_of(r[7]), txt(r[8])
        p["n"] += 1
        if q is not None:
            p["q"][q] += 1
        if h is not None:
            p["h"][h] += 1
            p["hdir"][(h, d)] += 1
        p["dir"][d] += 1
        p["place"][r[9]] += 1
        p["sex"][r[10]] += 1
        p["mode"][r[11]] += 1
        p["user"][r[12]] += 1
        p["helmet"][r[14]] += 1

    out = []
    for pid, p in sorted(pts.items()):
        m = meta.get(pid, {"id": pid, "name": pid, "segment": "", "where": [],
                           "date": "", "hours": "", "in1": "", "in2": ""})
        g = geocode.resolve(idx, m["name"], m["segment"], hint=m["name"] + ", Wrocław",
                            overrides=ov, key=pid)
        dirs = sorted(p["dir"])
        out.append({
            "id": pid, "name": m["name"], "segment": m["segment"],
            "where": m["where"], "date": m["date"], "hours": m["hours"],
            "lat": g[0] if g else None, "lon": g[1] if g else None,
            "geo": g[2] if g else "unresolved",
            "total": p["n"],
            "dirs": dirs,
            "byHour": [p["h"].get(h, 0) for h in range(24)],
            "byHourDir": {d: [p["hdir"].get((h, d), 0) for h in range(24)] for d in dirs},
            "byQuarter": [p["q"].get(i, 0) for i in range(96)],
            "byDir": {d: p["dir"][d] for d in dirs},
            "byPlace": {BIKE_PLACE.get(k, str(k)): v for k, v in p["place"].items() if k},
            "bySex": {SEX.get(k, str(k)): v for k, v in p["sex"].items() if k},
            "byMode": {BIKE_MODE.get(k, str(k)): v for k, v in p["mode"].items() if k},
            "byUser": {BIKE_USER.get(k, str(k)): v for k, v in p["user"].items() if k},
            "helmet": {"tak": p["helmet"].get(1, 0), "nie": p["helmet"].get(2, 0)},
        })
    write("bike.json", out)
    return out


# ------------------------------------------------------------ pedestrians (PP_xx)
PED_MOB = {1: "osoba sprawna ruchowo", 2: "inne"}
# Codes as defined in the legend of 3.5, sheet "baza", row 2.
PED_MOB2 = {1: "osoba starsza (60+) z problemami z poruszaniem się",
            2: "osoba z bagażem", 3: "osoba o kulach, z laską lub protezą",
            4: "osoba z wózkiem dziecięcym", 5: "osoba na wózku inwalidzkim",
            6: "osoba niewidoma", 7: "„małe kółka” (rolki, hulajnoga, rowerek)",
            8: "inne"}


def stage_ped(idx):
    """3.5: pedestrian counts in the core, one source row per passing pedestrian."""
    ov = load_overrides()
    meta = {}
    for r in sheet(F35, "Lista punktów pomiarowych", 4):
        if r[1]:
            meta[txt(r[1])] = {"name": txt(r[4]), "segment": txt(r[5]),
                               "in1": txt(r[2]), "in2": txt(r[3])}
    pts = {}
    for r in sheet(F35, "baza", 2):
        pid = txt(r[0])
        if not pid or pid == "NUMER PRZEKROJU":
            continue
        p = pts.setdefault(pid, {"loc": txt(r[1]), "seg": txt(r[2]),
                                 "q": collections.Counter(), "h": collections.Counter(),
                                 "hdir": collections.Counter(), "dir": collections.Counter(),
                                 "sex": collections.Counter(), "mob": collections.Counter(),
                                 "mob2": collections.Counter(), "side": collections.Counter(),
                                 "period": collections.Counter(), "n": 0})
        q, h, d = quarter_of(r[5]), hour_of(r[6]), txt(r[7])
        p["n"] += 1
        if q is not None:
            p["q"][q] += 1
        if h is not None:
            p["h"][h] += 1
            p["hdir"][(h, d)] += 1
        p["dir"][d] += 1
        p["sex"][r[8]] += 1
        p["mob"][r[9]] += 1
        if isinstance(r[10], int):
            p["mob2"][r[10]] += 1
        p["side"][txt(r[11])] += 1
        p["period"][txt(r[3])] += 1

    out = []
    for pid, p in sorted(pts.items()):
        m = meta.get(pid, {})
        street = re.sub(r"\s*\(.*", "", m.get("name") or p["loc"])
        g = geocode.resolve(idx, street, m.get("segment") or p["seg"],
                            hint=(m.get("name") or p["loc"]) + ", Wrocław",
                            overrides=ov, key=pid)
        dirs = sorted(x for x in p["dir"] if x)
        out.append({
            "id": pid, "name": m.get("name") or p["loc"], "short": p["loc"],
            "segment": m.get("segment") or p["seg"],
            "lat": g[0] if g else None, "lon": g[1] if g else None,
            "geo": g[2] if g else "unresolved",
            "total": p["n"], "dirs": dirs,
            "byHour": [p["h"].get(h, 0) for h in range(24)],
            "byHourDir": {d: [p["hdir"].get((h, d), 0) for h in range(24)] for d in dirs},
            "byQuarter": [p["q"].get(i, 0) for i in range(96)],
            "byDir": {d: p["dir"][d] for d in dirs},
            "bySex": {SEX.get(k, str(k)): v for k, v in p["sex"].items() if k},
            "byMobility": {PED_MOB.get(k, str(k)): v for k, v in p["mob"].items() if k},
            "byMobility2": {PED_MOB2.get(k, str(k)): v for k, v in p["mob2"].items()},
            "bySide": {k: v for k, v in p["side"].items() if k},
            "byPeriod": {k: v for k, v in p["period"].items() if k},
        })
    write("ped.json", out)
    return out


# ------------------------------------------------- public transport (6.4 / 6.3)
def gtfs_stops():
    """MPK stop poles from the cached city timetable: stop_code -> (lat, lon),
    plus name -> [(lat, lon)]. The code is the pole number 6.4 records for
    every run, so it pins a section to its own pole, not to a stop name
    that several places share."""
    import glob, zipfile, csv, io
    zips = sorted(glob.glob(os.path.join(geocode.CACHE, "gtfs_*.zip")),
                  key=lambda f: int(re.findall(r"(\d+)", os.path.basename(f))[0]))
    if not zips:
        import gtfs
        zips = [gtfs.download()]
    by_code, by_name = {}, collections.defaultdict(list)
    with zipfile.ZipFile(zips[-1]) as z, z.open("stops.txt") as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            ll = (float(r["stop_lat"]), float(r["stop_lon"]))
            if r.get("stop_code"):
                by_code[r["stop_code"].strip()] = ll
            by_name[txt(r["stop_name"]).lower()].append(ll)
    return by_code, by_name


def stage_pt(idx, sidx):
    """6.4: passengers counted on board buses and trams.

    Careful: the point ids here (KW_01, PR_02, R1_03...) are a *different*
    numbering from the road cross-sections that share the prefix - KW_01 is
    "Pracze Odrzanskie" here and "ul. Kamienskiego" there. So place these by
    their own stop poles instead of joining on the id.
    """
    ov = load_overrides()
    by_code, by_name = gtfs_stops()

    def mean(lls):
        return (sum(p[0] for p in lls) / len(lls), sum(p[1] for p in lls) / len(lls))

    def where(sid, s):
        # Own poles first. Stop names repeat across the city ("Bardzka" and
        # "Bardzka (Cmentarz)", hubs with a dozen platforms), and matching by
        # name put some sections kilometres off.
        if sid in ov:
            return tuple(ov[sid]), "manual"
        lls = [by_code[c] for c in s["poles"] if c in by_code]
        if lls:
            return mean(lls), "pole"
        name = s["stop"].most_common(1)[0][0].lower() if s["stop"] else ""
        if by_name.get(name):
            return mean(by_name[name]), "gtfs-name"
        for cand in (s["stop"].most_common(1)[0][0] if s["stop"] else None, s["name"]):
            g = geocode.find_stop(sidx, cand) if cand else None
            if g:
                return g, "stop"
        g = geocode.street_centroid(idx, s["loc"]) if s["loc"] else None
        if g:
            return g, "street"
        return (None, None), "unresolved"

    secs = {}
    for r in sheet(F64, "DANE - potoki pasażerskie", 4):
        if not r[0]:
            continue                                # 31k trailing blank rows
        sid, pt = txt(r[4]), txt(r[3])
        if not sid:
            continue
        s = secs.setdefault(sid, {
            "point": pt, "name": txt(r[6]), "loc": txt(r[7]),
            "osiedle": txt(r[9]), "stop": collections.Counter(), "poles": set(),
            "h": collections.Counter(), "hveh": collections.Counter(),
            "traction": collections.Counter(), "line": collections.Counter(),
            "carrier": collections.Counter(), "dir": collections.Counter(),
            "hdir": collections.Counter(), "hline": collections.Counter(),
            "board": 0, "alight": 0, "exch": 0,
            "pax": 0, "veh": 0, "load": [], "dates": set()})
        h = r[13] if isinstance(r[13], int) else hour_of(r[14])
        pax = num(r[25]) or 0
        s["pax"] += pax
        s["veh"] += 1
        s["dates"].add(txt(r[1]))
        if txt(r[8]):
            s["stop"][txt(r[8])] += 1
        if txt(r[5]):
            s["poles"].add(txt(r[5]))
        tr = txt(r[22]) or "?"
        s["traction"][tr] += 1
        if txt(r[17]):
            s["line"][txt(r[17])] += pax
            if h is not None:
                s["hline"][(h, txt(r[17]))] += pax
        if txt(r[20]):
            s["carrier"][txt(r[20])] += 1
        if txt(r[19]):
            s["dir"][txt(r[19])] += pax
            if h is not None:
                s["hdir"][(h, txt(r[19]))] += pax
        if h is not None:
            s["h"][(h, tr)] += pax
            s["hveh"][(h, tr)] += 1
        u = num(r[26])
        if u is not None:
            s["load"].append(u)
        # boarding/alighting was only surveyed on a subset of the runs
        for col, key in ((28, "board"), (27, "alight"), (29, "exch")):
            v = num(r[col])
            if v is not None:
                s[key] += v

    def hourly(by_hour, totals, top):
        """Passengers per hour for the `top` biggest keys, the rest as "inne",
        so a period's breakdown adds up to its total."""
        keep = [k for k, _ in totals.most_common(top)]
        out = {k: [round(by_hour.get((h, k), 0)) for h in range(24)] for k in keep}
        rest = [round(sum(v for (hh, k), v in by_hour.items() if hh == h and k not in keep))
                for h in range(24)]
        if any(rest):
            out["inne"] = rest
        return out

    out = []
    for sid, s in sorted(secs.items()):
        (lat, lon), how = where(sid, s)
        tract = sorted(s["traction"])
        out.append({
            "id": sid, "point": s["point"], "name": s["name"], "loc": s["loc"],
            "stop": s["stop"].most_common(1)[0][0] if s["stop"] else "",
            "osiedle": s["osiedle"], "lat": lat, "lon": lon, "geo": how,
            "dates": sorted(x for x in s["dates"] if x),
            "pax": round(s["pax"]), "veh": s["veh"],
            "avgLoad": round(sum(s["load"]) / len(s["load"]), 4) if s["load"] else None,
            "byHour": {t: [round(s["h"].get((h, t), 0)) for h in range(24)] for t in tract},
            "vehByHour": {t: [s["hveh"].get((h, t), 0) for h in range(24)] for t in tract},
            "byTraction": dict(s["traction"]),
            "byCarrier": dict(s["carrier"].most_common(8)),
            "byLine": dict(s["line"].most_common(15)),
            "byDir": dict(s["dir"].most_common(10)),
            # per hour, so the panel can split the selected period
            "byHourDir": hourly(s["hdir"], s["dir"], 10),
            "byHourLine": hourly(s["hline"], s["line"], 15),
            "boarded": round(s["board"]) or None,
            "alighted": round(s["alight"]) or None,
        })
    write("pt.json", out)
    return out


# -------------------------------------------------------------- railways (7.1)
def find_station(stations, name):
    g = geocode.find_station(stations, name)
    if g:
        return g
    r = geocode.nominatim('stacja kolejowa %s, Polska' % name)
    return r if r and 50.7 < r[0] < 51.6 and 16.3 < r[1] < 17.7 else None


def stage_rail(stations):
    """7.1: passengers on trains crossing the cordon, grouped into 11 sections."""
    ov = load_overrides()
    rows = []
    for r in sheet(F71, "DANE SUROWE", 4):
        if not r[0]:
            continue
        rows.append({
            "cordon": txt(r[0]), "from": txt(r[1]), "to": txt(r[2]),
            "carrier": txt(r[5]).strip(), "train": txt(r[6]),
            "relation": txt(r[7]), "dep": txt(r[8]), "arr": txt(r[9]),
            "hour": int(txt(r[10])) if txt(r[10]).isdigit() else None,
            "quarter": txt(r[11]), "dir": txt(r[12]), "type": txt(r[13]),
            "pax": num(r[14]) or 0, "load": num(r[15]),
            "date": dstr(r[16]), "seats": num(r[18]),
        })
    coords = {}
    for st in sorted({s for r in rows for s in (r["from"], r["to"])}):
        if st in ov:
            coords[st] = list(ov[st]) + ["manual"]
        else:
            g = find_station(stations, st)
            coords[st] = (list(g) + ["osm"]) if g else [None, None, "unresolved"]

    cordons = {}
    for r in rows:
        c = cordons.setdefault(r["cordon"], {
            "stations": set(), "trains": 0, "pax": collections.Counter(),
            "seats": collections.Counter(), "byHour": collections.Counter(),
            "carriers": collections.Counter(), "dates": set(), "runs": []})
        c["stations"].update([r["from"], r["to"]])
        c["trains"] += 1
        c["pax"][r["dir"]] += r["pax"]
        if r["seats"]:
            c["seats"][r["dir"]] += r["seats"]
        if r["hour"] is not None:
            c["byHour"][(r["hour"], r["dir"])] += r["pax"]
        c["carriers"][r["carrier"]] += 1
        c["dates"].add(r["date"])
        c["runs"].append(r)

    # The marker goes where the line leaves the city: on the shortest
    # city-station -> outside-station hop any run makes, at the boundary.
    # Averaging every station a run touches put 9 of 11 markers out of town.
    border = geocode.city_boundary()

    def place(c):
        hops = []
        for r in c["runs"]:
            a, b = sorted((r["from"], r["to"]), key=lambda n: not n.startswith("Wrocław"))
            if a.startswith("Wrocław") and not b.startswith("Wrocław")                     and coords[a][0] and coords[b][0]:
                hops.append((math.dist(coords[a][:2], coords[b][:2]), a, b))
        if not hops:
            pts = [coords[s] for s in c["stations"] if coords[s][0]]
            if not pts:
                return None, None, "unresolved"
            return (sum(p[0] for p in pts) / len(pts),
                    sum(p[1] for p in pts) / len(pts), "stations")
        _, a, b = min(hops)
        x = geocode.cross_boundary(coords[a][:2], coords[b][:2], border)
        if x:
            return x[0], x[1], "boundary"
        return ((coords[a][0] + coords[b][0]) / 2, (coords[a][1] + coords[b][1]) / 2,
                "midpoint")

    out = []
    for cid, c in sorted(cordons.items(), key=lambda kv: int(kv[0][1:])):
        sts = sorted(c["stations"])
        lat, lon, how = place(c)
        dirs = sorted(c["pax"])
        out.append({
            "id": cid, "stations": sts,
            "stationCoords": {s: coords[s] for s in sts},
            "lat": lat, "lon": lon, "geo": how,
            "trains": c["trains"], "dates": sorted(c["dates"]),
            "pax": {d: round(v) for d, v in c["pax"].items()},
            "seats": {d: round(v) for d, v in c["seats"].items()},
            "byHour": {d: [round(c["byHour"].get((h, d), 0)) for h in range(24)]
                       for d in dirs},
            "carriers": dict(c["carriers"]),
            "runs": sorted(c["runs"], key=lambda r: r["dep"]),
        })
    write("rail.json", out)
    return out


# ------------------------------------------------ household survey sample (shp)
def stage_survey():
    """The two shapefiles: addresses drawn for the household interview sample."""
    import shapefile
    out = []
    for f, city in ((os.path.join(DATA, "KBRWr_2024_proba_Wroclaw_cz1"), True),
                    (os.path.join(DATA, "KBRWr_2024_proba_gminy_cz2"), False)):
        for sr in shapefile.Reader(f, encoding="cp1250").iterShapeRecords():
            if not sr.shape.points:
                continue
            d = sr.record.as_dict()
            lon, lat = sr.shape.points[0]
            out.append({
                "lat": round(lat, 6), "lon": round(lon, 6),
                "zone": str(d.get("rejon_kom_") or d.get("rejon_kom") or ""),
                "gmina": d.get("gmina") or "", "city": city,
                "addr": d.get("pkt_start") or "",
                "n": d.get("Liczbawywi") or None,
            })
    write("survey.json", out)
    return out


# --------------------------------------------------- measurement windows / expansion
# Only the road counts run all day. Passengers, cyclists and pedestrians were
# counted in the peaks only, so their "daily" totals are not comparable with the
# road ones unless they are expanded. The factors below come from the parts of
# the survey that DO cover a long day, and each one records how solid it is.
WINDOWS = {
    "road": list(range(24)),
    "pt": [5, 6, 7, 8, 14, 15, 16, 17],
    "bike": [6, 7, 8, 9, 15, 16, 17, 18],
    "ped": [6, 7, 8, 9, 15, 16, 17, 18],
    "rail": [6, 7, 8, 9, 14, 15, 16, 17, 18],
    # road counts on the study-area cordon (KO_*) ran in the peaks only
    "roadPeak": [6, 7, 8, 9, 15, 16, 17, 18],
}


def _profiles(road, meta_cats):
    """Daily shapes taken from the cross-sections measured over a long day."""
    ci = {c: i for i, c in enumerate(VEH_CATS)}
    motor = [0] * 24
    ptveh = [0] * 24
    nonmotor = [0] * 24
    nfull = 0
    for s in road.values():
        tot = [0] * 24
        for d in s["dirs"].values():
            for h in range(24):
                tot[h] += sum(d["h"][h])
        if all(v > 0 for v in tot):                 # measured round the clock
            nfull += 1
            for d in s["dirs"].values():
                for h in range(24):
                    for c in ("c", "d", "e", "f", "g", "h", "i", "l"):
                        motor[h] += d["h"][h][ci[c]]
                    ptveh[h] += d["h"][h][ci["j"]] + d["h"][h][ci["k"]]
    noff = 0
    for s in road.values():
        if "off" not in s:
            continue
        noff += 1
        for rows in s["off"].values():
            for h in range(24):
                nonmotor[h] += sum(rows[h])
    return motor, ptveh, nonmotor, nfull, noff


def _factor(profile, window):
    w = sum(profile[h] for h in window)
    return round(sum(profile) / w, 3) if w else None


def stage_expansion(road, points):
    motor, ptveh, nonmotor, nfull, noff = _profiles(road, None)
    exp = {
        "road": {
            "factor": 1.0, "basis": "measured",
            "note": "Ruch drogowy liczono przez całą dobę lub 5:00–21:00 — "
                    "wartości dobowe są mierzone, nie szacowane.",
        },
        "roadPeak": {
            "factor": _factor(motor, WINDOWS["roadPeak"]), "basis": "derived",
            "note": "Przekroje na kordonie obszaru (KO) liczono tylko 6–10 "
                    "i 15–19. Współczynnik pochodzi z dobowego rozkładu ruchu "
                    "silnikowego na %d przekrojach mierzonych 24h." % nfull,
        },
        "pt": {
            "factor": _factor(ptveh, WINDOWS["pt"]), "basis": "assumed",
            "note": "Pasażerów liczono tylko w szczytach. Współczynnik pochodzi "
                    "z dobowego rozkładu LICZBY autobusów i tramwajów na %d "
                    "przekrojach mierzonych 24h — zakłada, że napełnienie poza "
                    "szczytem jest takie jak w szczycie, więc zawyża." % nfull,
        },
        "bike": {
            "factor": _factor(nonmotor, WINDOWS["bike"]), "basis": "derived",
            "note": "Rowerzystów liczono tylko w szczytach. Współczynnik "
                    "pochodzi z rzeczywistych całodziennych (5:00–21:00) "
                    "pomiarów ruchu rowerowego na infrastrukturze rowerowej "
                    "przy %d przekrojach drogowych." % noff,
        },
        "rail": {
            "factor": _factor(ptveh, WINDOWS["rail"]), "basis": "assumed",
            "note": "Jak dla autobusów i tramwajów — rozkład dobowy liczby "
                    "kursów, nie pasażerów.",
        },
    }
    exp["ped"] = {
        "factor": exp["bike"]["factor"], "basis": "assumed",
        "note": "Pieszych liczono tylko w szczytach, a w całym KBR nie ma "
                "całodziennego pomiaru pieszych. Użyto rozkładu ruchu "
                "rowerowego jako przybliżenia — piesi w centrum mają płaski "
                "rozkład popołudniowy, więc to raczej zaniża.",
    }
    return {
        "windows": WINDOWS,
        "expansion": exp,
        "profiles": {"motor": motor, "ptVehicles": ptveh, "nonMotor": nonmotor},
        "fullDaySections": nfull, "offCarriagewaySections": noff,
    }


# Persons per car, driver included. The measurement annexes in data/ do not
# carry it; the household-survey annex does: KBR 2024, Zal. 2.2 to Raport II,
# sheet "Podzial zadan przewozowych", table "Srednia liczba osob w samochodzie
# ogolem oraz wedlug motywacji podrozy" - Wroclaw 1.207 over 4396 trips where
# the respondent drove, weekday (Tue-Thu diaries). Recomputed from the survey's
# raw database for trips starting 6-10 and 15-19 it is 1.17 for city residents
# and 1.19 with suburban ones, so 1.2 fits the hours the road counts cover.
#
# The 2018 report's 1.55 is not comparable: it divides people reported in the
# car by all car trips including passengers' own, so a car of three is counted
# up to three times.
CAR_OCCUPANCY = {
    "default": 1.2, "min": 1.0, "max": 2.0,
    "source": "KBR Wrocław 2024, zał. 2.2 do Raportu II (badania ankietowe "
              "w gospodarstwach domowych)",
    # quoted verbatim from the annex, so the setting can cite it
    "table": "Średnia liczba osób w samochodzie ogółem oraz według motywacji podróży",
    "question": "Ile osób (łącznie z Panem|Panią) jechało w samochodzie?",
    "value": "1,207",
    "basis": "Podstawa obliczeń: podróże, w których respondenci byli kierowcami "
             "samochodu.",
    "scope": "Wrocław, ogółem (wszystkie motywacje), 4396 podróży; badanie "
             "BR Sp. z o.o., kwiecień–czerwiec 2024",
    "url": "https://bip.um.wroc.pl/artykul/565/70659/"
           "kompleksowe-badania-ruchu-we-wroclawiu-i-otoczeniu-kbr-2024",
    # "Zalaczniki do Raportu II (cz. 1)" on that page; the annex is inside it
    "file": "https://bip.um.wroc.pl/attachments/download/152439",
    "where": "archiwum KBRWr_2024_Zalaczniki_do_Raportu2_rozdz_2_ankiety.zip → "
             "„Załącznik 2.2 wyniki badań ankietowych w gospodarstwach "
             "domowych.xlsx” → arkusz „Podział zadań przewozowych”, wiersze 252–260",
    "note": "1,2 os./poj. według KBR 2024 (zał. 2.2 do Raportu II, „Średnia "
            "liczba osób w samochodzie”): Wrocław 1,207 w podróżach, w których "
            "ankietowany prowadził, dzień roboczy. Dla godzin 6–10 i 15–19 "
            "wychodzi 1,17–1,19; dojazdy do pracy tylko 1,08. Wartość z KBR 2018 "
            "(1,55) liczy pasażerów kilka razy i nie nadaje się do porównań.",
}


# ---------------------------------------------------------------------- driver
def read_cat_labels():
    out = {}
    for r in sheet(F33, "Kategorie pojazdów", 4):
        if r[0]:
            out[txt(r[0])] = txt(r[1]).rstrip(",;")
    return out


def stage_points(cat):
    """The road cross-section catalogue, plus a peak-hour total per section so
    the map can size markers without loading road.json."""
    road = json.load(open(os.path.join(OUT, "road.json"), encoding="utf8"))
    for c in cat:
        s = road["sections"].get(c["id"])
        tot, peak, hourly = 0, 0, [0] * 24
        if s:
            for d in s["dirs"].values():
                for h in range(24):
                    v = sum(d["h"][h])
                    hourly[h] += v
                    tot += v
            peak = max(hourly)
        c["total"] = tot
        c["peak"] = peak
        c["byHour"] = hourly
        c["hasOff"] = bool(s and "off" in s)
        # Most sections ran 5-21 or round the clock; a few only in the peaks,
        # and their "day" total is an 8-hour sum unless the app knows.
        counted = {h for h in range(24) if hourly[h]}
        if counted and counted <= set(WINDOWS["roadPeak"]):
            c["window"] = WINDOWS["roadPeak"]
    write("points.json", cat)
    return cat


def main(stages):
    log("geocoding index...")
    idx = geocode.build_index(geocode.overpass_roads())
    cat = read_catalogue()
    if "road" in stages:
        stage_road(cat)
    if "points" in stages:
        stage_points(cat)
    if "pt" in stages:
        stage_pt(idx, geocode.stop_index(geocode.overpass_stops()))
    if "bike" in stages:
        stage_bike(idx)
    if "ped" in stages:
        stage_ped(idx)
    if "rail" in stages:
        stage_rail(geocode.overpass_stations())
    if "survey" in stages:
        stage_survey()
    if "modes" in stages:
        import modes
        L = lambda f: json.load(open(os.path.join(OUT, f + ".json"), encoding="utf8"))
        modes.build(OUT, L("survey"), L("pt"))
        modes.build_service(OUT)
    if "signals" in stages:
        import signals
        signals.build(OUT)
    if "network" in stages:
        import network
        network.build(OUT,
                      json.load(open(os.path.join(OUT, "road.json"), encoding="utf8"))["sections"],
                      json.load(open(os.path.join(OUT, "points.json"), encoding="utf8")),
                      json.load(open(os.path.join(OUT, "survey.json"), encoding="utf8")))
    if "meta" in stages:
        road = json.load(open(os.path.join(OUT, "road.json"), encoding="utf8"))
        write("meta.json", {
            "generated": datetime.date.today().isoformat(),
            "source": "Kompleksowe Badania Ruchu Wrocław 2024",
            "vehCats": read_cat_labels(),
            "vehCatOrder": VEH_CATS,
            "offCatOrder": OFF_CATS,
            "motorCats": ["c", "d", "e", "f", "g", "h", "i", "j", "l"],
            "bikePlace": BIKE_PLACE, "bikeMode": BIKE_MODE, "bikeUser": BIKE_USER,
            "pedMobility": PED_MOB, "pedMobility2": PED_MOB2, "sex": SEX,
            "areas": sorted({c["area"] for c in cat}),
            "carOccupancy": CAR_OCCUPANCY,
            **stage_expansion(road["sections"], cat),
        })
    log("done")


ALL = ["road", "points", "pt", "bike", "ped", "rail", "survey", "meta",
       "network", "modes", "signals"]

if __name__ == "__main__":
    main(sys.argv[1:] or ALL)
