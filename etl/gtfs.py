# -*- coding: utf-8 -*-
"""Adapter for Wroclaw's open-data timetable feed (GTFS, CC0 1.0).

Service frequency is the variable the transit model was missing: OSM route
relations say a street carries line 33, not that 33 runs every four minutes.
The city publishes the full timetable hourly, so we take it from the source.

Two endpoints, discovered rather than hardcoded:

    https://api.open-data.cui.wroclaw.pl/od2/6/   -> {"pliki": [127, 125, ...]}
    https://open-data.cui.wroclaw.pl/hdb/download/<id>/  -> the GTFS zip

The list is newest first. Note the portal at www.wroclaw.pl answers 403 to
anything scripted; open-data.cui.wroclaw.pl is the host that works.
"""
import csv, io, json, os, sys, zipfile, collections, datetime
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geocode

CACHE = geocode.CACHE
API = "https://api.open-data.cui.wroclaw.pl/od2/6/"
DOWNLOAD = "https://open-data.cui.wroclaw.pl/hdb/download/%d/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "*/*"}

log = lambda *a: print(*a, file=sys.stderr, flush=True)


def _get(url, timeout=180):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as f:
        return f.read()


def latest_id():
    js = json.loads(_get(API, timeout=60))
    ids = js.get("pliki") or []
    if not ids:
        raise RuntimeError("open-data API returned no files for dataset 6")
    return ids[0]


def download(force=False):
    """The newest timetable zip, cached on disk."""
    marker = os.path.join(CACHE, "gtfs_id.txt")
    fid = latest_id()
    path = os.path.join(CACHE, "gtfs_%d.zip" % fid)
    if os.path.exists(path) and not force:
        return path
    log("downloading GTFS file %d ..." % fid)
    blob = _get(DOWNLOAD % fid, timeout=600)
    with open(path, "wb") as f:
        f.write(blob)
    open(marker, "w").write(str(fid))
    log("  %.1f MB -> %s" % (len(blob) / 1e6, os.path.basename(path)))
    return path


def _rows(z, name):
    with z.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            yield r


def _secs(hhmmss):
    try:
        h, m, s = (int(x) for x in hhmmss.split(":"))
        return h * 3600 + m * 60 + s
    except Exception:
        return None


def typical_weekday(z):
    """The service_id set covering an ordinary Wednesday in the feed period."""
    active = collections.Counter()
    try:
        for r in _rows(z, "calendar.txt"):
            if r.get("wednesday") == "1":
                active[r["service_id"]] += 1
    except KeyError:
        pass
    if not active:                       # feeds that only use calendar_dates
        by_date = collections.defaultdict(set)
        for r in _rows(z, "calendar_dates.txt"):
            if r.get("exception_type") == "1":
                by_date[r["date"]].add(r["service_id"])
        best = max(by_date.items(), key=lambda kv: len(kv[1]))[1] if by_date else set()
        return best
    return set(active)


def departures_by_shape(window_hours, path=None):
    """Vehicles per shape in the window, on a typical weekday, split by mode.

    Returns {shape_id: {"tram": n, "bus": n, "pts": [[lat, lon], ...]}}.
    A trip counts once, at the time it passes its first stop.
    """
    path = path or download()
    lo = min(window_hours) * 3600
    hi = (max(window_hours) + 1) * 3600
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        services = typical_weekday(z)
        route_mode = {}
        for r in _rows(z, "routes.txt"):
            # GTFS route_type: 0 tram, 3 bus
            route_mode[r["route_id"]] = "tram" if r.get("route_type") == "0" else "bus"

        trips = {}
        for r in _rows(z, "trips.txt"):
            if services and r.get("service_id") not in services:
                continue
            trips[r["trip_id"]] = (r.get("shape_id"), route_mode.get(r["route_id"], "bus"))
        log("  %d trips on a typical weekday" % len(trips))

        # first departure per trip, straight out of stop_times
        first = {}
        for r in _rows(z, "stop_times.txt"):
            t = r["trip_id"]
            if t not in trips:
                continue
            if r.get("stop_sequence") in ("1", "0") or t not in first:
                s = _secs(r.get("departure_time") or r.get("arrival_time") or "")
                if s is not None and (t not in first or s < first[t]):
                    first[t] = s

        # "day" counts every weekday trip on the shape and is exact. "win" only
        # counts trips whose FIRST stop falls in the window, which is an
        # approximation for mid-route streets - a run leaving at 05:50 reaches
        # the middle of its route inside the window but is not counted.
        out = collections.defaultdict(
            lambda: {"tram": 0, "bus": 0, "dayTram": 0, "dayBus": 0})
        counted = 0
        for t, (shape, mode) in trips.items():
            s = first.get(t)
            if s is None or not shape:
                continue
            out[shape]["day" + mode.capitalize()] += 1
            if (s // 3600) % 24 in window_hours:
                out[shape][mode] += 1
                counted += 1
        log("  %d shapes, %d trips in the window" % (len(out), counted))

        if "shapes.txt" in names:
            pts = collections.defaultdict(list)
            for r in _rows(z, "shapes.txt"):
                sid = r["shape_id"]
                if sid in out:
                    pts[sid].append((int(r["shape_pt_sequence"]),
                                     float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
            for sid, ps in pts.items():
                ps.sort()
                out[sid]["pts"] = [[a, b] for _, a, b in ps]
        return dict(out)


def summary(path=None):
    path = path or download()
    with zipfile.ZipFile(path) as z:
        return {n: z.getinfo(n).file_size for n in z.namelist()}


if __name__ == "__main__":
    p = download()
    for n, s in sorted(summary(p).items()):
        print("%-22s %8.2f MB" % (n, s / 1e6))
