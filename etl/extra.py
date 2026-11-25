# -*- coding: utf-8 -*-
"""The rest of what the KBR attachments hold.

    python etl/extra.py          # data/, data/kbr -> public/data

compare.json   the same places counted in 2010, 2018 and 2024
ways.json      which direction of a road section heads for the centre
stations.json  boardings at railway and bus stations (8.1), and the airport (9.1)
speeds.json    travel times on 46 road sections (3.11), by hour
"""
import collections, json, math, os, re, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build
import diary
import geocode
import network
from trips import CENTRE, KM_LON, sheet, write

log = diary.log
num = lambda v: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
L = lambda f: json.load(open(os.path.join(diary.ROOT, "public", "data", f + ".json"), encoding="utf8"))

# From the text of Report II; the survey of residents changed how it draws
# its sample between the rounds (addresses in 2018, random route in 2024).
MODAL = {
    "where": "Raport II, wykres 2.55 (s. 54), podróże mieszkańców",
    "modes": ["pieszo", "rower", "samochód", "transport zbiorowy", "inaczej"],
    "rows": [["Wrocław 2010/11", [19.1, 3.8, 41.6, 34.5, 1.1]],
             ["Wrocław 2018", [24.2, 6.3, 41.4, 27.6, 0.5]],
             ["Wrocław 2024", [33.1, 4.7, 39.8, 21.6, 0.8]],
             ["otoczenie 2018", [14.2, 5.8, 65.7, 14.3, 0.1]],
             ["otoczenie 2024", [17.5, 6.7, 64.6, 10.3, 0.9]]],
}
# table 6.10: passengers in vehicles, 6:30-8:30 and 14-18
TRANSIT = [["Legnicka", "R1_01", 49618, 64876, 33031], ["Grabiszyńska", "R1_03", 8014, 8588, 13591],
           ["Powstańców Śląskich", "R1_05", 11458, 13337, 10420],
           ["Most Grunwaldzki", "R1_12", 26345, 35317, 33564],
           ["Krzywoustego", "R3_14", 17513, 10382, 17849],
           ["Kamieńskiego", "R3_16", 1375, 823, 2047]]
# chart 4.11; the rounds did not count the same parts of the street
BIKES = [["Dmowskiego (przy Jagiełły)", 710, 1880], ["Legnicka (przy pl. Jana Pawła II)", 1201, 1686],
         ["pl. Orląt Lwowskich / Marchijska", 578, 1605], ["Świdnicka (przy Piłsudskiego)", 1395, 1450],
         ["Legnicka (przy Wejherowskiej)", 1861, 850], ["Popowicka (przy Wejherowskiej)", 600, 466],
         ["Spiska", 343, 423], ["Komuny Paryskiej (przy Pułaskiego)", 316, 288],
         ["Komandorska", 113, 266], ["kładka nad Na Ostatnim Groszu", 48, 84]]


def stage_compare():
    rows = []
    for r in build.sheet(build.F33, "Porównanie KBR", 4):
        r = list(r)
        while r and r[0] is None:
            r = r[1:]
        if len(r) < 9 or num(r[5]) is None or not num(r[3]):
            continue
        rows.append({"ids": [s.strip() for s in str(r[4]).split("+")],
                     "v10": num(r[1]), "v18": num(r[3]), "v24": num(r[5]),
                     "day": int(str(r[8]).startswith("24"))})
    known = {p["id"] for p in L("points")}
    lost = [r["ids"] for r in rows if not set(r["ids"]) & known]
    log("  2018 pairs: %d; not among our sections: %s" % (len(rows), lost))
    # trains over the city cordon: the sheet has a table against 2010, then one
    # against 2018; a row without a cordon continues the one above
    rail, cordon = [], None
    for r in sheet(("7.1",), "PORÓWNANIE Z KBR2010 i 2018", 35):
        c = [x for x in r if x is not None]
        if len(c) >= 7 and str(c[1]).startswith(("do ", "z ")):
            cordon, c = str(c[0]).capitalize() if len(str(c[0])) > 3 else str(c[0]), c[1:]
        if len(c) >= 5 and str(c[0]).startswith(("do ", "z ")) and cordon:
            rail.append([cordon, "in" if c[0].startswith("do") else "out", *[num(x) for x in c[1:5]]])
    stations = []
    for r in sheet(("8.1",), "Porównanie z KBR 2010 i 2018", 55):
        c = [x for x in r if x is not None]
        if len(c) == 7 and num(c[3]) is not None:
            stations.append([str(c[0]).strip(), *[num(x) for x in c[1:5]]])
    write("compare.json", {"roads": rows, "modal": MODAL, "transit": TRANSIT, "bikes": BIKES,
                           "stations": stations, "rail": rail})


# ------------------------------------------------------------------- directions
HEAD = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}


def stage_ways():
    """To or from the centre. The survey says so on the two cordons only; where
    it does not, the compass directions do, if the road points that way."""
    told = collections.defaultdict(collections.Counter)
    for r in build.sheet(build.F33, "DANE - na jezdni", 4):
        if r[13] and num(r[12]):
            told[(build.txt(r[1]), build.txt(r[10]) + ">" + build.txt(r[11]))][r[13]] += r[12]
    points, road = {p["id"]: p for p in L("points")}, L("road")["sections"]
    out, ok, bad = {}, 0, 0
    for sid, sec in road.items():
        p = points.get(sid)
        for d in sec["dirs"]:
            a, _, b = d.partition(">")
            guess = None
            if p and p["lat"] and b in HEAD and a in HEAD:
                # heading: from the side it comes in on to the side it leaves by
                va, vb = (math.radians(HEAD[x]) for x in (a, b))
                hx, hy = math.sin(vb) - math.sin(va), math.cos(vb) - math.cos(va)
                cx = (CENTRE[1] - p["lon"]) * KM_LON
                cy = CENTRE[0] - p["lat"]
                dot = (hx * cx + hy * cy) / ((math.hypot(hx, hy) or 1) * (math.hypot(cx, cy) or 1))
                guess = "in" if dot > 0.5 else "out" if dot < -0.5 else None
            says = told.get((sid, d))
            if says:
                s = "in" if says.most_common(1)[0][0].startswith("do") else "out"
                ok += guess == s
                bad += guess is not None and guess != s
                out.setdefault(sid, {})[d] = [s, 1]
            elif guess:
                out.setdefault(sid, {})[d] = [guess, 0]
    log("  directions: compass agrees with the survey %d times, not %d; %d sections" % (ok, bad, len(out)))
    # a section with one end only would make in and out uncomparable
    write("ways.json", {s: w for s, w in out.items()
                        if {x[0] for x in w.values()} == {"in", "out"}})


# --------------------------------------------------------------------- stations
def stage_stations():
    rail = {}
    try:
        rail = geocode.overpass_stations()
    except Exception as e:
        log("  stations:", e)
    S = {}

    def add(name, kind, arrives, departs, on, off, line, date):
        s = S.setdefault(name, {"name": name, "kind": kind, "date": date,
                                "on": [0] * 24, "off": [0] * 24, "runs": [0] * 24,
                                "lines": collections.Counter()})
        # boardings belong to the hour of departure, alightings to that of arrival
        for v, h, key in ((on, departs if departs is not None else arrives, "on"),
                          (off, arrives if arrives is not None else departs, "off")):
            if v and h is not None:
                s[key][h] += int(v)
        h = departs if departs is not None else arrives
        if h is not None:
            s["runs"][h] += 1
        s["lines"][line] += int(on or 0) + int(off or 0)

    hour = lambda v: None if diary.hour(v) is None else int(diary.hour(v))
    safe = lambda v: hour(v) if v is not None and re.match(r"\d", str(v)) else None
    for r in sheet(("8.1",), "DANE SUROWE - przystanki kol.", 4):
        if r[0] and r[2]:
            add(str(r[2]).strip(), "rail", safe(r[4]), safe(r[6] or r[5]), num(r[16]), num(r[17]),
                str(r[12] or "").strip(), str(r[1])[:10])
    for r in sheet(("8.1",), "DANE SUROWE - Wrocław Gł.", 4):
        if r[0] and r[2]:
            add(str(r[2]).strip(), "rail", safe(r[3]), safe(r[5] or r[4]), num(r[15]), num(r[16]),
                str(r[11] or "").strip(), str(r[1])[:10])
    for r in sheet(("8.1",), "DANE SUROWE - dworce autobusowe", 4):
        if r[1] and r[3]:
            add(str(r[3]).strip(), "bus", safe(r[5]), safe(r[7] or r[6]), num(r[17]), num(r[18]),
                str(r[13] or "").strip(), str(r[2])[:10])
    out, lost = [], []
    for s in S.values():
        at = build.find_station(rail, s["name"]) if s["kind"] == "rail" else None
        if at is None:
            at = MANUAL.get(s["name"])
        if at is None:
            lost.append(s["name"])
        s["lines"] = s["lines"].most_common(12)
        s["lat"], s["lon"] = at if at else (None, None)
        out.append(s)
    log("  stations: %d, without a place: %s" % (len(out), lost))
    air = []
    for r in sheet(("9.1",), "Wyniki", 0):
        c = [x for x in r if x is not None]
        if len(c) >= 6 and num(c[0]) and isinstance(c[1], str):
            air.append([c[1].strip(), int(c[2]), int(c[3])])
    modes = {}
    for r in sheet(("9.1",), "Wyniki", 0):
        c = [x for x in r if x is not None]
        if c and str(c[0]).startswith("ogółem"):
            modes["on"] = 1
        if modes.get("on") and len(c) >= 7 and str(c[-7] if len(c) > 7 else c[0]):
            row = c[1:] if str(c[0]).startswith("ogółem") else c
            if isinstance(row[0], str) and num(row[5]) is not None and row[0] != "RAZEM":
                modes[row[0].strip()] = int(row[5])
    modes.pop("on", None)
    write("stations.json", {"stations": sorted(out, key=lambda s: -(sum(s["on"]) + sum(s["off"]))),
                            "airport": {"lat": 51.1027, "lon": 16.8858, "months": air,
                                        "access": modes, "n": sum(modes.values())}})


MANUAL = {"Dworzec Autobusowy Nadodrze": (51.12515, 17.03215),
          "Przystanek Autobusowy Dawida": (51.09545, 17.03760),
          "Dworzec Autobusowy Wroclavia": (51.09665, 17.03370)}


# ----------------------------------------------------------------------- speeds
def stage_speeds():
    """Median speed by hour on each section; its course is the fastest route
    on the street graph between the two ends."""
    types = {}
    for r in sheet(("Wykaz_typow",), "Lista odcinków", 3):
        c = [str(x) for x in r if x is not None]
        if len(c) > 3 and c[0].isdigit():
            for link in re.findall(r"\b\d{3,4}\b", c[3]):
                types.setdefault(link, c[1])
    P = collections.defaultdict(list)
    for r in sheet(("baza_danych_o_przejazdach",), "przejazdy", 1):
        if r[0] not in ("car", "truck"):
            continue
        sec, dist = num(r[11]) or diary.num(r[11]), diary.num(r[9])
        if not sec or not dist or sec <= 0 or str(r[10]).lower() not in ("true", "1"):
            continue
        kmh = 3.6 * dist / sec
        if not 3 < kmh < 200:
            continue
        # the workbook has turned some of the coordinates into dates
        at = [diary.num(x) for x in r[5:9]]
        if None in at or not (16 < at[0] < 18 and 50 < at[1] < 52 and 16 < at[2] < 18 and 50 < at[3] < 52):
            at = None
        P[(str(r[1]), str(r[2]))].append((int(r[3]), kmh, at, dist))
    edges, adj, coord = network.build_graph(network.fetch())
    grid = network.Grid([(n, *coord[n]) for n in adj if n in coord], cell=0.004)
    out = []
    import datetime, zoneinfo
    tz = zoneinfo.ZoneInfo("Europe/Warsaw")
    for (pid, way), rows in sorted(P.items()):
        if len(rows) < 30:
            continue
        placed = [x[2] for x in rows if x[2]]
        if len(placed) < 10:
            continue
        ends = [statistics.median(a[k] for a in placed) for k in range(4)]
        dist = statistics.median(x[3] for x in rows)
        by = collections.defaultdict(list)
        for t, v, _, _ in rows:
            by[datetime.datetime.fromtimestamp(t, tz).hour].append(v)
        path, names = [[ends[1], ends[0]], [ends[3], ends[2]]], []
        a, b = grid.nearest(ends[1], ends[0]), grid.nearest(ends[3], ends[2])
        if a and b and a != b:
            _, prev = network.dijkstra(adj, a)
            g, n, hops = [], b, 0
            while n in prev and hops < 2000:
                n2, eid, _ = prev[n]
                e = edges[eid]
                # edges run either way
                seg = e["g"] if e["v"] == n and e["u"] == n2 else e["g"][::-1]
                g = [list(p) for p in seg] + g
                if e["name"]:
                    names.append(e["name"])
                n = n2
                hops += 1
            length = sum(network.haversine(p, q) for p, q in zip(g, g[1:]))
            # only if it is the stretch that was measured
            if g and 0.7 < length / dist < 1.4:
                path = network.simplify(g)
        free = statistics.quantiles([x[1] for x in rows], n=20)[16]
        out.append({"id": pid + ("+" if way == "linestring" else "-"), "poly": pid,
                    "type": types.get(pid), "name": collections.Counter(names).most_common(1)[0][0] if names else None,
                    "m": round(dist), "n": len(rows), "free": round(free),
                    "g": [[round(p[0], 5), round(p[1], 5)] for p in path], "road": int(len(path) > 2),
                    "h": [round(statistics.median(by[h])) if len(by.get(h, ())) >= 5 else None for h in range(24)],
                    "k": [len(by.get(h, ())) for h in range(24)]})
    log("  speeds: %d directed sections, %d on the street graph" % (len(out), sum(s["road"] for s in out)))
    write("speeds.json", {"sections": out})


STAGES = {"compare": stage_compare, "ways": stage_ways, "stations": stage_stations, "speeds": stage_speeds}

if __name__ == "__main__":
    for s in sys.argv[1:] or STAGES:
        log(s)
        STAGES[s]()
