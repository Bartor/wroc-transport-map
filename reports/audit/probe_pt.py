"""Probe 6.4 rows: hour columns that disagree, blank pax, point/section code mismatches."""
import os, re, collections, datetime, warnings, json
warnings.filterwarnings("ignore")
import openpyxl
f = [os.path.join("data", x) for x in os.listdir("data") if x.startswith("Załącznik 6.4")][0]
wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
ws = wb["DANE - potoki pasażerskie"]
dis = collections.Counter(); ex = []
blank = []
pref = collections.Counter()
bypoint = collections.Counter()
poles = collections.defaultdict(collections.Counter)
kinds = collections.Counter()
for i, r in enumerate(ws.iter_rows(values_only=True)):
    if i < 4 or not r[0]:
        continue
    sid, pt = str(r[4] or ""), str(r[3] or "")
    kinds[(r[0], r[2])] += 1
    if not sid.startswith(pt):
        pref[(pt, sid)] += 1
    if isinstance(r[25], (int, float)):
        bypoint[pt] += r[25]
    else:
        blank.append([sid, r[11], r[17], r[24], r[25]])
    poles[sid][str(r[5])] += 1
    m = re.match(r"(\d+):", str(r[15] or ""))
    if isinstance(r[13], int) and m and int(m.group(1)) != r[13]:
        t = r[11]
        dis[(str(r[15]), r[13], str(r[14]))] += 1
print("hour disagreements (kwadrans, godzina, godzina rap):")
for k, v in dis.most_common(20): print("  ", v, k)
print("blank pax rows:", blank)
print("point/section prefix mismatches:", dict(pref))
print("kinds:", dict(kinds))
print("bypoint R1_11", bypoint["R1_11"], "PR_03", bypoint["PR_03"])
json.dump({k: dict(v) for k, v in poles.items()}, open("reports/audit/cache/pt_poles_64.json", "w"), indent=0)
