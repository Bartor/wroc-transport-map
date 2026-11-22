"""One-off Overpass fetch (cached) of the Wroclaw municipal boundary (admin_level 8)
-> reports/audit/cache/wroclaw_boundary.json : list of outer-way geometries."""
import json, os, urllib.request, urllib.parse
OUT = os.path.join("reports", "audit", "cache", "wroclaw_boundary.json")
if os.path.exists(OUT):
    raise SystemExit("cached: " + OUT)
q = """[out:json][timeout:120];
rel["boundary"="administrative"]["name"="Wrocław"]["admin_level"~"^(6|7|8)$"];
out geom;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                             data=urllib.parse.urlencode({"data": q}).encode(),
                             headers={"User-Agent": "osm-audit-script/1.0"})
js = json.loads(urllib.request.urlopen(req, timeout=150).read())
rels = js["elements"]
rel = rels[0]
print([ (r["id"], r["tags"].get("admin_level")) for r in rels])
ways = [[[p["lat"], p["lon"]] for p in m["geometry"]] for m in rel["members"]
        if m["type"] == "way" and m.get("role") == "outer" and m.get("geometry")]
json.dump(ways, open(OUT, "w"))
print(len(ways), "outer ways")
