# -*- coding: utf-8 -*-
"""Check A (continued): categorical breakdowns shown in the details panel.

Re-reads 3.4 / 3.5 / 6.4 / 7.1 rows and compares bike byPlace/bySex/byMode/byUser/
helmet, ped bySex/byMobility/byMobility2/bySide/byPeriod, pt byTraction/byCarrier/
byLine/byDir, rail seats/carriers. Code legends are taken from the workbooks' own
header rows (3.4 'DANE - pomiary rowerowe' row 4, 3.5 'baza' row 2) and the 3.5
summary sheet 'Sposob poruszania'.

    python -I reports/audit/check_breakdowns.py -> cache/breakdowns.json
"""
import os, re, json, collections, warnings
warnings.filterwarnings("ignore")
import openpyxl

ROOT = os.getcwd()
C = os.path.join(ROOT, "reports", "audit", "cache")
D = os.path.join(ROOT, "data")
F = lambda p: [os.path.join(D, x) for x in os.listdir(D) if x.startswith("Załącznik " + p + " ")][0]
L = lambda f: {p["id"]: p for p in json.load(open(os.path.join(ROOT, "public", "data", f + ".json"), encoding="utf8"))}
s = lambda v: re.sub(r"\s+", " ", str(v or "").replace("\xa0", " ")).strip()
res = collections.defaultdict(dict)


def rows(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    yield from wb[sheet].iter_rows(values_only=True)
    wb.close()


def legend(text):
    """'1 - foo,\n2 - bar' -> {1: 'foo', 2: 'bar'}"""
    out = {}
    for m in re.finditer(r"(\d)\s*-\s*([^\n]+)", str(text or "")):
        out[int(m.group(1))] = m.group(2).strip(" ,;")
    return out


def flag(layer, pid, msg):
    res[layer].setdefault(pid, []).append(msg)


# ------------------------------------------------------------- bike (3.4)
bj = L("bike")
leg = {}
cnt = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for i, r in enumerate(rows(F("3.4"), "DANE - pomiary rowerowe")):
    if i == 3:
        leg = {"place": legend(r[9]), "sex": legend(r[10]), "mode": legend(r[11]),
               "user": legend(r[12]), "helmet": legend(r[14])}
    if i < 5 or not s(r[1]):
        continue
    for k, j in (("place", 9), ("sex", 10), ("mode", 11), ("user", 12), ("helmet", 14)):
        cnt[s(r[1])][k][r[j]] += 1
JKEY = {"place": "byPlace", "sex": "bySex", "mode": "byMode", "user": "byUser"}
for pid, p in bj.items():
    c = cnt[pid]
    for k, jk in JKEY.items():
        raw_vals = sorted(v for code, v in c[k].items() if code)
        js_vals = sorted(p[jk].values())
        if raw_vals != js_vals:
            flag("bike", pid, "%s counts %s vs raw %s" % (jk, js_vals, raw_vals))
    if (p["helmet"]["tak"], p["helmet"]["nie"]) != (c["helmet"].get(1, 0), c["helmet"].get(2, 0)):
        flag("bike", pid, "helmet %s vs raw %s" % (p["helmet"], dict(c["helmet"])))
    blanks = {k: c[k].get(None, 0) for k in c if c[k].get(None)}
    if blanks:
        flag("bike", pid, "info: rows with blank code (dropped from breakdowns): %s" % blanks)
# label check against legend text: first words must agree
meta = json.load(open(os.path.join(ROOT, "public", "data", "meta.json"), encoding="utf8"))
label_issues = []
for k, mk in (("place", "bikePlace"), ("mode", "bikeMode"), ("user", "bikeUser")):
    for code, txt in leg[k].items():
        lab = meta[mk].get(str(code))
        label_issues.append((mk, code, lab, txt))

# ------------------------------------------------------------- ped (3.5)
pj = L("ped")
pc = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
pleg = {}
for i, r in enumerate(rows(F("3.5"), "baza")):
    if i == 1:
        pleg = {"mob": legend(r[9]), "mob2": legend(r[10])}
    if i < 2 or not re.match(r"PP_", s(r[0])):
        continue
    for k, j in (("sex", 8), ("mob", 9), ("mob2", 10), ("side", 11), ("period", 3)):
        pc[s(r[0])][k][r[j] if k not in ("side", "period") else s(r[j])] += 1
# authors' own summary of the 'inne' categories (codes in header row 4)
summ = {}
hdr = None
for i, r in enumerate(rows(F("3.5"), "Sposób poruszania")):
    if i == 4:
        hdr = r
    if i > 4 and re.match(r"PP_", s(r[0])):
        summ[s(r[0])] = {hdr[j]: r[j] for j in range(2, 9) if isinstance(hdr[j], int)}
ped_label = []
for code, txt in sorted(pleg["mob2"].items()):
    ped_label.append((code, meta["pedMobility2"].get(str(code)), txt))
for pid, p in pj.items():
    c = pc[pid]
    inv = {v: k for k, v in meta["pedMobility2"].items()}
    js_by_code = {int(inv[lab]): v for lab, v in p["byMobility2"].items() if lab in inv}
    raw_by_code = {k: v for k, v in c["mob2"].items() if isinstance(k, int)}
    if js_by_code != raw_by_code:
        flag("ped", pid, "byMobility2 counts by code %s vs raw %s" % (js_by_code, raw_by_code))
    if summ.get(pid):
        if any(summ[pid].get(k, 0) != raw_by_code.get(k, 0) for k in summ[pid]):
            flag("ped", pid, "raw mob2 %s vs sheet 'Sposob poruszania' %s" % (raw_by_code, summ[pid]))
    for k, jk in (("sex", "bySex"), ("mob", "byMobility")):
        if sorted(v for code, v in c[k].items() if code) != sorted(p[jk].values()):
            flag("ped", pid, "%s %s vs raw %s" % (jk, p[jk], dict(c[k])))
    if {k: v for k, v in c["side"].items() if k} != p["bySide"]:
        flag("ped", pid, "bySide %s vs raw %s" % (p["bySide"], dict(c["side"])))
    if {k: v for k, v in c["period"].items() if k} != p["byPeriod"]:
        flag("ped", pid, "byPeriod %s vs raw %s" % (p["byPeriod"], dict(c["period"])))
    mis = {k: v for k, v in raw_by_code.items() if k not in (1, 2, 3, 4, 5, 6, 7, 8)}
    if mis:
        flag("ped", pid, "unknown mob2 codes %s" % mis)

# ------------------------------------------------------------- pt (6.4)
tj = L("pt")
tc = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for i, r in enumerate(rows(F("6.4"), "DANE - potoki pasażerskie")):
    if i < 4 or not r[0] or not s(r[4]):
        continue
    sid = s(r[4])
    pax = r[25] if isinstance(r[25], (int, float)) else 0
    tc[sid]["traction"][s(r[22]) or "?"] += 1
    if s(r[20]):
        tc[sid]["carrier"][s(r[20])] += 1
    if s(r[17]):
        tc[sid]["line"][s(r[17])] += pax
    if s(r[19]):
        tc[sid]["dir"][s(r[19])] += pax
for pid, p in tj.items():
    c = tc[pid]
    if dict(c["traction"]) != p["byTraction"]:
        flag("pt", pid, "byTraction %s vs raw %s" % (p["byTraction"], dict(c["traction"])))
    for k, jk, n in (("carrier", "byCarrier", 8), ("line", "byLine", 15), ("dir", "byDir", 10)):
        top = c[k].most_common(n)
        jv = sorted(round(v) for v in p[jk].values())
        rv = sorted(round(v) for _, v in top)
        if jv != rv:
            flag("pt", pid, "%s values %s vs raw top-%d %s" % (jk, jv, n, rv))
        if len(c[k]) > n:
            flag("pt", pid, "info: %s truncated to top %d of %d" % (jk, n, len(c[k])))

# ------------------------------------------------------------- rail (7.1)
rj = L("rail")
rc = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for i, r in enumerate(rows(F("7.1"), "DANE SUROWE")):
    if i < 4 or not r[0]:
        continue
    cid = s(r[0])
    if isinstance(r[18], (int, float)):
        rc[cid]["seats"][s(r[12])] += r[18]
    rc[cid]["carriers"][s(r[5])] += 1
for cid, c in rj.items():
    if {k: round(v) for k, v in rc[cid]["seats"].items()} != c["seats"]:
        flag("rail", cid, "seats %s vs raw %s" % (c["seats"], dict(rc[cid]["seats"])))
    if dict(rc[cid]["carriers"]) != c["carriers"]:
        flag("rail", cid, "carriers %s vs raw %s" % (c["carriers"], dict(rc[cid]["carriers"])))

out = {"flags": res, "bike_labels": label_issues, "ped_mob2_labels": ped_label}
json.dump(out, open(os.path.join(C, "breakdowns.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("ped mobility2 code -> JSON label | source legend")
for code, lab, txt in ped_label:
    print("  %s  %-55s | %s" % (code, lab, txt))
print("bike labels (meta key, code, JSON label | source legend)")
for x in label_issues:
    print("  ", x)
for layer, d in res.items():
    nonin = {k: [m for m in v if not m.startswith("info")] for k, v in d.items()}
    print(layer, "flagged", sum(1 for v in nonin.values() if v), "info-only", sum(1 for v in nonin.values() if not v))
    for k, v in d.items():
        print("   ", k, v[:3])
