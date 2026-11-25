"""Roadworks and closures during the counts and the survey -> works.json.

Each entry is written by hand from the notices and reports it names; only the
shape comes from the street map: every way of those names inside the box.

    python etl/works.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "data")
# when anything was counted or asked: 21 March (road counts) - 20 June (homes)
SPAN = ("2024-03-21", "2024-06-20")

# limits: what could not pass - "auta", "tramwaje", "autobusy"; "pas" - a lane.
# approx: the dates are, or one of them is, as announced or reported only.
WORKS = json.load(open(os.path.join(HERE, "works_list.json"), encoding="utf8"))


def metres(a, b):
    from math import cos, hypot, radians
    return hypot((a[0] - b[0]) * 111200, (a[1] - b[1]) * 111200 * cos(radians(a[0])))


def main():
    ways = json.load(open(os.path.join(HERE, "cache", "overpass_drivable3.json"), encoding="utf8"))
    # the last word or two of a full name is what people call it
    zones = json.load(open(os.path.join(OUT, "zones.json"), encoding="utf8"))
    names = [d["name"] for d in zones["districts"]]
    out = []
    for w in WORKS:
        assert w["from"] <= w["to"], w["id"]
        hit = w["from"] <= SPAN[1] and w["to"] >= SPAN[0]
        assert hit, (w["id"], "outside the span")
        lines = []
        for name, (s, west, n, e) in w["ways"]:
            own = [q["g"] for q in ways if (q.get("name") or "").endswith(name)
                   and all(s <= la <= n and west <= lo <= e for la, lo in q["g"])]
            if not own:
                print("  ! no way", w["id"], name)
            lines += own
        missing = [d for d in w["districts"] if d not in names]
        assert not missing, (w["id"], missing)
        length = sum(metres(a, b) for g in lines for a, b in zip(g, g[1:]))
        out.append({**{k: v for k, v in w.items() if k not in ("ways", "districts")},
                    "d": [names.index(d) for d in w["districts"]],
                    "g": [[[round(x, 5) for x in p] for p in g] for g in lines]})
        print("  %-22s %s - %s  %d ways, %d m" % (w["id"], w["from"], w["to"], len(lines), length))
    path = os.path.join(OUT, "works.json")
    with open(path, "w", encoding="utf8", newline="\n") as f:
        json.dump({"span": SPAN, "works": out}, f, ensure_ascii=False, separators=(",", ":"))
    print("  works.json %d kB" % (os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()
