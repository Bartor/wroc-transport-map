import math
# -*- coding: utf-8 -*-
"""Assemble reports/point-audit.csv and the flagged tables for point-audit.md
from the cached check outputs. Manual adjudications are listed in MANUAL with
the reason; everything else is mechanical.

Pipeline (run from repo root, Python 3.12, each with -I):
  extract_raw.py  -> cache/raw.json           (3-5 min, reads all workbooks)
  probe_pt.py     -> cache/pt_poles_64.json   (6.4 'Nr slupka' per section)
  check_numbers.py, check_breakdowns.py
  fetch_osm_extra.py, fetch_boundary.py       (one-off Overpass, cached)
  check_placement.py, special.py
  build_report.py -> reports/point-audit.csv + reports/audit/cache/flagged.md
"""
import os, json, csv, collections

ROOT = os.getcwd()
C = os.path.join(ROOT, "reports", "audit", "cache")
J = lambda f: json.load(open(os.path.join(C, f), encoding="utf8"))
NUM, PLA, SPE, BRK = J("numbers.json"), J("placement.json"), J("special.json"), J("breakdowns.json")
L = lambda f: json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))
pts, pt, bike, ped, rail = L("points"), L("pt"), L("bike"), L("ped"), L("rail")

# --------------------------------------------------------------- adjudications
# status: ok | fix (confirmed error) | check (uncertain) | n/a
MANUAL = {
    ("road", "AOW_04"): ("ok", "on 'most Rędziński' (3 m), the A8 bridge; OSM names the bridge way, not the motorway"),
    ("road", "KW_02"): ("ok", "source names it ul. Widawska but 'Odcinek' says ul. Pawłowicka 120-130; point is on Pawłowicka (3 m) at the city border (7 m) - source naming, coordinates fine"),
    ("road", "KW_04"): ("ok", "point is on the continuation outside the city (OSM 'Wrocławska', 1 m; ul. Sportowa 46 m) per 'Odcinek' Odolanowska (Wrocław) - Sportowa (Mirków); 147 m outside the boundary"),
    ("road", "KW_12"): ("ok", "87 m from Mościckiego / 50 Bohaterów junction, 77 m outside the boundary; 'Odcinek' runs to Zacharzyce - plausible"),
    ("road", "KW_26"): ("check", "1 m from the city boundary as 'na granicy Wrocławia' says, but on a way OSM names 'Wrocławska'; OSM 'Trzmielowicka' ends 2.4 km east. Coordinates consistent with the description; naming gap in OSM likely"),
    ("road", "KW_09"): ("ok", "source typo 'Opatkowicka'; point 4 m from OSM 'Opatowicka'"),
    ("bike", "RR_33"): ("check", "intersection midpoint lands 94 m from Bora-Komorowskiego (13 m from al. Sobieskiego) - probably on the wrong carriageway/approach; snap to Bora-Komorowskiego"),
    ("bike", "RR_11A"): ("check", "placed at the Dmowskiego/Księcia Witolda junction ('one-intersection'); ~70 m outside the Witolda-Jagiełły segment by our crossing estimate - minor"),
    ("bike", "RR_11B"): ("check", "same coordinates as RR_11A (other side of the street) - minor"),
    ("bike", "RR_20"): ("check", "cross-centroid fallback; 59 m from the Ślęza but 154 m from the stretch between Trawowa and Francuska; the footbridge itself is not a named OSM way - uncertain"),
    ("bike", "RR_32A"): ("ok", "manual override sits on Jaz Psie Pole (0 m), one end of the 'tory kolejowe - Jaz Psie Pole' segment; acceptable"),
    ("bike", "RR_28"): ("ok", "on Kładka Siedlecka (0 m); name matcher missed it only because of the 'nad rzeką Oławą' suffix"),
    ("bike", "RR_10"): ("ok", "on bulwar Słoneczny at Most Młyński end; 'szalet miejski' end not mappable"),
    ("bike", "RR_29B"): ("ok", "on Kładka Zwierzyniecka (0 m)"),
    ("bike", "RR_02"): ("ok", "on Kładka Radiowej Trójki (1 m)"),
    ("bike", "RR_16"): ("ok", "footbridge over Na Ostatnim Groszu: 0 m from that street, 23 m from Orlińskiego"),
}
SUGGEST = {}       # (layer,id) -> ([lat,lon], how)
for pid, s in SPE.items():
    if s.get("ref"):
        SUGGEST[(s["layer"], pid)] = ([round(s["ref"][0], 5), round(s["ref"][1], 5)], s["feature"] + ": " + s["note"])
# hand-derived (see report text; computed in special.py / Nominatim evidence)
SUGGEST[("bike", "RR_21A")] = ([51.09014, 16.99654], "midpoint of Hallera x railway crossing [51.09006,16.99597] (OSM) and Hallera 81 [51.09022,16.99711] (Nominatim)")
SUGGEST[("bike", "RR_21B")] = SUGGEST[("bike", "RR_21A")]
SUGGEST[("bike", "RR_26")] = ([51.0731, 17.0349], "midpoint of Borowska [51.07318,17.03264] and Pirenejska [51.0730,17.03711] at the latitude Nominatim gives for Pirenejska; promenade path itself is not named in OSM there (approx +-150 m)")
SUGGEST[("bike", "RR_27")] = ([51.0731, 17.0569], "midpoint of Bardzka [51.07248,17.0532] and Ziębicka [51.07380,17.06058] beside Cmentarz Ducha Świętego [51.07255,17.05645] (Nominatim) (approx +-150 m)")
SUGGEST[("bike", "RR_13")] = ([51.12996, 16.97990], "midpoint of the closest approach of Pilczycka [51.13046,16.97803] and Milenijna [51.12945,16.98177] (the cobbled link between them) - approx")
SUGGEST[("bike", "RR_33")] = None

BIKE_FIX = {
    "RR_08": "street-centroid of the WRONG street: geocoder strips 'Promenada' and lands on ul. Oławska in the Old Town",
    "RR_30": "cross-centroid fallback (midpoint of the two cross-street centroids) - lands on pl. Grunwaldzki, not on the Stara Odra embankment",
    "RR_31": "cross-centroid fallback - not on the Kanał Powodziowy embankment",
    "RR_32B": "cross-centroid fallback - not on the Kanał Żeglugowy embankment",
    "RR_21A": "manual override is 190 m off ul. Hallera (between Saperów and Modlińska)",
    "RR_21B": "manual override is 190 m off ul. Hallera (between Saperów and Modlińska)",
    "RR_26": "manual override is ~1.2 km W of the Borowska-Pirenejska stretch (it sits by Ślężna)",
    "RR_27": "manual override is ~1.5 km from the Bardzka-Ziębicka stretch at Cmentarz Ducha Świętego (it sits by Borowska, i.e. roughly where RR_26 belongs)",
    "RR_13": "manual override = Nominatim centroid of Park Zachodni, ~370-400 m from both Pilczycka and Milenijna; source describes a cobbled link road between them",
}

rows = []
flag_tables = collections.defaultdict(list)


def add(layer, pid, name, nok, pok, dist, notes):
    rows.append([layer, pid, name, nok, pok, "" if dist is None else dist, " | ".join(n for n in notes if n)])


def numnotes(layer, pid):
    r = NUM["res"].get(layer, {}).get(pid, {})
    return r.get("ok", True), [n for n in r.get("notes", []) if n]


# --------------------------------------------------------------- road
for p in pts:
    pid = p["id"]
    nok, nn = numnotes("road", pid)
    # benign diffs explained
    nn2 = []
    for n in nn:
        if pid == "R1_01B" and n.startswith("direction keys"):
            nn2.append("E>W direction omitted from road.json: all its raw rows are 0 (one-way) - benign")
            nok = True
        elif pid == "R1_03B" and n.startswith("off-carriageway cells"):
            nn2.append("3 off-carriageway rows lack a quarter label; JSON assigns them via the hour column (05:00) - correct")
            nok = True
        elif n.startswith("not in 3.4 road list"):
            nn2.append("'hours' label empty (AOW not in the 3.4 road list) - cosmetic")
        else:
            nn2.append(n)
    kc = NUM["res"]["road"][pid].get("kbr_cmp")
    if kc:
        nn2.append("total equals authors' 'Porównanie KBR' figure (%s)" % kc["sheet"] if kc["sheet"] == kc["json"]
                   else "total %s != authors' sheet %s" % (kc["json"], kc["sheet"]))
    hrs = NUM["res"]["road"][pid]["hours"]
    nflag = "yes" if nok else "no"
    if len(hrs) == 8:
        nflag = "warn"
        nn2.append("only 8 h counted (6-10,15-19); 'total' is an 8-h sum but the app treats road as whole-day (expansion factor 1.0)")
        flag_tables["road_num"].append((pid, p["name"], "8-hour count presented as daily total",
                                        "hours with data: %s; total %d" % (hrs, p["total"]),
                                        "mark KO_* as 8-h in meta.windows / expansion, or exclude from day totals and rankings"))
    pl = PLA["road"][pid]
    status = "ok" if pl["ok"] else "fix"
    notes = list(pl["notes"])
    m = MANUAL.get(("road", pid))
    if m:
        status, why = m
        notes = [why]
    if pl.get("dist_named") is None and pid not in ("KW_09",):
        status = "n/a" if status == "ok" else status
        notes.append(pl.get("named_check", ""))
    if "boundary_m" in pl:
        notes.append("%d m from city boundary (%s)" % (pl["boundary_m"], "inside" if pl["inside_city"] else "outside"))
    notes.append("JSON = workbook coords (%.0f m)" % pl.get("json_vs_wb_m", -1))
    dist = pl.get("dist_named")
    if pid in SPE and SPE[pid].get("dist_feature_m") is not None:
        dist = SPE[pid]["dist_feature_m"]   # bridge that carries the named road (AOW_04, R2_15B)
    add("road", pid, p["name"], nflag, status, dist, nn2 + notes)
    if status in ("fix", "check"):
        flag_tables["road"].append((pid, p["name"], status, "; ".join(notes[:2]), "-"))

# --------------------------------------------------------------- bike / ped
mob_fix = "byMobility2 labels wrong for codes 3,4,6,7 (counts right, categories mislabelled)"
for layer, data in (("bike", bike), ("ped", ped)):
    for p in data:
        pid = p["id"]
        nok, nn = numnotes(layer, pid)
        nflag = "yes" if nok else "no"
        # labels per the 3.5 legend: 3 crutches/canes, 4 pram, 6 blind, 7 "male kolka"
        legend = {"3": "kul", "4": "wózkiem dziecięcym", "6": "niewidom", "7": "kółka"}
        meta_m2 = json.load(open(os.path.join("public", "data", "meta.json"), encoding="utf8"))["pedMobility2"]
        if layer == "ped" and any(w not in meta_m2.get(c, "") for c, w in legend.items()):
            nflag = "no"
            nn = nn + [mob_fix + ": " + ", ".join("%s=%d" % (k, v) for k, v in p["byMobility2"].items())]
        pl = PLA[layer][pid]
        status = "ok" if pl["ok"] else "check"
        notes = list(pl["notes"])
        if pid in BIKE_FIX:
            status = "fix"
            notes = [BIKE_FIX[pid]] + notes
        m = MANUAL.get((layer, pid))
        if m:
            status, why = m
            notes = [why] + [n for n in notes if "not between" not in n]
        sg = SUGGEST.get((layer, pid))
        if status in ("fix", "check") and (
                (sg and math.dist(sg[0], (p["lat"], p["lon"])) * 111e3 < 25)
                or (not sg and p.get("geo") == "manual" and pl.get("dist_named") == 0)):
            status = "ok"
            notes = ["fixed: now at the suggested position"] + notes
        sp = SPE.get(pid)
        if sp:
            notes.append("%s: point %s m from feature, %s m from reference" % (sp["feature"], sp["dist_feature_m"], sp["dist_ref_m"]))
        if pl.get("dist_named") is None and status == "ok":
            notes.append(pl.get("named_check", ""))
        notes.append("geo=%s" % p.get("geo"))
        dist = pl.get("dist_named")
        if sp and sp.get("dist_feature_m") is not None:
            dist = sp["dist_feature_m"]     # distance to the named feature (path, river, footbridge)
        add(layer, pid, p["name"], nflag, status, dist, nn + notes)
        if status in ("fix", "check"):
            sg = SUGGEST.get((layer, pid))
            ev = "; ".join(n for n in notes if n and not n.startswith("geo="))
            flag_tables[layer].append((pid, p["name"], status, ev,
                                       ('"%s": [%s, %s]  (%s)' % (pid, sg[0][0], sg[0][1], sg[1])) if sg else
                                       ("snap to nearest point of %s" % pl.get("osm_name") if pl.get("osm_name") else "-")))

# --------------------------------------------------------------- pt
CAUSE = {}
for p in pt:
    pid = p["id"]
    pl = PLA["pt"][pid]
    d = pl.get("dist_ref_m")
    if d is None or d <= 150:
        continue
    st = p["stop"]
    if pid in ("PR_03B", "PR_03C", "PR_03D"):
        c = "no OSM stop named 'Wzgórze Partyzantów'; fell back to the point name and landed on PR_03A's 'Park Staromiejski' stop"
    elif st.lower().startswith(("rondo", "wróblowice", "wilkszyn")):
        c = "find_stop prefix fallback matched a different stop ('%s' -> a stop named '%s...')" % (st, st.split()[0])
    elif "(" in st:
        c = "'(…)' qualifier dropped by _stopkey, so '%s' was matched to the plain '%s' stop elsewhere" % (st, st.split(" (")[0])
    elif pid.startswith(("R2_08", "R3_09")):
        c = "OSM stops 'Bardzka' and 'Bardzka (Cmentarz)' merged and averaged - point lands between the two stops"
    elif d > 500:
        c = "the OSM node(s) keyed '%s' (after dropping '(…)') are a different place %d m away" % (st.lower(), d)
    else:
        c = "all OSM nodes named '%s' averaged (other directions/platforms of a large hub); section is on %s" % (st, p["loc"])
    CAUSE[pid] = c
for p in pt:
    pid = p["id"]
    nok, nn = numnotes("pt", pid)
    pl = PLA["pt"][pid]
    d = pl.get("dist_ref_m")
    if not pl.get("ref"):
        status = "n/a"
    elif d > 150:
        status = "fix" if "name" not in (pl["ref_how"] or "") else "check"
    else:
        status = "ok"
    notes = []
    if d is not None:
        notes.append("%d m from its MPK poles (%s)" % (d, pl["ref_how"]))
    else:
        notes.append("no independent reference: poles not in city GTFS (suburban operator)")
    if pid in CAUSE:
        notes.append("cause: " + CAUSE[pid])
    notes += [n for n in pl["notes"] if "stop '" in n]
    notes.append("geo=%s" % p.get("geo"))
    add("pt", pid, p.get("stop") or p["name"], "yes" if nok else "no", status, pl.get("dist_named"), nn + notes)
    if status in ("fix", "check"):
        flag_tables["pt"].append((pid, "%s / %s" % (p["stop"], p["loc"]), status,
                                  "JSON [%.5f, %.5f] is %d m from poles mean [%.5f, %.5f]; ref is %s m from '%s'. %s"
                                  % (p["lat"], p["lon"], d, pl["ref"][0], pl["ref"][1], pl.get("ref_dist_named"),
                                     p["loc"], CAUSE.get(pid, "")),
                                  '"%s": [%.5f, %.5f]  (mean of GTFS stop_code positions of the section\'s poles)'
                                  % (pid, pl["ref"][0], pl["ref"][1])))

# --------------------------------------------------------------- rail
for c in rail:
    cid = c["id"]
    nok, nn = numnotes("rail", cid)
    pl = PLA["rail"][cid]
    d = pl.get("dist_ref_m")
    status = "check" if d and d > 1500 else "ok"
    notes = [n for n in pl["notes"]]
    notes.append("marker %s city; %s m from where the %s line crosses the boundary (straight-line estimate)"
                 % ("inside" if pl.get("marker_inside_city") else "outside", d, "-".join(pl.get("cordon_pair", []))))
    add("rail", cid, " / ".join(c["stations"]), "yes" if nok else "no", status, None, nn + notes)
    if status == "check":
        flag_tables["rail"].append((cid, " / ".join(c["stations"]), status,
                                    "marker = mean of all from/to stations incl. distant ones; %d m from the %s boundary crossing"
                                    % (d, "-".join(pl["cordon_pair"])),
                                    "[%.5f, %.5f] (%s)" % (pl["suggest"][0], pl["suggest"][1], pl.get("suggest_how"))))

with open(os.path.join(ROOT, "reports", "point-audit.csv"), "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["layer", "id", "name", "numbers_ok", "placement_ok", "distance_to_named_street_m", "notes"])
    w.writerows(rows)

# summary counts
summ = collections.OrderedDict()
for r in rows:
    s = summ.setdefault(r[0], collections.Counter())
    s["n"] += 1
    s["num_" + r[3]] += 1
    s["pl_" + r[4]] += 1
json.dump({"summary": summ, "flags": flag_tables}, open(os.path.join(C, "report_tables.json"), "w", encoding="utf8"),
          ensure_ascii=False, indent=1)


def md_table(items):
    out = ["| id | name | status | problem / evidence | suggested fix (overrides.json format) |", "|---|---|---|---|---|"]
    for it in items:
        out.append("| " + " | ".join(str(x).replace("|", "/").replace("\n", " ") for x in it) + " |")
    return "\n".join(out)


with open(os.path.join(C, "flagged.md"), "w", encoding="utf8") as f:
    for k, v in flag_tables.items():
        f.write("\n### %s (%d)\n\n" % (k, len(v)))
        f.write(md_table(v) + "\n")
nodes = []
for n in PLA["nodes"]:
    verdict = "ok"
    why = ""
    if n["dist_true_m"] is not None and n["dist_true_m"] > 150:
        verdict = "fix" if n["dist_true_m"] > 1000 else "check"
        why = "only paired because the PT node is misplaced; true distance %d m" % n["dist_true_m"]
    elif not n["street_shared"]:
        verdict = "check"
        why = "street names differ"
    nodes.append((n["road"], n["pt"], n["dist_m"], n["dist_true_m"], "; ".join(n["road_names"]),
                  "; ".join(n["pt_locs"]) + " (" + "; ".join(n["pt_stops"]) + ")", verdict, why))
json.dump({"nodes": nodes, "missed": PLA["missed_pairs"]}, open(os.path.join(C, "nodes_table.json"), "w", encoding="utf8"),
          ensure_ascii=False, indent=1)
for k, s in summ.items():
    print(k, dict(s))
for k, v in flag_tables.items():
    print(k, len(v))
