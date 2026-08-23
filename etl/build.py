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
PED_MOB2 = {1: "osoba starsza (60+) z problemami z poruszaniem się",
            2: "osoba z bagażem", 3: "osoba z wózkiem dziecięcym",
            4: "osoba z psem", 5: "osoba na wózku inwalidzkim",
            6: "osoba o kulach / z balkonikiem", 7: "osoba z dzieckiem",
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
