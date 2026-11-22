# -*- coding: utf-8 -*-
"""Independent re-read of the raw KBR 2024 workbooks.

Writes reports/audit/cache/raw.json with per-point aggregates computed straight
from the source rows (no code shared with etl/). Run from the repo root:

    python -I reports/audit/extract_raw.py

Takes ~3-5 min (3.3 has 431k rows). Everything downstream reads the cache.
"""
import os, re, sys, json, zipfile, collections, datetime, warnings
import xml.etree.ElementTree as ET
warnings.filterwarnings("ignore")
import openpyxl

ROOT = os.getcwd()
DATA = os.path.join(ROOT, "data")
OUTD = os.path.join(ROOT, "reports", "audit", "cache")
os.makedirs(OUTD, exist_ok=True)


def F(prefix):
    for f in os.listdir(DATA):
        if f.startswith("Załącznik " + prefix + " ") and f.endswith((".xlsx", ".docx")):
            return os.path.join(DATA, f)
    raise SystemExit("missing " + prefix)


def rows(path, sheet_sub):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = [w for w in wb.worksheets if w.title.strip() == sheet_sub.strip()]
    if not ws:
        ws = [w for w in wb.worksheets if sheet_sub in w.title]
    for r in ws[0].iter_rows(values_only=True):
        yield r
    wb.close()


def s(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).replace("\xa0", " ")).strip()


def hh(v):
    """Hour of a 'HH:MM - HH:MM' / 'H:MM-H:MM' label (start of interval)."""
    m = re.match(r"\s*(\d{1,2})[:.](\d{2})", s(v))
    return (int(m.group(1)), int(m.group(2))) if m else None


def log(*a):
    print(*a, file=sys.stderr, flush=True)


out = {}

# ------------------------------------------------------------------ 3.3 road
f33 = F("3.3")
cat = []
for i, r in enumerate(rows(f33, "Wykaz - przekroje pomiarowe")):
    if i < 4 or not r[1]:
        continue
    cat.append({"point": s(r[0]), "id": s(r[1]), "area": s(r[2]), "name": s(r[3]),
                "segment": s(r[4]), "in1": s(r[5]), "in2": s(r[6]), "where": s(r[7]),
                "date": r[8].strftime("%Y-%m-%d") if isinstance(r[8], datetime.datetime) else s(r[8]),
                "lon_raw": r[9], "lat_raw": r[10]})
out["road_cat"] = cat
log("3.3 catalogue", len(cat))

# second copy of the road catalogue (with coordinates + hours) in 3.4
f34 = F("3.4")
cat2 = {}
for i, r in enumerate(rows(f34, "Wykaz przekroje drogowe ")):
    if i < 4 or not r[1]:
        continue
    cat2[s(r[1])] = {"point": s(r[0]), "name": s(r[3]), "hours": s(r[9]),
                     "lon_raw": r[10], "lat_raw": r[11]}
out["road_cat_34"] = cat2

# KBR comparison sheet: authors' own 2024 daily totals
cmp_ = []
for i, r in enumerate(rows(f33, "Porównanie KBR")):
    if i < 4 or not r[4]:
        continue
    cmp_.append({"ids": s(r[4]), "v2024": r[5], "window": s(r[8]) if len(r) > 8 else ""})
out["road_kbr_cmp"] = cmp_

# carriageway data: per section, dir, hour, cat
VEH = ["c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "a1", "a2", "b1", "b2"]
road = {}
anom = collections.Counter()
anom_ex = collections.defaultdict(list)
keycount = collections.Counter()
dates = collections.defaultdict(set)
motorflag = collections.defaultdict(set)
quarters_seen = collections.defaultdict(set)
log("reading DANE - na jezdni ...")
for i, r in enumerate(rows(f33, "DANE - na jezdni")):
    if i < 4:
        continue
    sid = s(r[1])
    if not sid:
        if any(x is not None for x in r[:13]):
            anom["blank_sid_nonempty_row"] += 1
        continue
    q = hh(r[6])
    hr = hh(r[7])
    iv = r[5]
    c = s(r[8])
    v = r[12]
    d = s(r[10]) + ">" + s(r[11])
    if c not in VEH:
        anom["unknown_cat"] += 1
        anom_ex["unknown_cat"].append([sid, c])
        continue
    motorflag[c].add(r[9])
    if q is None:
        anom["no_quarter"] += 1
        continue
    h = q[0]
    if hr is None or hr[0] != h:
        anom["hour_col_disagrees_with_quarter"] += 1
        if len(anom_ex["hour_col"]) < 10:
            anom_ex["hour_col"].append([sid, s(r[6]), s(r[7])])
    if isinstance(iv, (int, float)) and int(iv) != q[0] * 4 + q[1] // 15:
        anom["interval_no_disagrees"] += 1
    if v is None:
        anom["value_none"] += 1
        continue
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        anom["value_nonnumeric"] += 1
        anom_ex["value_nonnumeric"].append([sid, s(r[6]), c, repr(v)])
        continue
    if v < 0:
        anom["value_negative"] += 1
        anom_ex["value_negative"].append([sid, s(r[6]), c, v])
    if v != int(v):
        anom["value_fractional"] += 1
        if len(anom_ex["value_fractional"]) < 20:
            anom_ex["value_fractional"].append([sid, s(r[6]), c, v])
    k = (sid, d, q[0] * 4 + q[1] // 15, c)
    keycount[k] += 1
    dates[sid].add(str(r[4])[:10])
    quarters_seen[sid].add(q[0] * 4 + q[1] // 15)
    sec = road.setdefault(sid, {})
    dd = sec.setdefault(d, {"h": [[0] * len(VEH) for _ in range(24)], "q": [0] * 96})
    dd["h"][h][VEH.index(c)] += v
    dd["q"][q[0] * 4 + q[1] // 15] += v
dups = {"|".join(map(str, k)): n for k, n in keycount.items() if n > 1}
out["road"] = road
out["road_anom"] = dict(anom)
out["road_anom_ex"] = {k: v[:20] for k, v in anom_ex.items()}
out["road_dupkeys"] = dict(list(dups.items())[:200])
out["road_dupkeys_n"] = len(dups)
out["road_dates"] = {k: sorted(v) for k, v in dates.items()}
out["road_motorflag"] = {k: sorted(map(str, v)) for k, v in motorflag.items()}
out["road_quarters"] = {k: len(v) for k, v in quarters_seen.items()}
log("  sections", len(road), "anom", dict(anom), "dupkeys", len(dups))

OFF = ["a3", "a4", "b3", "b4"]
off = {}
offanom = collections.Counter()
log("reading DANE - poza jezdnią ...")
for i, r in enumerate(rows(f33, "DANE - poza jezdnią")):
    if i < 4:
        continue
    sid = s(r[1])
    if not sid:
        continue
    c = s(r[9])
    v = r[12]
    q = hh(r[6])
    if c not in OFF:
        offanom["unknown_cat:" + c] += 1
        continue
    if q is None:
        offanom["no_quarter"] += 1
        continue
    if not isinstance(v, (int, float)):
        if v is not None:
            offanom["nonnumeric"] += 1
        continue
    d = s(r[10]) + ">" + s(r[11])
    dd = off.setdefault(sid, {}).setdefault(d, [[0] * 4 for _ in range(24)])
    dd[q[0]][OFF.index(c)] += v
out["road_off"] = off
out["road_off_anom"] = dict(offanom)
log("  off sections", len(off))

# ------------------------------------------------------------------ 3.4 bike
bcat = []
for i, r in enumerate(rows(f34, "Wykaz - przekroje rowerowe")):
    if i < 4 or not r[1]:
        continue
    bcat.append({"point": s(r[1]), "id": s(r[2]), "d1": s(r[3]), "d2": s(r[4]),
                 "name": s(r[5]), "segment": s(r[6]), "where": s(r[7])})
out["bike_cat"] = bcat
bike = {}
banom = collections.Counter()
log("reading DANE - pomiary rowerowe ...")
for i, r in enumerate(rows(f34, "DANE - pomiary rowerowe")):
    if i < 5:
        continue
    sid = s(r[1])
    if not sid:
        if s(r[0]):
            banom["point_without_section:" + s(r[0])] += 1
        continue
    q = hh(r[6])
    p = bike.setdefault(sid, {"n": 0, "h": [0] * 24, "dir": {}, "hdir": {}, "point": s(r[0]),
                              "loc": s(r[2]), "seg": s(r[3])})
    p["n"] += 1
    if q is None:
        banom["no_quarter"] += 1
        continue
    hr = hh(r[7])
    if hr is None or hr[0] != q[0]:
        banom["hour_col_disagrees"] += 1
    p["h"][q[0]] += 1
    d = s(r[8])
    p["dir"][d] = p["dir"].get(d, 0) + 1
    p["hdir"].setdefault(d, [0] * 24)[q[0]] += 1
out["bike"] = bike
out["bike_anom"] = dict(banom)
summ = {}
for i, r in enumerate(rows(f34, "Sumaryczne dane")):
    if i < 4 or not r[0] or not re.match(r"RR_", s(r[0])):
        continue
    summ[s(r[0])] = {"total": r[3], "am": r[4], "pm": r[5]}
out["bike_summary_sheet"] = summ
log("  bike sections", len(bike))

# ------------------------------------------------------------------ 3.5 ped
f35 = F("3.5")
pcat = []
for i, r in enumerate(rows(f35, "Lista punktów pomiarowych")):
    if i < 4 or not r[1]:
        continue
    pcat.append({"id": s(r[1]), "d1": s(r[2]), "d2": s(r[3]), "name": s(r[4]), "segment": s(r[5])})
out["ped_cat"] = pcat
ped = {}
panom = collections.Counter()
log("reading baza (ped) ...")
for i, r in enumerate(rows(f35, "baza")):
    sid = s(r[0])
    if not sid or not re.match(r"PP_", sid):
        if sid and i > 1:
            panom["nonPP_id:" + sid] += 1
        continue
    q = hh(r[5])
    p = ped.setdefault(sid, {"n": 0, "h": [0] * 24, "dir": {}, "hdir": {}, "loc": s(r[1]), "seg": s(r[2])})
    p["n"] += 1
    if q is None:
        panom["no_quarter"] += 1
        continue
    hr = hh(r[6])
    if hr is None or hr[0] != q[0]:
        panom["hour_col_disagrees"] += 1
    p["h"][q[0]] += 1
    d = s(r[7])
    p["dir"][d] = p["dir"].get(d, 0) + 1
    p["hdir"].setdefault(d, [0] * 24)[q[0]] += 1
out["ped"] = ped
out["ped_anom"] = dict(panom)
psum = {}
for i, r in enumerate(rows(f35, "DANE SUMARYCZNE - Piesi")):
    if i < 4 or not r[0] or not re.match(r"PP_", s(r[0])):
        continue
    psum[s(r[0])] = {"total": r[2], "am": r[3], "pm": r[4]}
out["ped_summary_sheet"] = psum
log("  ped sections", len(ped))

# ------------------------------------------------------------------ 6.3 docx
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
z = zipfile.ZipFile(F("6.3"))
root = ET.fromstring(z.read("word/document.xml"))
c63 = []
for tbl in root.iter(W + "tbl"):
    for tr in tbl.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            ps = ["".join(t.text or "" for t in p.iter(W + "t")) for p in tc.iter(W + "p")]
            cells.append(s(" ".join(x for x in ps if x)))
        if len(cells) >= 6 and re.match(r"^(KW|PR|R\d)_", cells[3] or ""):
            c63.append({"point": cells[1], "loc": cells[2], "id": cells[3], "stop": cells[4],
                        "poles": [x for x in re.split(r"[,;\s]+", cells[5]) if x],
                        "kind": cells[6] if len(cells) > 6 else "", "time": cells[7] if len(cells) > 7 else ""})
out["pt_cat"] = c63
log("6.3 catalogue rows", len(c63))

# ------------------------------------------------------------------ 6.4 PT
f64 = F("6.4")
pt = {}
ptanom = collections.Counter()
log("reading 6.4 DANE ...")
for i, r in enumerate(rows(f64, "DANE - potoki pasażerskie")):
    if i < 4 or not r[0]:
        continue
    sid = s(r[4])
    if not sid:
        ptanom["no_section"] += 1
        continue
    tr = s(r[22]) or "?"
    # hour from the actual measurement time (timedelta), cross-checked with 'Godzina'
    t = r[11]
    h_t = None
    if isinstance(t, datetime.timedelta):
        h_t = int(t.total_seconds() // 3600) % 24
    elif isinstance(t, datetime.time):
        h_t = t.hour
    h_col = r[13] if isinstance(r[13], int) else None
    qh = hh(r[15])
    h = h_col if h_col is not None else (qh[0] if qh else h_t)
    if h_col is not None and h_t is not None and h_col != h_t:
        ptanom["godzina_vs_time"] += 1
    if h_col is not None and qh and qh[0] != h_col:
        ptanom["godzina_vs_kwadrans"] += 1
    pax = r[25]
    if not isinstance(pax, (int, float)):
        ptanom["pax_nonnumeric:" + s(pax)[:30]] += 1
        pax = 0
    p = pt.setdefault(sid, {"point": s(r[3]), "name": s(r[6]), "loc": s(r[7]), "stops": {},
                            "poles": {}, "pax": 0, "veh": 0, "h": {}, "vh": {}, "board": 0,
                            "alight": 0, "kind": set()})
    p["kind"].add(s(r[0]))
    p["stops"][s(r[8])] = p["stops"].get(s(r[8]), 0) + 1
    p["poles"][s(r[5])] = p["poles"].get(s(r[5]), 0) + 1
    p["pax"] += pax
    p["veh"] += 1
    if h is None:
        ptanom["no_hour"] += 1
    else:
        p["h"].setdefault(tr, [0] * 24)[h] += pax
        p["vh"].setdefault(tr, [0] * 24)[h] += 1
    if isinstance(r[28], (int, float)):
        p["board"] += r[28]
    if isinstance(r[27], (int, float)):
        p["alight"] += r[27]
for p in pt.values():
    p["kind"] = sorted(p["kind"])
out["pt"] = pt
out["pt_anom"] = dict(ptanom)
# authors' per-point totals (sheet 6.4) and per-section boarding (6.7)
s64 = {}
for i, r in enumerate(rows(f64, "6.4")):
    if i < 10 or not r[0]:
        continue
    if re.match(r"^(KW|PR|R\d)_\d+$", s(r[0])):
        s64[s(r[0])] = {"pm": r[1], "am": r[2], "total": r[3]}
out["pt_sheet64"] = s64
s67 = {}
for i, r in enumerate(rows(f64, "6.7")):
    if i < 11 or not r[0]:
        continue
    if re.match(r"^(KW|PR|R\d)_\w+$", s(r[0])) and isinstance(r[1], (int, float)):
        s67.setdefault(s(r[0]), {"alight": r[1], "board": r[2]})
out["pt_sheet67"] = s67
log("  pt sections", len(pt), dict(ptanom))

# ------------------------------------------------------------------ 7.1 rail
f71 = F("7.1")
rail = {}
ranom = collections.Counter()
for i, r in enumerate(rows(f71, "DANE SUROWE")):
    if i < 4 or not r[0]:
        continue
    cid = s(r[0])
    c = rail.setdefault(cid, {"stations": set(), "trains": 0, "pax": {}, "h": {}})
    c["stations"].update([s(r[1]), s(r[2])])
    c["trains"] += 1
    d = s(r[12])
    pax = r[14] if isinstance(r[14], (int, float)) else 0
    if not isinstance(r[14], (int, float)):
        ranom["pax_nonnumeric"] += 1
    c["pax"][d] = c["pax"].get(d, 0) + pax
    h = None
    hs = s(r[10])
    if hs.isdigit():
        h = int(hs)
    # cross-check hour with the actual departure time
    dep = r[8]
    if isinstance(dep, datetime.time) and h is not None and dep.hour != h:
        ranom["hour_vs_dep"] += 1
    if h is None:
        ranom["no_hour"] += 1
    else:
        c["h"].setdefault(d, [0] * 24)[h] += pax
for c in rail.values():
    c["stations"] = sorted(c["stations"])
out["rail"] = rail
out["rail_anom"] = dict(ranom)
log("rail cordons", len(rail), dict(ranom))

json.dump(out, open(os.path.join(OUTD, "raw.json"), "w", encoding="utf8"), ensure_ascii=False)
log("written", os.path.join(OUTD, "raw.json"))
