# -*- coding: utf-8 -*-
"""The KBR household survey as a table of trips between zones.

BIP publishes the survey's whole database (Report II, attachment set 1): 10 566
people's trips on one weekday, with population weights. It also holds each
respondent's street and house number, their school and workplace, and the exact
ends of every trip. The models need none of that: columns are picked by name
below, and the result knows zones only. The raw files stay out of git, under
data/kbr.

    python etl/diary.py          # data/kbr -> etl/cache/diary.json
"""
import collections, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KBR = os.path.join(ROOT, "data", "kbr", "x")
OUT = os.path.join(ROOT, "etl", "cache", "diary.json")

log = lambda *a: print(*a, file=sys.stderr, flush=True)


def find(*parts):
    """A published file by fragments of its name, wherever it was unpacked."""
    for d, _, fs in os.walk(KBR):
        for f in fs:
            if all(p.lower() in f.lower() for p in parts):
                return os.path.join(d, f)
    raise FileNotFoundError("%s - unpack the BIP attachments into %s" % (parts, KBR))


# One row per trip, or one for a person who made none. No street, house number,
# school, workplace or free text.
PERSON = {
    "osobaID": "person", "gospID": "home", "waga_pop": "w", "DOMrejon": "zone",
    "obszar": "area", "wiek": "age", "O2rec": "sex", "O5rec": "job", "O8tryb": "workMode",
    "G1rec": "size", "G3rec": "cars", "G4_5rec": "bikes", "O10": "licence",
    "O12": "pass", "O11_1": "mobility", "X3": "typical", "X1": "out", "l_podr_kat": "trips",
    "F1": "carsInCentre", "F2": "tramPriority", "F3": "bikeLanes", "K1": "usual",
    "K3a": "ptRate1", "dzien": "weekday",
    "DOMtyp": "building", "dzieci": "smallKids", "O11_2": "careChild",
    # who asked and on which round, as running numbers: answers depend on it
    "r41": "asker", "wiazka": "round",
}
TRIP = {
    "nr_podrozy": "n", "STARTrejon": "from", "STOPrejon": "to", "odleglosc": "km",
    "MOT": "purpose", "STARTgodzina": "start", "STOPgodzina": "end", "CZASpodrozy": "min",
    "szczyt": "peak", "L_ST": "legs", "STagr1": "mode1", "STagr2": "mode", "STagr3": "mode3",
    "ST1": "leg1", "ST1linia": "line1", "ST2": "leg2", "ST2linia": "line2",
    "ST3": "leg3", "ST3linia": "line3", "C3": "walkTo", "C4_1": "change1", "C5": "walkFrom",
    "P1": "inCar", "P2": "parked", "l_przesiadek": "changes",
    "Z2_2x1": "whyCar1", "Z2_2x2": "whyCar2",
    "STARTmot": "act0", "STOPmot": "act1", "STARTgmina": "gmina0", "STOPgmina": "gmina1",
}
# The closed questions on opinions and habits; the open ones stay unread.
ASKED = re.compile(r"(F[1-3]|K1|K2_\d|K[345][a-e]|K6|K7|O1[56]_\d|U[123]_\d+|Z\d(_\d+)?x[12]|X2)$")


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def hour(v):
    """A clock time as hours: 7.5. Excel hands back times, text or day fractions."""
    if v is None or v == "":
        return None
    if hasattr(v, "hour"):
        return v.hour + v.minute / 60
    if hasattr(v, "total_seconds"):
        return v.total_seconds() / 3600 % 24
    s = str(v)
    if ":" in s:
        h, m = s.split(":")[:2]
        return int(h) + int(m) / 60
    f = num(v)
    return f * 24 if f is not None and f < 1 else f


def build():
    import openpyxl
    path = find("Baza danych_gospodarstwa")
    log("reading", os.path.basename(path), "(a minute or two)...")
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["BAZA - DANE OGÓŁEM"]
    it = ws.iter_rows(values_only=True)
    head, above = None, None
    for row in it:
        if row and row[0] == "podrozID":
            head = {name: i for i, name in enumerate(row) if name}
            break
        above = row
    asked = {k: i for k, i in head.items() if ASKED.match(k)}
    missing = [k for k in (*PERSON, *TRIP) if k not in head]
    assert not missing, missing
    people, trips = {}, []
    for row in it:
        if not row or row[0] is None:
            continue
        pid = row[head["osobaID"]]
        # a person's answers sit on their first row
        if pid not in people:
            people[pid] = {v: row[head[k]] for k, v in PERSON.items()}
            people[pid]["ans"] = {k: row[i] for k, i in asked.items() if row[i] not in (None, "")}
        if row[head["STARTrejon"]] is None or row[head["STOPrejon"]] is None:
            continue
        t = {v: row[head[k]] for k, v in TRIP.items() if row[head[k]] not in (None, "")}
        t["person"] = pid
        t["start"], t["end"] = hour(t.get("start")), hour(t.get("end"))
        trips.append(t)
    # running numbers instead of the survey's own ids
    pid = {p: i for i, p in enumerate(people)}
    hid = {}
    runs = {"asker": {}, "round": {}}
    for p in people.values():
        p["home"] = hid.setdefault(p["home"], len(hid))
        for k, seen in runs.items():
            p[k] = seen.setdefault(p[k], len(seen))
        del p["person"]
    for t in trips:
        t["person"] = pid[t["person"]]
    out = {"people": list(people.values()), "trips": trips,
           "questions": {k: " ".join(str(above[i]).split()) for k, i in asked.items()}}
    with open(OUT + ".part", "w", encoding="utf8") as f:
        json.dump(out, f, ensure_ascii=False, default=str, separators=(",", ":"))
    os.replace(OUT + ".part", OUT)
    log("  %d people, %d trips -> %s" % (len(people), len(trips), os.path.relpath(OUT, ROOT)))
    return out


def load():
    if not os.path.exists(OUT):
        return build()
    with open(OUT, encoding="utf8") as f:
        return json.load(f)


# ---------------------------------------------------------------------- zones
def zones():
    """The survey's zones: code -> polygon rings in lon/lat, with jobs."""
    import sqlite3, struct
    from pyproj import Transformer
    db = sqlite3.connect(find("12.3", "gpkg"))
    t, g, srs = db.execute("select table_name, column_name, srs_id from gpkg_geometry_columns").fetchone()
    cols = [c[1] for c in db.execute('pragma table_info("%s")' % t)]
    tr = Transformer.from_crs(srs, 4326, always_xy=True)

    def rings(blob):
        env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 7]
        b, o = blob, 8 + env

        def geom(o):
            e = "<" if b[o] == 1 else ">"
            kind = struct.unpack_from(e + "I", b, o + 1)[0] % 1000
            n = struct.unpack_from(e + "I", b, o + 5)[0]
            o += 9
            out = []
            if kind == 3:
                for _ in range(n):
                    m = struct.unpack_from(e + "I", b, o)[0]
                    xy = struct.unpack_from(e + "%dd" % (2 * m), b, o + 4)
                    o += 4 + 16 * m
                    out.append(list(zip(*tr.transform(xy[0::2], xy[1::2]))))
                return out, o
            for _ in range(n):
                r, o = geom(o)
                out += r
            return out, o
        return geom(o)[0]

    out = []
    for row in db.execute('select * from "%s"' % t):
        d = dict(zip(cols, row))
        out.append({"rings": rings(d.pop(g)), **d})
    return out, cols, srs


if __name__ == "__main__":
    build()
