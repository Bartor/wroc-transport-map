# -*- coding: utf-8 -*-
"""Geometry + street-name helpers for the point audit (independent of etl/)."""
import math, re, unicodedata, json, os, collections

R = 6371000.0


def hav(a, b):
    """Metres between [lat, lon] pairs."""
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(h)))


KX = 111320.0 * math.cos(math.radians(51.1))
KY = 110950.0


def xy(p):
    return (p[1] * KX, p[0] * KY)


def seg_dist(p, a, b):
    """Metres from p to segment ab, plus the projection point [lat, lon] and t."""
    px, py = xy(p)
    ax, ay = xy(a)
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy), [qy / KY, qx / KX], t


def poly_dist(p, g):
    best = (1e18, None)
    for i in range(len(g) - 1):
        d, q, _ = seg_dist(p, g[i], g[i + 1])
        if d < best[0]:
            best = (d, q)
    if len(g) == 1:
        best = (hav(p, g[0]), g[0])
    return best


# ------------------------------------------------------------------ names
def strip_dia(s):
    s = s.replace("ł", "l").replace("Ł", "L")
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


PREFIXES = {"ul", "ulica", "al", "aleja", "aleje", "alei", "pl", "plac", "placu", "os", "osiedle",
            "gen", "general", "generala", "sw", "swietego", "swietej", "ks", "ksiedza", "bp", "biskupa",
            "kard", "kardynala", "marsz", "marszalka", "prof", "profesora", "dr", "im", "rondo", "ronda",
            "most", "mosty", "mostu", "kladka", "kladki", "bulwar", "bulw", "skwer", "park", "promenada",
            "wybrzeze", "trasa", "estakada", "wiadukt", "droga", "nad", "pod", "przy", "przez", "na", "w",
            "do", "z", "od", "i", "a", "o", "we", "ze", "miedzy", "wysokosci", "rzeka", "rzeki", "rzeke",
            "kanal", "kanale", "kanalu", "fosa", "fose", "miejska", "miejskiej", "miejskim", "stronie",
            "obu", "torami", "tory", "kolejowe", "wjazd", "posesji", "posesje", "wezel", "wroclaw",
            "wroclawia", "wroclawiu", "jana", "pawla", "ii", "jozefa", "tadeusza", "boleslawa",
            "stanislawa", "henryka", "wladyslawa", "kazimierza", "marii", "jerzego", "adama"}


BASIC = {"ul", "ulica", "al", "aleja", "pl", "plac", "os", "osiedle"}


def toks(s):
    s = strip_dia(str(s or "")).lower()
    s = re.sub(r"\(.*?\)", " ", s)
    raw = [t for t in re.split(r"[^0-9a-z]+", s) if t]
    out = [t for t in raw if len(t) >= 3 and t not in PREFIXES]
    if not out:      # e.g. "pl. Jana Pawla II": keep the given names
        out = [t for t in raw if len(t) >= 2 and t not in BASIC]
    return out


ENDINGS = {"", "a", "e", "i", "o", "u", "y", "ej", "iej", "ego", "iego", "emu", "ich", "ych", "im",
           "ym", "ow", "ach", "ami", "om", "ie", "iem", "em"}


def tok_eq(a, b):
    """Same word up to a Polish inflection ending (Zapolskiej ~ Zapolska,
    but Borowska !~ Borowa, Olimpijski !~ Olimpijczykow)."""
    if a == b:
        return True
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    if min(len(a), len(b)) < 5 or n < 4:
        return False
    return a[n:] in ENDINGS and b[n:] in ENDINGS


def name_match(kbr, osm):
    """True when every significant token of the KBR street name appears in the
    OSM way name (case/diacritics/prefix/declension-insensitive)."""
    q = toks(kbr)
    c = toks(osm)
    if not q or not c:
        return False
    return all(any(tok_eq(a, b) for b in c) for a in q)


def split_names(name):
    """'ul. Krzywoustego/al. Sobieskiego' -> two names; drops '(...)' remarks."""
    n = re.sub(r"\(.*?\)", " ", str(name or ""))
    parts = re.split(r"\s*/\s*|\s+-\s+|\s+–\s+|,", n)
    return [p.strip() for p in parts if toks(p)]


# ------------------------------------------------------------------ OSM index
class Ways:
    def __init__(self, path):
        self.ways = [w for w in json.load(open(path, encoding="utf8")) if w.get("name") and w.get("g")]
        self.byname = collections.defaultdict(list)
        for w in self.ways:
            self.byname[w["name"]].append(w)
        self.grid = collections.defaultdict(list)
        for wi, w in enumerate(self.ways):
            g = w["g"]
            for i in range(len(g) - 1):
                for cell in self._cells(g[i], g[i + 1]):
                    self.grid[cell].append((wi, i))
        self._mcache = {}

    @staticmethod
    def _cell(p):
        return (int(p[0] / 0.002), int(p[1] / 0.003))

    def _cells(self, a, b):
        c1, c2 = self._cell(a), self._cell(b)
        out = set()
        for i in range(min(c1[0], c2[0]), max(c1[0], c2[0]) + 1):
            for j in range(min(c1[1], c2[1]), max(c1[1], c2[1]) + 1):
                out.add((i, j))
        return out

    def names_matching(self, kbr):
        if kbr not in self._mcache:
            self._mcache[kbr] = [n for n in self.byname if name_match(kbr, n)]
        return self._mcache[kbr]

    def nearest_named(self, p, kbr_names):
        """(dist_m, osm_name, proj) to the nearest way matching any of the names."""
        best = (None, None, None)
        for kn in kbr_names:
            for on in self.names_matching(kn):
                for w in self.byname[on]:
                    d, q = poly_dist(p, w["g"])
                    if best[0] is None or d < best[0]:
                        best = (d, on, q)
        return best

    def nearest_any(self, p, k=3, radius_cells=1):
        c = self._cell(p)
        seen = {}
        for i in range(c[0] - radius_cells, c[0] + radius_cells + 1):
            for j in range(c[1] - radius_cells, c[1] + radius_cells + 1):
                for wi, si in self.grid.get((i, j), ()):
                    w = self.ways[wi]
                    d, q, _ = seg_dist(p, w["g"][si], w["g"][si + 1])
                    n = w["name"]
                    if n not in seen or d < seen[n][0]:
                        seen[n] = (d, q)
        return sorted(((v[0], n, v[1]) for n, v in seen.items()))[:k]

    def geoms(self, kbr):
        return [w["g"] for on in self.names_matching(kbr) for w in self.byname[on]]


def crossing(ways, street, cross, near=None, tol=40.0):
    """Points where ways named `street` meet ways named `cross` (within tol m).
    Returns list of [lat, lon]; if near given, sorted by distance to it."""
    ga, gb = ways.geoms(street), ways.geoms(cross)
    hits = []
    for a in ga:
        for p in a:
            for b in gb:
                d, q = poly_dist(p, b)
                if d <= tol:
                    hits.append(p)
                    break
    for b in gb:
        for p in b:
            for a in ga:
                d, q = poly_dist(p, a)
                if d <= tol:
                    hits.append(p)
                    break
    if near:
        hits.sort(key=lambda h: hav(h, near))
    return hits


# ------------------------------------------------------------------ boundary
class Boundary:
    """Wroclaw municipal boundary from cache/wroclaw_boundary.json (outer ways)."""
    def __init__(self, path):
        self.ways = json.load(open(path))
        self.segs = [(g[i], g[i + 1]) for g in self.ways for i in range(len(g) - 1)]

    def inside(self, p):
        y, x = p
        c = False
        for a, b in self.segs:
            if (a[0] > y) != (b[0] > y):
                xi = a[1] + (y - a[0]) * (b[1] - a[1]) / (b[0] - a[0])
                if xi > x:
                    c = not c
        return c

    def dist(self, p):
        return min(seg_dist(p, a, b)[0] for a, b in self.segs)

    def cross_line(self, p, q):
        """Points where straight line p->q crosses the boundary."""
        out = []
        for a, b in self.segs:
            d = (q[1] - p[1]) * (b[0] - a[0]) - (q[0] - p[0]) * (b[1] - a[1])
            if d == 0:
                continue
            t = ((a[1] - p[1]) * (b[0] - a[0]) - (a[0] - p[0]) * (b[1] - a[1])) / d
            u = ((a[1] - p[1]) * (q[0] - p[0]) - (a[0] - p[0]) * (q[1] - p[1])) / d
            if 0 <= t <= 1 and 0 <= u <= 1:
                out.append([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
        return out
