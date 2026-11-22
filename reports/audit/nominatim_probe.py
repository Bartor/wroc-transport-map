"""A few polite Nominatim lookups (1.2 s apart, generic UA), cached to
reports/audit/cache/nominatim_audit.json. Used only as corroborating evidence."""
import json, os, time, urllib.parse, urllib.request
P = os.path.join("reports", "audit", "cache", "nominatim_audit.json")
db = json.load(open(P, encoding="utf8")) if os.path.exists(P) else {}
QS = ["aleja Generała Józefa Hallera 81, Wrocław", "Cmentarz Ducha Świętego, Wrocław",
      "Pirenejska, Wrocław", "Milenijna, Wrocław", "Kładka Siedlecka, Wrocław"]
for q in QS:
    if q in db:
        continue
    url = "https://nominatim.openstreetmap.org/search?format=json&limit=3&q=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"User-Agent": "osm-audit-script/1.0"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=30).read())
        db[q] = [[float(x["lat"]), float(x["lon"]), x.get("display_name", "")[:120]] for x in r]
    except Exception as e:
        db[q] = "error: %s" % e
    time.sleep(1.2)
json.dump(db, open(P, "w", encoding="utf8"), ensure_ascii=False, indent=1)
for k, v in db.items():
    print(k, v)
