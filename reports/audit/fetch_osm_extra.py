"""One-off Overpass fetch (cached) of features the etl cache lacks: named waterways,
bridge names, promenades, weirs and railway lines in the Wroclaw bbox.
Output: reports/audit/cache/overpass_extra.json  (re-run only if missing)."""
import json, os, urllib.request, urllib.parse
OUT = os.path.join("reports", "audit", "cache", "overpass_extra.json")
if os.path.exists(OUT):
    raise SystemExit("cached: " + OUT)
bb = "51.03,16.90,51.18,17.15"
q = f"""[out:json][timeout:180];
(
  way["waterway"~"^(river|canal)$"]["name"]({bb});
  way["bridge:name"]({bb});
  way["name"~"[Pp]romenada|[Kk]ładka|[Jj]az"]({bb});
  node["name"~"[Jj]az "]({bb});
  way["waterway"="weir"]({bb});
  way["railway"="rail"]({bb});
);
out geom;"""
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                             data=urllib.parse.urlencode({"data": q}).encode(),
                             headers={"User-Agent": "osm-audit-script/1.0"})
js = json.loads(urllib.request.urlopen(req, timeout=200).read())
out = []
for el in js["elements"]:
    t = el.get("tags", {})
    g = [[round(p["lat"], 6), round(p["lon"], 6)] for p in el.get("geometry", [])] or (
        [[el["lat"], el["lon"]]] if "lat" in el else [])
    out.append({"type": el["type"], "id": el["id"], "name": t.get("name"), "bridge_name": t.get("bridge:name"),
                "waterway": t.get("waterway"), "railway": t.get("railway"), "highway": t.get("highway"), "g": g})
json.dump(out, open(OUT, "w", encoding="utf8"), ensure_ascii=False)
print(len(out), "features")
