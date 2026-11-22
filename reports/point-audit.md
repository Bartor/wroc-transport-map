# KBR 2024 map: point audit (numbers and placement)

Checked every point in `public/data/` against the raw files in `data/`, using a separate re-read of the workbooks. The pipeline code was not reused. Placement was checked against OSM named ways (`etl/cache/overpass_roads.json`), the city's GTFS stop poles (`etl/cache/gtfs_127.zip`, `stop_code` = MPK pole number from 6.3/6.4), the Wrocław boundary, and an extra one-off Overpass pull of waterways, footpaths and railways. Scripts: `reports/audit/` (how to re-run is at the bottom). Per-point results: `reports/point-audit.csv`.

**Status words.** `fix` means a confirmed error. `check` means probably wrong or the evidence is weak. `n/a` means the check could not be done.


## Status after fixes (2026-11-22)

Re-run of `check_numbers`, `check_breakdowns`, `check_placement` and `build_report` on the rebuilt data. `point-audit.csv` holds the current per-point results; the sections below "Summary" are the findings as first reported.

| layer | points | numbers OK | placement OK | remaining |
|---|---|---|---|---|
| road | 244 | 244 | 218 | 18 KO_* are 8-hour counts (now flagged in the app, see below); KW_26 is an OSM naming gap; 25 are not checkable by name |
| pt | 222 | 222 | 220 | KW_11A, KW_18A have no pole in the city timetable (no independent reference) |
| bike | 43 | 43 | 43 | — |
| ped | 17 | 17 | 17 | — |
| rail | 11 | 11 | 11 | — |

What changed:
- **PT** sections are placed by their own stop poles (6.4 `Nr słupka` → timetable `stop_code`): 214 by pole, 5 by timetable stop name, 3 by the old OSM name lookup. All 220 with a reference are within 20 m of it except R1_06A and R1_06D (Dworzec Główny, poles not in the timetable; 60–80 m).
- **Node pies:** 36 road↔PT pairs, all at the same junction; PR_04 is no longer paired with PR_22.
- **Pedestrian** categories use the codes from the 3.5 legend.
- **Bike:** RR_08, RR_11A/B, RR_13, RR_20, RR_21A/B, RR_26, RR_27, RR_30, RR_31, RR_32B and RR_33 are placed by hand in `etl/overrides.json`, each with its reason.
- **KO_*** sections carry `window` (6–10, 15–19): the app warns when the period goes past it, expands them with their own factor (×1.913, from the 45 round-the-clock sections) under "Szacuj całą dobę", and labels their total as an 8-hour sum.
- **Rail** cordon markers sit where the shortest city→outside hop crosses the city boundary.

## Summary

| layer | points | numbers OK | numbers flagged | placement OK | placement fix | placement check | placement n/a |
|---|---|---|---|---|---|---|---|
| road | 244 | 226 | 18 | 218 | 0 | 1 | 25 |
| pt | 222 | 222 | 0 | 175 | 44 | 1 | 2 |
| bike | 43 | 43 | 0 | 30 | 9 | 4 | 0 |
| ped | 17 | 0 | 17 | 17 | 0 | 0 | 0 |
| rail | 11 | 11 | 0 | 8 | 0 | 3 | 0 |

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

## Flagged points

### Road: numbers (warn, 18)

In every case the total is an exact sum of the raw rows, but it covers only 8 hours. Suggested fix: give KO_* its own window and expansion in `meta.windows`, or label it and leave it out of whole-day rankings.

| id | name | problem | evidence |
|---|---|---|---|
| KO_01 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 8021 |
| KO_02 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 1153 |
| KO_03 | Na wysokości wiaduktu drogowego nad A4 na drodze Piotrowice-Stróża | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 27196 |
| KO_04 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 8315 |
| KO_05 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 8614 |
| KO_06 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 3936 |
| KO_07 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 778 |
| KO_08 | Na wysokości wiaduktu drogowego nad A4 na drodze Chwastnica-Piskorzów | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 23181 |
| KO_09 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 7631 |
| KO_10 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 4589 |
| KO_11 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 9545 |
| KO_12 | Na wysokości wiaduktu drogowego nad S8 na drodze Jenkowice-Stępin | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 18805 |
| KO_13 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 3909 |
| KO_14 | Na wysokości wiaduktu drogowego nad S5 na wysokości Ligoty Pięknej | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 18653 |
| KO_15 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 3618 |
| KO_16 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 350 |
| KO_17 | - | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 2192 |
| KO_18 | Most Wolności w Brzegu Dolnym | 8-hour count presented as daily total | hours with data: [6, 7, 8, 9, 15, 16, 17, 18]; total 4762 |

### Road: placement (check, 1)

| id | name | status | evidence | suggested fix |
|---|---|---|---|---|
| KW_26 | ul. Trzmielowicka | check | 1 m from the city boundary as 'na granicy Wrocławia' says, but on a way OSM names 'Wrocławska'; OSM 'Trzmielowicka' ends 2.4 km east. Coordinates consistent with the description; naming gap in OSM likely; 1 m from city boundary (inside) | - |

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
| id | name | status | problem / evidence | suggested fix (overrides.json) |
|---|---|---|---|---|
| RR_08 | Promenada Oławska | fix | street-centroid of the WRONG street: geocoder strips 'Promenada' and lands on ul. Oławska in the Old Town; Promenada Oławska (path): point 662 m from feature, 667 m from reference | "RR_08": [51.10497, 17.05151]  (Promenada Oławska (path): ends meet feature at [51.104929, 17.051572] (0 m off) and [51.105566, 17.051315] (62 m off)) |
| RR_11A | ul. Dmowskiego | check | placed at the Dmowskiego/Księcia Witolda junction ('one-intersection'); ~70 m outside the Witolda-Jagiełły segment by our crossing estimate - minor | snap to nearest point of Romana Dmowskiego |
| RR_11B | ul. Dmowskiego | check | same coordinates as RR_11A (other side of the street) - minor | snap to nearest point of Romana Dmowskiego |
| RR_13 | Park Zachodni | fix | manual override = Nominatim centroid of Park Zachodni, ~370-400 m from both Pilczycka and Milenijna; source describes a cobbled link road between them; 2309 m from nearest way named like 'Park Zachodni' (Zachodnia); link Pilczycka-Milenijna: point None m from feature, 424 m from reference | "RR_13": [51.12996, 16.9799]  (midpoint of the closest approach of Pilczycka [51.13046,16.97803] and Milenijna [51.12945,16.98177] (the cobbled link between them) - approx) |
| RR_20 | kładka nad rzeką Ślęzą | check | cross-centroid fallback; 59 m from the Ślęza but 154 m from the stretch between Trawowa and Francuska; the footbridge itself is not a named OSM way - uncertain; Ślęza river: point 59 m from feature, 154 m from reference | "RR_20": [51.10296, 16.95759]  (Ślęza river: ends meet feature at [51.102149, 16.957051] (53 m off) and [51.103837, 16.962905] (377 m off)) |
| RR_21A | ul. Hallera | fix | manual override is 190 m off ul. Hallera (between Saperów and Modlińska); 190 m from nearest way named like 'ul. Hallera' (aleja Generała Józefa Hallera); Hallera x railway: point 190 m from feature, 335 m from reference | "RR_21A": [51.09014, 16.99654]  (midpoint of Hallera x railway crossing [51.09006,16.99597] (OSM) and Hallera 81 [51.09022,16.99711] (Nominatim)) |
| RR_21B | ul. Hallera | fix | manual override is 190 m off ul. Hallera (between Saperów and Modlińska); 190 m from nearest way named like 'ul. Hallera' (aleja Generała Józefa Hallera) | "RR_21B": [51.09014, 16.99654]  (midpoint of Hallera x railway crossing [51.09006,16.99597] (OSM) and Hallera 81 [51.09022,16.99711] (Nominatim)) |
| RR_26 | Promenada Krzycka | fix | manual override is ~1.2 km W of the Borowska-Pirenejska stretch (it sits by Ślężna); 665 m from nearest way named like 'Promenada Krzycka' (Krzycka); Promenada Krzycka (path): point 1599 m from feature, None m from reference | "RR_26": [51.0731, 17.0349]  (midpoint of Borowska [51.07318,17.03264] and Pirenejska [51.0730,17.03711] at the latitude Nominatim gives for Pirenejska; promenade path itself is not named in OSM there (approx +-150 m)) |
| RR_27 | Promenada Krzycka | fix | manual override is ~1.5 km from the Bardzka-Ziębicka stretch at Cmentarz Ducha Świętego (it sits by Borowska, i.e. roughly where RR_26 belongs); 1851 m from nearest way named like 'Promenada Krzycka' (Krzycka); Promenada Krzycka (path): point 2612 m from feature, None m from reference | "RR_27": [51.0731, 17.0569]  (midpoint of Bardzka [51.07248,17.0532] and Ziębicka [51.07380,17.06058] beside Cmentarz Ducha Świętego [51.07255,17.05645] (Nominatim) (approx +-150 m)) |
| RR_30 | wały przy Starej Odrze | fix | cross-centroid fallback (midpoint of the two cross-street centroids) - lands on pl. Grunwaldzki, not on the Stara Odra embankment; Stara Odra: point 279 m from feature, 306 m from reference | "RR_30": [51.11249, 17.07109]  (Stara Odra: ends meet feature at [51.116764, 17.070146] (89 m off) and [51.108487, 17.069157] (41 m off)) |
| RR_31 | wały przy Kanale Powodziowy rzeki Odry | fix | cross-centroid fallback - not on the Kanał Powodziowy embankment; Kanał Powodziowy: point 465 m from feature, 466 m from reference | "RR_31": [51.12758, 17.0785]  (Kanał Powodziowy: ends meet feature at [51.126798, 17.076532] (97 m off) and [51.126549, 17.080208] (104 m off)) |
| RR_32B | wały przy Kanale Żeglugowym rzeki Odry | fix | cross-centroid fallback - not on the Kanał Żeglugowy embankment; Kanał Żeglugowy: point 372 m from feature, 384 m from reference | "RR_32B": [51.12998, 17.06109]  (Kanał Żeglugowy: ends meet feature at [51.131365, 17.058975] (59 m off) and [51.130222, 17.064308] (97 m off)) |
| RR_33 | ul. Bora Komorowskiego | check | intersection midpoint lands 94 m from Bora-Komorowskiego (13 m from al. Sobieskiego) - probably on the wrong carriageway/approach; snap to Bora-Komorowskiego; 94 m from nearest way named like 'ul. Bora Komorowskiego' (Generała Tadeusza Bora-Komorowskiego) | snap to nearest point of Generała Tadeusza Bora-Komorowskiego |

`overrides.json` review:
- RR_32A is fine (on Jaz Psie Pole).
- RR_13, RR_21A, RR_21B, RR_26 and RR_27 are wrong; see above.
- The RR_21A/B and RR_26/RR_27 pairs each look like copy or shift mistakes.

### Pedestrians: numbers (17 points, all mislabelled)

Code-to-label mapping, the JSON label against the source legend (3.5 `baza`, row 2):

| code | JSON/meta label | source legend |
|---|---|---|
| 1 | osoba starsza (60+) z problemami z poruszaniem się | osoba starsza (60+), która ma problemy z poruszaniem się |
| 2 | osoba z bagażem | osoba przenosząca bagaż (bagaż rozumiany jako torba na kółkach lub podręczna, większa od stanrdowej torebki) |
| 3 | osoba z wózkiem dziecięcym | osoba poruszająca się przy pomocy kul, lasek i protez |
| 4 | osoba z psem | osoba z wózkiem dziecięcym |
| 5 | osoba na wózku inwalidzkim | osoba na wózku inwalidzkim |
| 6 | osoba o kulach / z balkonikiem | osoba niewidoma |
| 7 | osoba z dzieckiem | osoba użytkująca ,,małe kółka" (rolki, zwykła hulajnoga, dzieci na rowerkach) |
| 8 | inne | inne |

Fix: the `PED_MOB2` map in etl/build.py; the meta.json `pedMobility2` label map is wrong in the same way. Every PP point carries at least one of codes 3, 4 or 7, so all 17 are affected. Totals, hours, directions, sex, side and period all match.

### PT: placement (44 fix, 1 check, 2 n/a)

The reference is the mean of the GTFS positions of the section's own poles, taken from the 6.4 "Nr słupka" column (6.3 is the fallback). Its distance to the `Lokalizacja` street is shown as evidence: within 15 m for 192 of 219 sections, within 30 m for 204. GTFS feed 2026-08, so a stop moved since 2024 is possible but unlikely at this scale.

`stage_pt` ignores `overrides.json`. Applying these values needs either a small code change (read overrides there), or a switch to pole-based placement, which is preferable.
| id | stop / Lokalizacja | status | evidence | suggested fix |
|---|---|---|---|---|
| KW_01A | Pracze Odrzańskie (stacja kolejowa) / Stabłowicka | fix | JSON [51.17313, 16.90483] is 200 m from poles mean [51.17177, 16.90294]; ref is 1 m from 'Stabłowicka'. '(…)' qualifier dropped by _stopkey, so 'Pracze Odrzańskie (stacja kolejowa)' was matched to the plain 'Pracze Odrzańskie' stop elsewhere | "KW_01A": [51.17177, 16.90294]  (mean of GTFS stop_code positions of the section's poles) |
| KW_02A | Wilkszyn - Miłoszyn / Marszowicka | fix | JSON [51.19171, 16.86295] is 1099 m from poles mean [51.18352, 16.87179]; ref is 0 m from 'Marszowicka'. find_stop prefix fallback matched a different stop ('Wilkszyn - Miłoszyn' -> a stop named 'Wilkszyn...') | "KW_02A": [51.18352, 16.87179]  (mean of GTFS stop_code positions of the section's poles) |
| KW_04B | Wróblowice Innowacyjna / Wróblowice - Innowacyjna | fix | JSON [51.15829, 16.78336] is 2256 m from poles mean [51.15313, 16.81464]; ref is 21 m from 'Wróblowice - Innowacyjna'. find_stop prefix fallback matched a different stop ('Wróblowice Innowacyjna' -> a stop named 'Wróblowice...') | "KW_04B": [51.15313, 16.81464]  (mean of GTFS stop_code positions of the section's poles) |
| KW_07A | Muchobór Wielki / Stanisławowska | fix | JSON [51.10034, 16.94277] is 187 m from poles mean [51.09889, 16.94141]; ref is 1 m from 'Stanisławowska'. all OSM nodes named 'Muchobór Wielki' averaged (other directions/platforms of a large hub); section is on Stanisławowska | "KW_07A": [51.09889, 16.94141]  (mean of GTFS stop_code positions of the section's poles) |
| KW_20A | Kiełczowska (Cmentarz) / Kiełczowska | fix | JSON [51.14579, 17.13625] is 925 m from poles mean [51.14502, 17.14946]; ref is 13 m from 'Kiełczowska'. '(…)' qualifier dropped by _stopkey, so 'Kiełczowska (Cmentarz)' was matched to the plain 'Kiełczowska' stop elsewhere | "KW_20A": [51.14502, 17.14946]  (mean of GTFS stop_code positions of the section's poles) |
| KW_21A | Bierutowska (Wiadukt) / Bierutowska | fix | JSON [51.15466, 17.13817] is 745 m from poles mean [51.15833, 17.14712]; ref is 3 m from 'Bierutowska'. '(…)' qualifier dropped by _stopkey, so 'Bierutowska (Wiadukt)' was matched to the plain 'Bierutowska' stop elsewhere | "KW_21A": [51.15833, 17.14712]  (mean of GTFS stop_code positions of the section's poles) |
| PR_03C | Wzgórze Partyzantów / Podwale | fix | JSON [51.10505, 17.03703] is 174 m from poles mean [51.10379, 17.03849]; ref is 9 m from 'Podwale'. no OSM stop named 'Wzgórze Partyzantów'; fell back to the point name and landed on PR_03A's 'Park Staromiejski' stop | "PR_03C": [51.10379, 17.03849]  (mean of GTFS stop_code positions of the section's poles) |
| PR_03D | Wzgórze Partyzantów / Kołłątaja | fix | JSON [51.10505, 17.03703] is 153 m from poles mean [51.10368, 17.03728]; ref is 5 m from 'Kołłątaja'. no OSM stop named 'Wzgórze Partyzantów'; fell back to the point name and landed on PR_03A's 'Park Staromiejski' stop | "PR_03D": [51.10368, 17.03728]  (mean of GTFS stop_code positions of the section's poles) |
| PR_06A | Grabiszyńska / Zaporoska | fix | JSON [51.09336, 16.98856] is 1956 m from poles mean [51.10142, 17.01347]; ref is 8 m from 'Zaporoska'. the OSM node(s) keyed 'grabiszyńska' (after dropping '(…)') are a different place 1956 m away | "PR_06A": [51.10142, 17.01347]  (mean of GTFS stop_code positions of the section's poles) |
| PR_16A | Klecina (Stacja kolejowa) / Kobierzycka | fix | JSON [51.06185, 16.98756] is 411 m from poles mean [51.05816, 16.98791]; ref is 14 m from 'Kobierzycka'. '(…)' qualifier dropped by _stopkey, so 'Klecina (Stacja kolejowa)' was matched to the plain 'Klecina' stop elsewhere | "PR_16A": [51.05816, 16.98791]  (mean of GTFS stop_code positions of the section's poles) |
| PR_21A | Kosmonautów (Szpital) / Kosmonautów | fix | JSON [51.14095, 16.91086] is 355 m from poles mean [51.14181, 16.90596]; ref is 7 m from 'Kosmonautów'. '(…)' qualifier dropped by _stopkey, so 'Kosmonautów (Szpital)' was matched to the plain 'Kosmonautów' stop elsewhere | "PR_21A": [51.14181, 16.90596]  (mean of GTFS stop_code positions of the section's poles) |
| PR_21B | Kosmonautów (Szpital) / Fieldorfa | fix | JSON [51.14095, 16.91086] is 379 m from poles mean [51.14248, 16.90601]; ref is 9 m from 'Fieldorfa'. '(…)' qualifier dropped by _stopkey, so 'Kosmonautów (Szpital)' was matched to the plain 'Kosmonautów' stop elsewhere | "PR_21B": [51.14248, 16.90601]  (mean of GTFS stop_code positions of the section's poles) |
| PR_21C | Kosmonautów (Szpital) / 11 Listopada | fix | JSON [51.14095, 16.91086] is 402 m from poles mean [51.14161, 16.90520]; ref is 1 m from '11 Listopada'. '(…)' qualifier dropped by _stopkey, so 'Kosmonautów (Szpital)' was matched to the plain 'Kosmonautów' stop elsewhere | "PR_21C": [51.14161, 16.90520]  (mean of GTFS stop_code positions of the section's poles) |
| PR_22A | Rondo Św. Ojca Pio / Ołtaszyńska | fix | JSON [51.09131, 17.01706] is 3534 m from poles mean [51.06010, 17.00751]; ref is 3 m from 'Ołtaszyńska'. find_stop prefix fallback matched a different stop ('Rondo Św. Ojca Pio' -> a stop named 'Rondo...') | "PR_22A": [51.06010, 17.00751]  (mean of GTFS stop_code positions of the section's poles) |
| PR_22B | Rondo Św. Ojca Pio / Zwycięska | fix | JSON [51.09131, 17.01706] is 3613 m from poles mean [51.05932, 17.00793]; ref is 6 m from 'Zwycięska'. find_stop prefix fallback matched a different stop ('Rondo Św. Ojca Pio' -> a stop named 'Rondo...') | "PR_22B": [51.05932, 17.00793]  (mean of GTFS stop_code positions of the section's poles) |
| PR_22C | Rondo Św. Ojca Pio / Ołtaszyńska | fix | JSON [51.09131, 17.01706] is 3642 m from poles mean [51.05919, 17.00687]; ref is 8 m from 'Ołtaszyńska'. find_stop prefix fallback matched a different stop ('Rondo Św. Ojca Pio' -> a stop named 'Rondo...') | "PR_22C": [51.05919, 17.00687]  (mean of GTFS stop_code positions of the section's poles) |
| PR_22D | Rondo Św. Ojca Pio / Zwycięska | fix | JSON [51.09131, 17.01706] is 3611 m from poles mean [51.05959, 17.00594]; ref is 3 m from 'Zwycięska'. find_stop prefix fallback matched a different stop ('Rondo Św. Ojca Pio' -> a stop named 'Rondo...') | "PR_22D": [51.05959, 17.00594]  (mean of GTFS stop_code positions of the section's poles) |
| PR_26B | Galeria Dominikańska / Kazimierza Wielkiego | fix | JSON [51.10822, 17.03967] is 161 m from poles mean [51.10802, 17.03738]; ref is 35 m from 'Kazimierza Wielkiego'. all OSM nodes named 'Galeria Dominikańska' averaged (other directions/platforms of a large hub); section is on Kazimierza Wielkiego | "PR_26B": [51.10802, 17.03738]  (mean of GTFS stop_code positions of the section's poles) |
| PR_26C | Galeria Dominikańska / Piotra Skargi | fix | JSON [51.10822, 17.03967] is 195 m from poles mean [51.10671, 17.03827]; ref is 3 m from 'Piotra Skargi'. all OSM nodes named 'Galeria Dominikańska' averaged (other directions/platforms of a large hub); section is on Piotra Skargi | "PR_26C": [51.10671, 17.03827]  (mean of GTFS stop_code positions of the section's poles) |
| R1_06B | Dworzec Główny / Peronowa | fix | JSON [51.10018, 17.03622] is 177 m from poles mean [51.09921, 17.03422]; ref is 8 m from 'Peronowa'. all OSM nodes named 'Dworzec Główny' averaged (other directions/platforms of a large hub); section is on Peronowa | "R1_06B": [51.09921, 17.03422]  (mean of GTFS stop_code positions of the section's poles) |
| R1_06F | Dworzec Główny (Dworcowa) / Kościuszki | fix | JSON [51.10018, 17.03622] is 296 m from poles mean [51.10111, 17.04020]; ref is 8 m from 'Kościuszki'. '(…)' qualifier dropped by _stopkey, so 'Dworzec Główny (Dworcowa)' was matched to the plain 'Dworzec Główny' stop elsewhere | "R1_06F": [51.10111, 17.04020]  (mean of GTFS stop_code positions of the section's poles) |
| R1_06H | Dworzec Główny (Dworcowa) / Dworcowa | fix | JSON [51.10018, 17.03622] is 212 m from poles mean [51.10044, 17.03924]; ref is 8 m from 'Dworcowa'. '(…)' qualifier dropped by _stopkey, so 'Dworzec Główny (Dworcowa)' was matched to the plain 'Dworzec Główny' stop elsewhere | "R1_06H": [51.10044, 17.03924]  (mean of GTFS stop_code positions of the section's poles) |
| R1_07A | Dworzec Autobusowy / Ślężna | fix | JSON [51.09711, 17.03465] is 166 m from poles mean [51.09727, 17.03228]; ref is 4 m from 'Ślężna'. all OSM nodes named 'Dworzec Autobusowy' averaged (other directions/platforms of a large hub); section is on Ślężna | "R1_07A": [51.09727, 17.03228]  (mean of GTFS stop_code positions of the section's poles) |
| R2_04A | Gajowicka / Hallera | fix | JSON [51.08649, 17.00507] is 205 m from poles mean [51.08831, 17.00557]; ref is 3 m from 'Hallera'. all OSM nodes named 'Gajowicka' averaged (other directions/platforms of a large hub); section is on Hallera | "R2_04A": [51.08831, 17.00557]  (mean of GTFS stop_code positions of the section's poles) |
| R2_04B | Gajowicka / Gajowicka | check | JSON [51.08649, 17.00507] is 191 m from poles mean [51.08806, 17.00616]; ref is 1 m from 'Gajowicka'. all OSM nodes named 'Gajowicka' averaged (other directions/platforms of a large hub); section is on Gajowicka | "R2_04B": [51.08806, 17.00616]  (mean of GTFS stop_code positions of the section's poles) |
| R2_04C | Gajowicka / Hallera | fix | JSON [51.08649, 17.00507] is 189 m from poles mean [51.08782, 17.00675]; ref is 8 m from 'Hallera'. all OSM nodes named 'Gajowicka' averaged (other directions/platforms of a large hub); section is on Hallera | "R2_04C": [51.08782, 17.00675]  (mean of GTFS stop_code positions of the section's poles) |
| R2_08A | Bardzka / Bardzka | fix | JSON [51.07795, 17.05126] is 630 m from poles mean [51.08348, 17.04929]; ref is 6 m from 'Bardzka'. OSM stops 'Bardzka' and 'Bardzka (Cmentarz)' merged and averaged - point lands between the two stops | "R2_08A": [51.08348, 17.04929]  (mean of GTFS stop_code positions of the section's poles) |
| R2_08B | Bardzka / Armii Krajowej | fix | JSON [51.07795, 17.05126] is 547 m from poles mean [51.08285, 17.05065]; ref is 1 m from 'Armii Krajowej'. OSM stops 'Bardzka' and 'Bardzka (Cmentarz)' merged and averaged - point lands between the two stops | "R2_08B": [51.08285, 17.05065]  (mean of GTFS stop_code positions of the section's poles) |
| R2_08C | Bardzka / Bardzka | fix | JSON [51.07795, 17.05126] is 513 m from poles mean [51.08239, 17.04932]; ref is 2 m from 'Bardzka'. OSM stops 'Bardzka' and 'Bardzka (Cmentarz)' merged and averaged - point lands between the two stops | "R2_08C": [51.08239, 17.04932]  (mean of GTFS stop_code positions of the section's poles) |
| R2_08D | Bardzka / Armii Krajowej | fix | JSON [51.07795, 17.05126] is 629 m from poles mean [51.08322, 17.04800]; ref is 9 m from 'Armii Krajowej'. OSM stops 'Bardzka' and 'Bardzka (Cmentarz)' merged and averaged - point lands between the two stops | "R2_08D": [51.08322, 17.04800]  (mean of GTFS stop_code positions of the section's poles) |
| R2_09A | Armii Krajowej (Bogedaina) / Armii Krajowej | fix | JSON [51.08640, 17.06766] is 171 m from poles mean [51.08544, 17.06576]; ref is 7 m from 'Armii Krajowej'. '(…)' qualifier dropped by _stopkey, so 'Armii Krajowej (Bogedaina)' was matched to the plain 'Armii Krajowej' stop elsewhere | "R2_09A": [51.08544, 17.06576]  (mean of GTFS stop_code positions of the section's poles) |
| R2_14A | Kromera / al. Kromera | fix | JSON [51.13400, 17.06745] is 252 m from poles mean [51.13202, 17.06571]; ref is 53 m from 'al. Kromera'. all OSM nodes named 'Kromera' averaged (other directions/platforms of a large hub); section is on al. Kromera | "R2_14A": [51.13202, 17.06571]  (mean of GTFS stop_code positions of the section's poles) |
| R2_14B | Kromera / Toruńska | fix | JSON [51.13400, 17.06745] is 298 m from poles mean [51.13173, 17.06519]; ref is 13 m from 'Toruńska'. all OSM nodes named 'Kromera' averaged (other directions/platforms of a large hub); section is on Toruńska | "R2_14B": [51.13173, 17.06519]  (mean of GTFS stop_code positions of the section's poles) |
| R2_14C | Kromera / al. Kromera | fix | JSON [51.13400, 17.06745] is 426 m from poles mean [51.13165, 17.06263]; ref is 10 m from 'al. Kromera'. all OSM nodes named 'Kromera' averaged (other directions/platforms of a large hub); section is on al. Kromera | "R2_14C": [51.13165, 17.06263]  (mean of GTFS stop_code positions of the section's poles) |
| R2_14D | Kromera / Boya-Żeleńskiego | fix | JSON [51.13400, 17.06745] is 359 m from poles mean [51.13238, 17.06301]; ref is 11 m from 'Boya-Żeleńskiego'. all OSM nodes named 'Kromera' averaged (other directions/platforms of a large hub); section is on Boya-Żeleńskiego | "R2_14D": [51.13238, 17.06301]  (mean of GTFS stop_code positions of the section's poles) |
| R2_14E | Kromera / al. Kromera | fix | JSON [51.13400, 17.06745] is 255 m from poles mean [51.13222, 17.06515]; ref is 9 m from 'al. Kromera'. all OSM nodes named 'Kromera' averaged (other directions/platforms of a large hub); section is on al. Kromera | "R2_14E": [51.13222, 17.06515]  (mean of GTFS stop_code positions of the section's poles) |
| R2_17B | Osobowicka (Cmentarz) / Osobowicka | fix | JSON [51.13492, 17.00797] is 368 m from poles mean [51.13555, 17.00279]; ref is 4 m from 'Osobowicka'. '(…)' qualifier dropped by _stopkey, so 'Osobowicka (Cmentarz)' was matched to the plain 'Osobowicka' stop elsewhere | "R2_17B": [51.13555, 17.00279]  (mean of GTFS stop_code positions of the section's poles) |
| R3_01A | Metalowców / Lotnicza | fix | JSON [51.13124, 16.95628] is 200 m from poles mean [51.13267, 16.95800]; ref is 7 m from 'Lotnicza'. all OSM nodes named 'Metalowców' averaged (other directions/platforms of a large hub); section is on Lotnicza | "R3_01A": [51.13267, 16.95800]  (mean of GTFS stop_code positions of the section's poles) |
| R3_01B | Metalowców / Hutnicza | fix | JSON [51.13124, 16.95628] is 291 m from poles mean [51.13309, 16.95922]; ref is 5 m from 'Hutnicza'. all OSM nodes named 'Metalowców' averaged (other directions/platforms of a large hub); section is on Hutnicza | "R3_01B": [51.13309, 16.95922]  (mean of GTFS stop_code positions of the section's poles) |
| R3_01C | Metalowców / Górnicza | fix | JSON [51.13124, 16.95628] is 290 m from poles mean [51.13383, 16.95673]; ref is 4 m from 'Górnicza'. all OSM nodes named 'Metalowców' averaged (other directions/platforms of a large hub); section is on Górnicza | "R3_01C": [51.13383, 16.95673]  (mean of GTFS stop_code positions of the section's poles) |
| R3_09A | Bardzka (Cmentarz) / Bardzka | fix | JSON [51.07795, 17.05126] is 599 m from poles mean [51.07268, 17.05307]; ref is 3 m from 'Bardzka'. '(…)' qualifier dropped by _stopkey, so 'Bardzka (Cmentarz)' was matched to the plain 'Bardzka' stop elsewhere | "R3_09A": [51.07268, 17.05307]  (mean of GTFS stop_code positions of the section's poles) |
| R3_13A | Kowale (Stacja Kolejowa) / Kowalska | fix | JSON [51.13124, 17.10202] is 313 m from poles mean [51.13405, 17.10195]; ref is 0 m from 'Kowalska'. '(…)' qualifier dropped by _stopkey, so 'Kowale (Stacja Kolejowa)' was matched to the plain 'Kowale' stop elsewhere | "R3_13A": [51.13405, 17.10195]  (mean of GTFS stop_code positions of the section's poles) |
| R3_17A | Obornicka (Obwodnica) / Obornicka | fix | JSON [51.15092, 17.01710] is 967 m from poles mean [51.15818, 17.00948]; ref is 1 m from 'Obornicka'. '(…)' qualifier dropped by _stopkey, so 'Obornicka (Obwodnica)' was matched to the plain 'Obornicka' stop elsewhere | "R3_17A": [51.15818, 17.00948]  (mean of GTFS stop_code positions of the section's poles) |
| R3_17B | Obornicka (Obwodnica) / Obornicka | fix | JSON [51.15092, 17.01710] is 816 m from poles mean [51.15705, 17.01069]; ref is 7 m from 'Obornicka'. '(…)' qualifier dropped by _stopkey, so 'Obornicka (Obwodnica)' was matched to the plain 'Obornicka' stop elsewhere | "R3_17B": [51.15705, 17.01069]  (mean of GTFS stop_code positions of the section's poles) |
| R3_17C | Obornicka (Obwodnica) / Nowaka-Jeziorańskiego | fix | JSON [51.15092, 17.01710] is 905 m from poles mean [51.15748, 17.00940]; ref is 20 m from 'Nowaka-Jeziorańskiego'. '(…)' qualifier dropped by _stopkey, so 'Obornicka (Obwodnica)' was matched to the plain 'Obornicka' stop elsewhere | "R3_17C": [51.15748, 17.00940]  (mean of GTFS stop_code positions of the section's poles) |

Also, between 75 and 150 m from their poles: 60 sections, mostly multi-street hubs averaged onto one stop centroid. They are listed with distances in the CSV. Not checkable: KW_11A and KW_18A, which have suburban poles not in the city GTFS. KW_18A is 1 m from Wilczycka; KW_11A is 159 m from "Lipowa".

### Rail: placement (3 check)

Station coordinates are fine. Each cordon marker is the mean of every station that appears in its runs, including distant ones (Środa Śląska, Kąty Wr., Żórawina, Oborniki Śląskie). As a result, 9 of 11 markers lie outside the city, and K6, K7 and K8 are about 2 km from where their line crosses the boundary.

The reference used here is crude: the straight line between the innermost Wrocław station and the nearest outer station, intersected with the OSM city boundary. `stage_rail` reads overrides keyed by station name, not cordon id.
| id | stations | status | evidence | suggested [lat, lon] |
|---|---|---|---|---|
| K6 | Iwiny / Wrocław Główny / Żórawina | check | marker = mean of all from/to stations incl. distant ones; 1795 m from the Wrocław Główny-Iwiny boundary crossing | [51.05904, 17.06569] (straight line Wrocław Główny-Iwiny crosses Wroclaw boundary) |
| K7 | Kąty Wrocławskie / Mokronos Górny / Smolec / Wrocław Grabiszyn / Wrocław Zachodni | check | marker = mean of all from/to stations incl. distant ones; 1986 m from the Wrocław Zachodni-Mokronos Górny boundary crossing | [51.08172, 16.91923] (straight line Wrocław Zachodni-Mokronos Górny crosses Wroclaw boundary) |
| K8 | Miękinia / Mrozów / Wrocław Leśnica / Wrocław Nowy Dwór / Środa Śląska | check | marker = mean of all from/to stations incl. distant ones; 2137 m from the Wrocław Leśnica-Mrozów boundary crossing | [51.16721, 16.82289] (straight line Wrocław Leśnica-Mrozów crosses Wroclaw boundary) |

## Road↔PT nodes (`attachSplits`, PAIR_RADIUS 150 m)

The app logic was replayed on merged nodes: mean of the member sections, then greedy pairing, nearest first. "true" is the distance after replacing the PT position with its pole reference. It forms 33 pairs; the rest are OK (same streets, 8–140 m).

| road | pt | app dist m | true dist m | road streets | pt streets (stops) | status | why |
|---|---|---|---|---|---|---|---|
| KW_06 | KW_19 | 129 | 105 | ul. Szewczenki | Wilczyce - Wrocławska (Wilczyce) | check | street names differ |
| KW_09 | KW_16 | 120 | 132 | ul. Opatkowicka | Trestno - ul. Nadodrzańska (Trestno - Świetlica) | check | street names differ |
| PR_03 | PR_04 | 129 | 132 | ul. Podwale; ul. Traugutta | Krasińskiego (Krasińskiego) | check | street names differ |
| PR_04 | PR_22 | 103 | 3669 | ul. Powstańców Śląskich | Ołtaszyńska; Zwycięska (Rondo Św. Ojca Pio) | fix | only paired because the PT node is misplaced; true distance 3669 m |
| PR_08 | PR_08 | 127 | 217 | Pl. Grunwaldzki | Rondo Reagana (Pl. Grunwaldzki) | check | only paired because the PT node is misplaced; true distance 217 m |
| R3_08 | R3_07 | 61 | 68 | ul. Wyścigowa | Waligórskiego; Wojszycka; Ślężna (Park Południowy; Wyścigowa) | check | street names differ |
| R3_14 | R3_13 | 148 | 172 | ul. Działdowska; ul. Kowalska | Kowalska (Kowale (Stacja Kolejowa)) | check | only paired because the PT node is misplaced; true distance 172 m |

Notes on these pairs:
- PR_03↔PR_04 is in fact the same junction: road section PR_03A is "ul. Traugutta, ul. Podwale – ul. Krasińskiego".
- R3_08↔R3_07: one of its stops is named "Wyścigowa".
- KW_06↔KW_19 and KW_09↔KW_16 are cordon roads that change name at the city border.

These four are probably fine.

Pairs that would form with correct PT positions but are missed now:

| road | pt | true dist m | app dist m | road streets | pt streets |
|---|---|---|---|---|---|
| KW_05 | KW_20 | 7 | 926 | ul. Kiełczowska | Kiełczowska |
| KW_19 | PR_16 | 60 | 361 | al. Karkonoska | Kobierzycka |
| PR_02 | PR_26 | 102 | 164 | ul. Kazimierza Wielkiego; ul. bł. Czesława/Pl. Dominikański; ul. ks. Skargi | Błogosławionego Czesława; Kazimierza Wielkiego; Oławska; Piotra Skargi; pl. Dominikański |
| PR_30 | PR_21 | 31 | 345 | ul. Kosmonautów | 11 Listopada; Fieldorfa; Kosmonautów |
| R2_07 | R2_04 | 92 | 268 | ul. Gajowicka; ul. Hallera | Gajowicka; Hallera |
| R2_12 | R2_08 | 98 | 620 | al. Armii Krajowej; ul. Bardzka | Armii Krajowej; Bardzka |

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
