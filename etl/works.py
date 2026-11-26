"""Roadworks and closures during the counts and the survey -> works.json.

Each entry of works_list.json is written by hand from the notices and reports it
names; only the shape comes from the street map. A way is [name, stretch]:

    null                      all of it in the city
    [s, w, n, e]              what is inside the box
    {"between": [a, b]}       from where it meets street a to where it meets b
    {"near": [a, m]}          m metres to each side of where it meets a
    {"from": [a, m]}          m metres on, northwards, from where it meets a

    python etl/works.py
"""
import json, os
from math import cos, hypot, radians

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "data")
# when anything was counted or asked: 21 March (road counts) - 20 June (homes)
SPAN = ("2024-03-21", "2024-06-20")
CITY = (51.03, 16.79, 51.22, 17.20)
K = cos(radians(51.11))


def metres(a, b):
    return hypot((a[0] - b[0]) * 111200, (a[1] - b[1]) * 111200 * K)


def xy(p):
    return (p[1] * 111200 * K, p[0] * 111200)


def dense(g, step=12):
    """Vertices no further apart than this, so that a stretch can be cut."""
    out = [g[0]]
    for a, b in zip(g, g[1:]):
        n = max(1, int(metres(a, b) / step))
        out += [[a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] for i in range(1, n + 1)]
    return out


def runs(g, test):
    out, cur = [], []
    for p in g:
        if test(p):
            cur.append(p)
        else:
            if len(cur) > 1:
                out.append(cur)
            cur = []
    return out + ([cur] if len(cur) > 1 else [])


def inside(p, rings):
    c = False
    for r in rings:
        for (ya, xa), (yb, xb) in zip(r, r[1:] + r[:1]):
            if (ya > p[0]) != (yb > p[0]) and p[1] < (xb - xa) * (p[0] - ya) / (yb - ya) + xa:
                c = not c
    return c


def rings(coded):
    out = []
    for flat in coded:
        la = lo = 0
        r = []
        for i in range(0, len(flat), 2):
            la += flat[i]
            lo += flat[i + 1]
            r.append((la / 1e5, lo / 1e5))
        out.append(r)
    return out


def main():
    ways = [w for w in json.load(open(os.path.join(HERE, "cache", "overpass_drivable3.json"), encoding="utf8"))
            if any(CITY[0] < p[0] < CITY[2] and CITY[1] < p[1] < CITY[3] for p in w["g"])]
    by = {}
    for w in ways:
        by.setdefault(w.get("name"), []).append(w["g"])

    def meet(name, other):
        """Where two streets come closest."""
        best = min(((metres(p, q), p) for g in by.get(name, []) for p in g for h in by.get(other, []) for q in h),
                   default=None, key=lambda x: x[0])
        assert best and best[0] < 120, (name, other, best)
        return best[1]

    def stretch(name, how):
        gs = [dense(g) for g in by.get(name, [])]
        assert gs, name
        if how is None:
            return [g for g in gs if all(CITY[0] < p[0] < CITY[2] and CITY[1] < p[1] < CITY[3] for p in g)]
        if isinstance(how, list):
            test = lambda p: how[0] <= p[0] <= how[2] and how[1] <= p[1] <= how[3]
        elif "near" in how:
            at = meet(name, how["near"][0])
            test = lambda p: metres(p, at) <= how["near"][1]
        elif "from" in how:
            at = meet(name, how["from"][0])
            test = lambda p: metres(p, at) <= how["from"][1] and p[0] >= at[0] - 0.0002
        else:
            a, b = (xy(meet(name, o)) for o in how["between"])
            d = hypot(b[0] - a[0], b[1] - a[1])

            def test(p):
                x, y = xy(p)
                t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (d * d)
                off = abs((x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0])) / d
                return -15 / d <= t <= 1 + 15 / d and off <= max(80, 0.3 * d)
        return [r for g in gs for r in runs(g, test)]

    zones = json.load(open(os.path.join(OUT, "zones.json"), encoding="utf8"))
    names = [d["name"] for d in zones["districts"]]
    shapes = [rings(d["g"]) for d in zones["districts"]]
    out = []
    for w in json.load(open(os.path.join(HERE, "works_list.json"), encoding="utf8")):
        assert w["from"] <= w["to"] and w["from"] <= SPAN[1] and w["to"] >= SPAN[0], (w["id"], "outside the span")
        lines = [g for name, how in w["ways"] for g in stretch(name, how)]
        pts = [p for g in lines for p in g]
        # the districts it runs through or along, and those named
        near = [(0, 0), (4e-4, 0), (-4e-4, 0), (0, 6e-4), (0, -6e-4)]
        own = {names.index(d) for d in w["districts"]}
        own |= {k for k, s in enumerate(shapes) if pts and sum(any(inside((p[0] + a, p[1] + b), s) for a, b in near) for p in pts) >= 0.25 * len(pts)}
        assert own, w["id"]
        length = sum(metres(a, b) for g in lines for a, b in zip(g, g[1:]))
        # only as many vertices as it takes
        thin = [[g[i] for i in range(len(g)) if i % 3 == 0 or i == len(g) - 1] for g in lines]
        if w.get("reroute"):
            r = w["reroute"]
            r["d"] = [names.index(d) for d in r.pop("districts")]
            # tracks the closure left without trams: theirs only led through it
            idle = [g for name, how in r.pop("ways", []) for g in stretch(name, how)]
            r["g"] = [[[round(x, 5) for x in p] for i, p in enumerate(g) if i % 3 == 0 or i == len(g) - 1] for g in idle]
            print("  %-14s tracks without trams: %d m" % ("", sum(metres(a, b) for g in idle for a, b in zip(g, g[1:]))))
        out.append({**{k: v for k, v in w.items() if k not in ("ways", "districts")}, "d": sorted(own),
                    "g": [[[round(x, 5) for x in p] for p in g] for g in thin]})
        print("  %-14s %s - %s %6d m  %s" % (w["id"], w["from"], w["to"], length, ", ".join(names[k] for k in sorted(own))))
    path = os.path.join(OUT, "works.json")
    with open(path, "w", encoding="utf8", newline="\n") as f:
        json.dump({"span": SPAN, "works": out}, f, ensure_ascii=False, separators=(",", ":"))
    print("  works.json %d kB, %d works" % (os.path.getsize(path) / 1024, len(out)))


if __name__ == "__main__":
    main()
