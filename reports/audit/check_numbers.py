# -*- coding: utf-8 -*-
"""Check A: numbers in public/data/*.json vs the raw workbooks (via cache/raw.json).

    python -I reports/audit/check_numbers.py   -> reports/audit/cache/numbers.json + stdout log
"""
import os, json, collections

ROOT = os.getcwd()
C = os.path.join(ROOT, "reports", "audit", "cache")
raw = json.load(open(os.path.join(C, "raw.json"), encoding="utf8"))
L = lambda f: json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))
VEH = ["c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "a1", "a2", "b1", "b2"]
MOTOR = ["c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]
res = collections.defaultdict(dict)   # layer -> id -> {"ok": bool, "notes": [..]}
glob = collections.defaultdict(list)  # layer -> global notes


def add(layer, pid, ok, note=None):
    r = res[layer].setdefault(pid, {"ok": True, "notes": []})
    if not ok:
        r["ok"] = False
    if note:
        r["notes"].append(note)


def diff24(a, b):
    return [(h, a[h], b[h]) for h in range(24) if round(a[h]) != round(b[h])]


# ---------------------------------------------------------------- road
points = L("points")
road = L("road")
assert road["cats"] == VEH, road["cats"]
rraw = raw["road"]
ids_json = [p["id"] for p in points]
dupe = [k for k, n in collections.Counter(ids_json).items() if n > 1]
if dupe:
    glob["road"].append("duplicate ids in points.json: %s" % dupe)
cat_ids = [c["id"] for c in raw["road_cat"]]
for x in sorted(set(cat_ids) - set(ids_json)):
    glob["road"].append("in 3.3 catalogue but not in points.json: " + x)
for x in sorted(set(ids_json) - set(cat_ids)):
    glob["road"].append("in points.json but not in 3.3 catalogue: " + x)
for x in sorted(set(rraw) - set(ids_json)):
    glob["road"].append("has counts in 3.3 data but no point: " + x)
for x in sorted(set(road["sections"]) ^ set(rraw)):
    glob["road"].append("road.json/raw section mismatch: " + x)

catby = {c["id"]: c for c in raw["road_cat"]}
for p in points:
    pid = p["id"]
    sec = rraw.get(pid)
    if not sec:
        add("road", pid, False, "no rows in 'DANE - na jezdni'")
        continue
    hourly = [0] * 24
    hourly_motor = [0] * 24
    for d, dd in sec.items():
        for h in range(24):
            hourly[h] += sum(dd["h"][h])
            hourly_motor[h] += sum(dd["h"][h][VEH.index(c)] for c in MOTOR)
    tot = sum(hourly)
    if round(tot) != p["total"]:
        add("road", pid, False, "total %s vs raw %s" % (p["total"], tot))
    if round(max(hourly)) != p["peak"]:
        add("road", pid, False, "peak %s vs raw %s" % (p["peak"], max(hourly)))
    dh = diff24(hourly, p["byHour"])
    if dh:
        add("road", pid, False, "byHour diffs (h,raw,json): %s" % dh[:6])
    # road.json per direction x hour x category
    js = road["sections"].get(pid, {}).get("dirs", {})
    if set(js) != set(sec):
        add("road", pid, False, "direction keys json %s vs raw %s" % (sorted(js), sorted(sec)))
    nbad = 0
    for d, dd in sec.items():
        jd = js.get(d)
        if not jd:
            continue
        for h in range(24):
            for ci in range(len(VEH)):
                if round(dd["h"][h][ci]) != round(jd["h"][h][ci]):
                    nbad += 1
        for qi in range(96):
            if round(dd["q"][qi]) != round(jd["q"][qi]):
                nbad += 1
    if nbad:
        add("road", pid, False, "road.json dir/hour/cat cells differing: %d" % nbad)
    # off-carriageway
    roff = raw["road_off"].get(pid)
    joff = road["sections"].get(pid, {}).get("off")
    if bool(roff) != bool(joff):
        add("road", pid, False, "off-carriageway presence json=%s raw=%s" % (bool(joff), bool(roff)))
    elif roff:
        nb = sum(1 for d in roff for h in range(24) for c in range(4)
                 if round(roff[d][h][c]) != round(joff.get(d, [[0] * 4] * 24)[h][c]))
        if nb:
            add("road", pid, False, "off-carriageway cells differing: %d" % nb)
    if p.get("hasOff") != bool(roff):
        add("road", pid, False, "hasOff=%s but raw off data=%s" % (p.get("hasOff"), bool(roff)))
    # hours covered
    covered = [h for h in range(24) if hourly[h] > 0]
    add("road", pid, True, None)
    res["road"][pid]["hours"] = covered
    res["road"][pid]["total_all"] = tot
    res["road"][pid]["total_motor"] = sum(hourly_motor)
    res["road"][pid]["nonmotor"] = tot - sum(hourly_motor)
    # metadata
    c = catby.get(pid)
    if c and c["date"] != p["date"]:
        add("road", pid, False, "date %s vs catalogue %s" % (p["date"], c["date"]))
    c2 = raw["road_cat_34"].get(pid)
    if c2 and c2["hours"] and p.get("hours") != c2["hours"]:
        add("road", pid, False, "hours label '%s' vs 3.4 '%s'" % (p.get("hours"), c2["hours"]))
    if not c2:
        res["road"][pid]["notes"].append("not in 3.4 road list -> 'hours' label empty (info)")
    if p.get("hours") == "" and c2 is None:
        pass
    rd = raw["road_dates"].get(pid, [])
    if len(rd) > 1:
        add("road", pid, True, "raw rows span %d dates %s (JSON shows one)" % (len(rd), rd))

# authors' own daily totals ("Porownanie KBR") vs JSON total
for row in raw["road_kbr_cmp"]:
    ids = [x.strip() for x in row["ids"].split("+")]
    if not all(i in rraw for i in ids) or not isinstance(row["v2024"], (int, float)):
        continue
    allv = sum(res["road"][i]["total_all"] for i in ids)
    mot = sum(res["road"][i]["total_motor"] for i in ids)
    jtot = sum(next(p["total"] for p in points if p["id"] == i) for i in ids)
    tag = "KBR-sheet total %s: JSON total %s, raw all-cats %s, raw motor-only %s" % (
        row["v2024"], jtot, allv, mot)
    match = "motor" if mot == row["v2024"] else ("all" if allv == row["v2024"] else "neither")
    for i in ids:
        res["road"][i]["kbr_cmp"] = {"sheet": row["v2024"], "json": jtot, "all": allv,
                                     "motor": mot, "match": match, "window": row["window"]}

# ---------------------------------------------------------------- bike
bike = L("bike")
braw = raw["bike"]
bj = {p["id"]: p for p in bike}
for x in sorted(set(braw) ^ set(bj)):
    glob["bike"].append("id only in %s: %s" % ("raw" if x in braw else "json", x))
bcat = {c["id"]: c for c in raw["bike_cat"]}
for x in sorted(set(bcat) - set(bj)):
    glob["bike"].append("in bike catalogue but not in bike.json: " + x)
for pid, p in bj.items():
    r = braw.get(pid)
    if not r:
        add("bike", pid, False, "no raw rows")
        continue
    if r["n"] != p["total"]:
        add("bike", pid, False, "total %s vs raw %s" % (p["total"], r["n"]))
    dh = diff24(r["h"], p["byHour"])
    if dh:
        add("bike", pid, False, "byHour diffs %s" % dh[:6])
    for d, arr in r["hdir"].items():
        ja = p["byHourDir"].get(d)
        if ja is None or diff24(arr, ja):
            add("bike", pid, False, "byHourDir[%s] differs" % d)
    if {k: v for k, v in r["dir"].items()} != p["byDir"]:
        add("bike", pid, False, "byDir %s vs raw %s" % (p["byDir"], r["dir"]))
    sm = raw["bike_summary_sheet"].get(pid)
    if sm and sm["total"] != p["total"]:
        add("bike", pid, False, "total %s vs 'Sumaryczne dane' sheet %s" % (p["total"], sm["total"]))
    c = bcat.get(pid)
    if c and (c["name"] != p["name"] or c["segment"] != p["segment"]):
        add("bike", pid, True, "name/segment differ from catalogue: '%s'/'%s' vs '%s'/'%s'" % (
            p["name"], p["segment"], c["name"], c["segment"]))
    add("bike", pid, True)

# ---------------------------------------------------------------- ped
ped = L("ped")
praw = raw["ped"]
pj = {p["id"]: p for p in ped}
for x in sorted(set(praw) ^ set(pj)):
    glob["ped"].append("id only in %s: %s" % ("raw" if x in praw else "json", x))
for x in sorted({c["id"] for c in raw["ped_cat"]} - set(pj)):
    glob["ped"].append("in ped catalogue but not in ped.json: " + x)
for pid, p in pj.items():
    r = praw.get(pid)
    if not r:
        add("ped", pid, False, "no raw rows")
        continue
    if r["n"] != p["total"]:
        add("ped", pid, False, "total %s vs raw %s" % (p["total"], r["n"]))
    dh = diff24(r["h"], p["byHour"])
    if dh:
        add("ped", pid, False, "byHour diffs %s" % dh[:6])
    for d, arr in r["hdir"].items():
        if not d:
            add("ped", pid, False, "raw rows with blank direction: %d" % sum(arr))
            continue
        ja = p["byHourDir"].get(d)
        if ja is None or diff24(arr, ja):
            add("ped", pid, False, "byHourDir[%s] differs" % d)
    sm = raw["ped_summary_sheet"].get(pid)
    if sm and sm["total"] != p["total"]:
        add("ped", pid, False, "total %s vs 'DANE SUMARYCZNE' sheet %s" % (p["total"], sm["total"]))
    add("ped", pid, True)

# ---------------------------------------------------------------- pt
pt = L("pt")
traw = raw["pt"]
tj = {p["id"]: p for p in pt}
if len(tj) != len(pt):
    glob["pt"].append("duplicate ids in pt.json")
for x in sorted(set(traw) ^ set(tj)):
    glob["pt"].append("id only in %s: %s" % ("raw" if x in traw else "json", x))
cat63 = collections.defaultdict(list)
for c in raw["pt_cat"]:
    cat63[c["id"]].append(c)
for x in sorted(set(cat63) - set(tj)):
    glob["pt"].append("in 6.3 catalogue but no data/JSON: " + x)
for x in sorted(set(tj) - set(cat63)):
    glob["pt"].append("in pt.json but not in 6.3 catalogue: " + x)
for k, v in cat63.items():
    if len(v) > 1:
        glob["pt"].append("6.3 lists section %s %d times: %s" % (
            k, len(v), [(c["loc"], c["stop"]) for c in v]))
for pid, p in tj.items():
    r = traw.get(pid)
    if not r:
        add("pt", pid, False, "no raw rows")
        continue
    if round(r["pax"]) != p["pax"]:
        add("pt", pid, False, "pax %s vs raw %s" % (p["pax"], r["pax"]))
    if r["veh"] != p["veh"]:
        add("pt", pid, False, "veh %s vs raw %s" % (p["veh"], r["veh"]))
    for t, arr in r["h"].items():
        ja = p["byHour"].get(t)
        if ja is None or diff24(arr, ja):
            add("pt", pid, False, "byHour[%s] differs: %s" % (t, diff24(arr, ja or [0] * 24)[:5]))
    for t, arr in r["vh"].items():
        ja = p["vehByHour"].get(t)
        if ja is None or diff24(arr, ja):
            add("pt", pid, False, "vehByHour[%s] differs" % t)
    if sum(sum(a) for a in p["byHour"].values()) != p["pax"]:
        add("pt", pid, True, "sum(byHour)=%s != pax %s (rounding)" % (
            sum(sum(a) for a in p["byHour"].values()), p["pax"]))
    s67 = raw["pt_sheet67"].get(pid)
    if s67:
        if (p.get("boarded") or 0) != round(s67["board"]) or (p.get("alighted") or 0) != round(s67["alight"]):
            add("pt", pid, False, "boarded/alighted %s/%s vs sheet 6.7 %s/%s" % (
                p.get("boarded"), p.get("alighted"), s67["board"], s67["alight"]))
    if r["point"] != p["point"]:
        add("pt", pid, False, "point %s vs raw %s" % (p["point"], r["point"]))
    add("pt", pid, True)
# per-point totals vs the authors' sheet 6.4
bypoint = collections.Counter()
for p in pt:
    bypoint[p["point"]] += p["pax"]
for k, v in raw["pt_sheet64"].items():
    if round(v["total"]) != bypoint.get(k):
        glob["pt"].append("point %s: sheet 6.4 total %s vs sum of pt.json sections %s" % (
            k, v["total"], bypoint.get(k)))

# ---------------------------------------------------------------- rail
rail = L("rail")
rr = raw["rail"]
rj = {c["id"]: c for c in rail}
for x in sorted(set(rr) ^ set(rj)):
    glob["rail"].append("cordon only in %s: %s" % ("raw" if x in rr else "json", x))
for cid, c in rj.items():
    r = rr.get(cid)
    if not r:
        continue
    if r["trains"] != c["trains"]:
        add("rail", cid, False, "trains %s vs raw %s" % (c["trains"], r["trains"]))
    if {k: round(v) for k, v in r["pax"].items()} != c["pax"]:
        add("rail", cid, False, "pax %s vs raw %s" % (c["pax"], r["pax"]))
    for d, arr in r["h"].items():
        if diff24(arr, c["byHour"].get(d, [0] * 24)):
            add("rail", cid, False, "byHour[%s] differs %s" % (d, diff24(arr, c["byHour"].get(d, [0] * 24))))
    if sorted(r["stations"]) != sorted(c["stations"]):
        add("rail", cid, False, "stations %s vs raw %s" % (c["stations"], r["stations"]))
    add("rail", cid, True)

for k in ("road_anom", "road_off_anom", "bike_anom", "ped_anom", "pt_anom", "rail_anom"):
    if raw.get(k):
        glob[k.split("_")[0]].append("raw anomalies %s: %s" % (k, raw[k]))
if raw.get("road_dupkeys_n"):
    glob["road"].append("duplicate raw keys (sid,dir,quarter,cat): %d" % raw["road_dupkeys_n"])

json.dump({"res": res, "glob": glob}, open(os.path.join(C, "numbers.json"), "w", encoding="utf8"),
          ensure_ascii=False, indent=1)
for layer in res:
    bad = [k for k, v in res[layer].items() if not v["ok"]]
    print("%-5s checked %3d  flagged %3d" % (layer, len(res[layer]), len(bad)))
    for k in bad:
        print("   ", k, res[layer][k]["notes"][:4])
for layer, g in glob.items():
    print("GLOBAL", layer)
    for x in g:
        print("   ", x)
