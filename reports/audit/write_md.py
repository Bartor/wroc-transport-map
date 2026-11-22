# -*- coding: utf-8 -*-
"""Write reports/point-audit.md from the cached tables + the fixed summary text below."""
import os, json
ROOT = os.getcwd()
C = os.path.join(ROOT, "reports", "audit", "cache")
T = json.load(open(os.path.join(C, "report_tables.json"), encoding="utf8"))
N = json.load(open(os.path.join(C, "nodes_table.json"), encoding="utf8"))
B = json.load(open(os.path.join(C, "breakdowns.json"), encoding="utf8"))
S = T["summary"]
F = T["flags"]


def tbl(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        out.append("| " + " | ".join(str(x).replace("|", "/").replace("\n", " ") for x in r) + " |")
    return "\n".join(out)


def c(layer, k):
    return S[layer].get(k, 0)


md = []
md.append("""# KBR 2024 map: point audit (numbers and placement)

Checked every point in `public/data/` against the raw files in `data/`, using a separate re-read of the workbooks. The pipeline code was not reused. Placement was checked against OSM named ways (`etl/cache/overpass_roads.json`), the city's GTFS stop poles (`etl/cache/gtfs_127.zip`, `stop_code` = MPK pole number from 6.3/6.4), the Wrocław boundary, and an extra one-off Overpass pull of waterways, footpaths and railways. Scripts: `reports/audit/` (how to re-run is at the bottom). Per-point results: `reports/point-audit.csv`.

**Status words.** `fix` means a confirmed error. `check` means probably wrong or the evidence is weak. `n/a` means the check could not be done.

## Summary

| layer | points | numbers OK | numbers flagged | placement OK | placement fix | placement check | placement n/a |
|---|---|---|---|---|---|---|---|
""")
for layer in ("road", "pt", "bike", "ped", "rail"):
    md.append("| %s | %d | %d | %d | %d | %d | %d | %d |\n" % (
        layer, c(layer, "n"), c(layer, "num_yes"), c(layer, "num_no") + c(layer, "num_warn"),
        c(layer, "pl_ok"), c(layer, "pl_fix"), c(layer, "pl_check"), c(layer, "pl_n/a")))
md.append("""
**Most severe findings**

1. **PT placement: 44 sections are confirmed more than 150 m from their own stop poles, and 4 of them are about 3.6 km away.** PR_22A–D ("Rondo Św. Ojca Pio") sit 3.5–3.6 km north of the stop. KW_04B is 2.3 km off, PR_06A 2.0 km and KW_02A 1.1 km. R3_17A–C, KW_20A and KW_21A are 0.7–1.0 km off. All of these were placed with `geo=stop`, and the errors come from `geocode.find_stop`/`_stopkey`:
   - (a) the prefix fallback matches a different stop ("Rondo …", "Wróblowice …", "Wilkszyn …");
   - (b) `_stopkey` drops `(…)`, so "Obornicka (Obwodnica)", "Kiełczowska (Cmentarz)", "Kosmonautów (Szpital)" and similar are matched to the plain-named stop elsewhere;
   - (c) the OSM stops "Bardzka" and "Bardzka (Cmentarz)" are merged into one average. That puts R2_08A–D and R3_09A on one identical coordinate, 0.5–0.6 km from either stop;
   - (d) every OSM node of a large hub is averaged, so street-specific sections land 150–430 m off (Kromera, Metalowców, Dworzec Główny, Galeria Dominikańska, Gajowicka).

   `stage_pt` never reads `overrides.json`. The robust fix is to place PT sections by the `Nr słupka` in 6.4, looked up in GTFS `stop_code`: 214/222 sections resolve that way (6 more by GTFS stop name), and 192 of 219 resolved positions sit within 15 m of the street in `Lokalizacja`.
2. **Node pie: road PR_04 (ul. Powstańców Śląskich) is paired with PT PR_22 (Rondo Św. Ojca Pio), which is really 3.7 km away.** That pie shows the wrong bus and tram loads. With correct PT positions:
   - 6 real same-junction pairs would form: KW_05↔KW_20 (7 m), PR_30↔PR_21 (31 m), R2_07↔R2_04 (92 m), R2_12↔R2_08 (98 m), PR_02↔PR_26 (102 m), and KW_19↔PR_16 (60 m, which is uncertain because the street names differ);
   - 2 existing pairs would drop past 150 m: PR_08↔PR_08 (217 m) and R3_14↔R3_13 (172 m).
3. **Pedestrian category labels are wrong on all 17 PP points.** `PED_MOB2` (copied into meta.json `pedMobility2`) mislabels 4 codes. The source legend in 3.5 `baza` row 2 says code 3 = crutches/canes/prostheses, 4 = pram, 6 = blind, 7 = "małe kółka" (rollers, kick-scooters, children on bikes). The JSON calls them "z wózkiem dziecięcym", "z psem", "o kulach / z balkonikiem" and "z dzieckiem". For example, PP_01 shows "osoba z psem 43", which is really 43 prams; the authors' sheet "Sposób poruszania" agrees with the code reading. The counts are right; the "Cechy dodatkowe" panel shows the wrong names.
4. **Bike placement: 9 confirmed errors.** 5 of them are entries in `overrides.json`:
   - RR_08 is 662 m off: it was snapped to ul. Oławska instead of Promenada Oławska;
   - RR_30, RR_31 and RR_32B are 280–470 m off their embankments (cross-centroid fallback);
   - the RR_21A/B override is 190 m off ul. Hallera;
   - the RR_26 and RR_27 overrides are 1.2–1.5 km from their promenade stretches (RR_27's override sits roughly where RR_26 belongs);
   - the RR_13 override is the park centroid, about 400 m from the Pilczycka–Milenijna link the source describes.
5. **Road "Cała doba" mixes 8-, 16- and 24-hour sums.** The 18 KO_* points were counted only 6–10 and 15–19, 179 points ran 5–21 and 45 ran 24 h. The app treats every road total as whole-day (meta `expansion.road.factor = 1.0`, note "całą dobę lub 5:00–21:00"), so the KO totals are 8-h sums ranked against day sums. The numbers themselves match the source exactly.

**Clean results**

- **Road numbers:** all 244 points match the raw rows exactly (total, peak, 24 hourly values, every direction × hour × category cell, quarter-hours, off-carriageway). The 115 points also in the authors' "Porównanie KBR" sheet equal its 2024 totals. Units are vehicles counted per hour, not PCU/"E". All 14 categories are included (bikes and UTO on the carriageway, and trams), which is how the authors count too.
- **Road placement:** every JSON coordinate equals the workbook (0 m), the 3.4 copy agrees, and no coordinates are swapped or outside the region. Of 244, 208 are within 60 m of their named way and 5 more sit on the bridge that carries it. Another 5 were reviewed by hand and are fine: cordon points on the street's continuation, a source typo, and the A8 bridge. That makes 218 OK.
- **Bike, PT and rail numbers:** these match the raw data, the authors' summary sheets (bike "Sumaryczne dane"; ped "DANE SUMARYCZNE"; PT sheet 6.7 boarding/alighting) and all breakdowns.
- **Pedestrian placement:** all 17 points are OK.
- **Rail stations:** all are placed at their OSM station.
- **Duplicates:** no duplicated or dropped point ids in any layer.

**Source-side issues** (not pipeline errors; the JSON follows the raw rows)

- 6.4's own pivot sheets (6.4, 6.9) disagree with its data rows for 6 points. R1_11 is the large one: 52,096 in the pivot vs 65,276 in the rows (+25%; the rows are higher in every hour, by 10–34%). The others are small: PR_03 +66, R2_05 +37, R3_06 +19, R2_13 +5, PR_01 +3. Resolved: the pivots are stale, not wrong data. They were last refreshed on 2024-09-23 from the same data rows (`DANE - potoki pasażerskie`, K4:W34218); refreshing them in Excel on a copy gives 65,276 for R1_11 and matches the data rows for all 103 points. The data rows, which the map uses, are right.
- 6.3 lists PR_02B twice; the second row (Kazimierza Wielkiego/Nowy Świat, Rynek poles) is the PR_02C that exists in the data. PR_02C, PR_03C, PR_03D, PR_21C, R2_04C and R2_11C have data but no 6.3 row.
- KW_01B is in 6.3 but has no data: both poles were coded KW_01A in 6.4.
- 5 PT rows have a blank passenger count (R2_08D ×2, R3_06A ×2, R3_06D). They are counted as vehicles with 0 passengers, which matters very little.
- 440 PT rows at hh:00 fall in the previous quarter-hour but the next hour. The JSON uses "Godzina", consistent with the authors' "Godzina Rap".
- Road KW_09 is spelled "Opatkowicka" in the source; the OSM street is "Opatowicka".
- Road KW_02 is named ul. Widawska, but its "Odcinek" and coordinates are ul. Pawłowicka.

**Not checkable:** the placement of 25 road points:
- 18 KO_* points: outside the OSM cache bbox or unnamed (road refs only);
- 7 A8/S5 slip roads ("łącznica"): no name.

KW_11A and KW_18A (suburban operators) have no GTFS pole, so their placement has no independent reference.
""")

md.append("\n## Flagged points\n\n### Road: numbers (warn, 18)\n\nIn every case the total is an exact sum of the raw rows, but it covers only 8 hours. Suggested fix: give KO_* its own window and expansion in `meta.windows`, or label it and leave it out of whole-day rankings.\n\n")
md.append(tbl(["id", "name", "problem", "evidence"], [r[:4] for r in F["road_num"]]) + "\n")
md.append("\n### Road: placement (check, 1)\n\n")
md.append(tbl(["id", "name", "status", "evidence", "suggested fix"], F["road"]) + "\n")
md.append("""
Road points that look far from their named street but were reviewed and are OK:
- On a bridge that carries the street: R1_14, R1_21A, R2_15B, R2_19, R2_21, R3_13, and AOW_04 (most Rędziński = A8).
- Cordon points on the street's continuation outside the city: KW_02, KW_04, KW_12 (77–147 m from the boundary).
- 7 points are within 62–164 m outside a very short "Odcinek" (PR_01A, PR_02A, PR_04, PR_05, PR_11B, R2_02A, R2_08A). This is minor and noted in the CSV.

All of these have notes in the CSV.

### Bike: placement (9 fix, 4 check)

Suggested positions are derived independently:
- Embankment, promenade and footbridge points: the midpoint between where the two "Odcinek" streets meet the named feature (OSM waterway or path from the extra Overpass pull), snapped onto it.
- RR_21: the OSM Hallera×railway crossing and Nominatim's "Hallera 81".
- RR_26 and RR_27: the cross streets, plus Nominatim for Pirenejska and Cmentarz Ducha Świętego (about ±150 m, because the promenade is not a named OSM way there).
- RR_13: approximate.
""")
md.append(tbl(["id", "name", "status", "problem / evidence", "suggested fix (overrides.json)"], F["bike"]) + "\n")
md.append("""
`overrides.json` review:
- RR_32A is fine (on Jaz Psie Pole).
- RR_13, RR_21A, RR_21B, RR_26 and RR_27 are wrong; see above.
- The RR_21A/B and RR_26/RR_27 pairs each look like copy or shift mistakes.

### Pedestrians: numbers (17 points, all mislabelled)

Code-to-label mapping, the JSON label against the source legend (3.5 `baza`, row 2):

""")
md.append(tbl(["code", "JSON/meta label", "source legend"], B["ped_mob2_labels"]) + "\n")
md.append("""
Fix: the `PED_MOB2` map in etl/build.py; the meta.json `pedMobility2` label map is wrong in the same way. Every PP point carries at least one of codes 3, 4 or 7, so all 17 are affected. Totals, hours, directions, sex, side and period all match.

### PT: placement (44 fix, 1 check, 2 n/a)

The reference is the mean of the GTFS positions of the section's own poles, taken from the 6.4 "Nr słupka" column (6.3 is the fallback). Its distance to the `Lokalizacja` street is shown as evidence: within 15 m for 192 of 219 sections, within 30 m for 204. GTFS feed 2026-08, so a stop moved since 2024 is possible but unlikely at this scale.

`stage_pt` ignores `overrides.json`. Applying these values needs either a small code change (read overrides there), or a switch to pole-based placement, which is preferable.
""")
md.append(tbl(["id", "stop / Lokalizacja", "status", "evidence", "suggested fix"], F["pt"]) + "\n")
md.append("""
Also, between 75 and 150 m from their poles: 60 sections, mostly multi-street hubs averaged onto one stop centroid. They are listed with distances in the CSV. Not checkable: KW_11A and KW_18A, which have suburban poles not in the city GTFS. KW_18A is 1 m from Wilczycka; KW_11A is 159 m from "Lipowa".

### Rail: placement (3 check)

Station coordinates are fine. Each cordon marker is the mean of every station that appears in its runs, including distant ones (Środa Śląska, Kąty Wr., Żórawina, Oborniki Śląskie). As a result, 9 of 11 markers lie outside the city, and K6, K7 and K8 are about 2 km from where their line crosses the boundary.

The reference used here is crude: the straight line between the innermost Wrocław station and the nearest outer station, intersected with the OSM city boundary. `stage_rail` reads overrides keyed by station name, not cordon id.
""")
md.append(tbl(["id", "stations", "status", "evidence", "suggested [lat, lon]"], F["rail"]) + "\n")

md.append("\n## Road↔PT nodes (`attachSplits`, PAIR_RADIUS 150 m)\n\nThe app logic was replayed on merged nodes: mean of the member sections, then greedy pairing, nearest first. \"true\" is the distance after replacing the PT position with its pole reference. It forms %d pairs; the rest are OK (same streets, 8–140 m).\n\n" % len(N["nodes"]))
md.append(tbl(["road", "pt", "app dist m", "true dist m", "road streets", "pt streets (stops)", "status", "why"],
              [n for n in N["nodes"] if n[6] != "ok"]) + "\n")
md.append("""
Notes on these pairs:
- PR_03↔PR_04 is in fact the same junction: road section PR_03A is "ul. Traugutta, ul. Podwale – ul. Krasińskiego".
- R3_08↔R3_07: one of its stops is named "Wyścigowa".
- KW_06↔KW_19 and KW_09↔KW_16 are cordon roads that change name at the city border.

These four are probably fine.

Pairs that would form with correct PT positions but are missed now:

""")
md.append(tbl(["road", "pt", "true dist m", "app dist m", "road streets", "pt streets"],
              [[m["road"], m["pt"], m["dist_true_m"], m["dist_app_m"], "; ".join(m["road_names"]), "; ".join(m["pt_locs"])]
               for m in N["missed"]]) + "\n")
md.append("""
## Identical-coordinate clusters

There are 57 groups:
- **48 PT groups.** Each is the sections of one point sharing a stop centroid; 44 of them span different streets. This is by design (the app fans them onto a 20 m ring), but it hides the street-level position. Pole-based placement would separate them.
- **1 cross-point PT group, a confirmed error:** R2_08A–D and R3_09A at [51.07795, 17.05126]. These are two different stops 1.2 km apart, averaged together.
- **8 bike/ped groups, expected:** A/B sides of the same bike section (RR_06, RR_11, RR_14, RR_15, RR_21, RR_23), plus RR_02/PP_08 and RR_09/PP_07 on the same footbridge or bridge.

## Re-running

Run these from the repo root with Python 3.12, using `-I` for every command:

1. `reports/audit/extract_raw.py` reads all the workbooks (3–5 min). It writes `cache/raw.json`.
2. `probe_pt.py` writes the 6.4 poles per section.
3. `check_numbers.py` and `check_breakdowns.py` run the numbers checks.
4. `fetch_osm_extra.py` and `fetch_boundary.py` are one-off Overpass pulls; their results are cached.
5. `check_placement.py`, then `special.py`.
6. `nominatim_probe.py` makes 5 cached lookups, used as evidence only.
7. `build_report.py` writes the CSV, then `write_md.py` writes this file.

The helpers are in `geo.py`: distances, name matching that ignores diacritics, prefixes and Polish inflection, and the boundary.
""")
open(os.path.join(ROOT, "reports", "point-audit.md"), "w", encoding="utf8").write("".join(md))
print("written")
