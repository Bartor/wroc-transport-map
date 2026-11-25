# -*- coding: utf-8 -*-
"""How people choose between walking, cycling, driving and public transport.

A nested logit on the household survey's trips (diary.py), so the app can ask
what a slower car or a quicker bus would do to the shares. Nothing in the
survey is a price, so scenarios are in minutes only.

    python etl/choice_los.py       # zone-to-zone times first
    python etl/choice.py           # -> public/data/choice.json
"""
import collections, json, math, os, random, sys
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

import choice_los
import diary

OUT = os.path.join(diary.ROOT, "public", "data", "choice.json")
log = lambda *a: print(*a, file=sys.stderr, flush=True)

WORKERS = 6
BOOT = int(os.environ.get("BOOT", 60))   # households redrawn this many times
ALTS = ["walk", "bike", "car", "pt"]
WALK_, BIKE_, CAR, PT = range(4)
MODE = {"pieszo": "walk", "rower": "bike", "komunikacja samochodowa": "car",
        "komunikacja zbiorowa": "pt"}
PURPOSE = {
    "dom - praca": "work", "praca - dom": "work", "podróże służbowe": "work",
    "dom - szkoła": "school", "szkoła - dom": "school",
    "dom - uczelnia": "uni", "uczelnia - dom": "uni",
    "dom - handel": "shop", "handel - dom": "shop",
    "dom - inne": "other", "inne - dom": "other", "dom - rekreacja": "other",
    "rekreacja - dom": "other", "niezwiązane z domem": "other",
}
# the survey's own groups; the last two part at 60 for women and 65 for men
AGES = ["6–15", "16–24", "25–44", "45–64", "65+"]
AGE = {"6-15 lat": 0, "16-19 lat": 1, "20-24 lata": 1, "25-44 lata": 2,
       "45-60 lat (K) i 45-65 lat (M)": 3, "pow. 60 lat (K) i pow. 65 lat (M)": 4}

# Reported car times start at a quarter of an hour whatever the distance, and
# grow 1.0-2.3 times as fast as our free-flow ones (the range is what error in
# the zones leaves open). The constant is the mode's own; this is the slope.
CAR_SLOPE = 1.5
BIKE = 14 / 3.6
MAX_WALK, MAX_BIKE = 8000.0, 25000.0     # metres beyond which nobody could
MIN_SHARE = 1 / 3                        # of departures with any connection
# a trip faster than its mode can go has an end written down wrong
TOO_FAST = {"walk": 10, "bike": 35, "car": 130, "pt": 70}   # km/h

# A minute is a minute, in a car or in a tram: one coefficient. Apart, the two
# come out alike, but the car's alone rests on little (t = 1). Out of the
# vehicle a minute costs more, as everywhere in the literature; the survey can't
# tell these weights apart, so they are assumed.
WAIT, FOOT, CHANGE = 1.5, 1.5, 5.0
# Walking and public transport share a nest: they replace each other more than
# either replaces the car. Without it the same trips fit 50 log-units worse and
# a slower car would move twice as many people.
NEST = (WALK_, PT)
INN = np.isin(np.arange(4), NEST)


def minutes(t):
    h, m, _ = str(t["min"]).split(":")
    return int(h) * 60 + int(m)


# ------------------------------------------------------------------- the table
def load(clean=True):
    """One row per trip the model can speak of, and why the rest are out."""
    codes, L = choice_los.load()
    ix = {c: i for i, c in enumerate(codes)}
    core = choice_los.core_zones()
    d = diary.load()
    P, out, why = d["people"], [], collections.Counter()
    for t in d["trips"]:
        p = P[t["person"]]
        m = MODE.get(t.get("mode"))
        o, e = str(t["from"]), str(t["to"])
        if m is None:
            why["other mode"] += 1
            continue
        if o not in ix or e not in ix:
            why["an end off the map"] += 1
            continue
        los = L[ix[o], ix[e]]
        if not np.isfinite(los[0]):
            why["no road between"] += 1
            continue
        av = [los[1] <= MAX_WALK, los[1] <= MAX_BIKE, True, bool(los[7] >= MIN_SHARE)]
        if not av[ALTS.index(m)]:
            why["%s chosen but not to be had" % m] += 1
            continue
        mins = minutes(t) if t.get("min") else None
        if clean and mins and o != e and los[1] / 1000 / (mins / 60) > TOO_FAST[m]:
            why["%s impossibly fast" % m] += 1
            continue
        out.append({
            "y": ALTS.index(m), "av": av, "w": float(p["w"]), "home": p["home"],
            "person": t["person"], "from": o, "to": e,
            "purpose": PURPOSE[t["purpose"]], "age": AGE[p["age"]],
            "cars": 0 if p["cars"].startswith("brak") else int(p["cars"][0]),
            "licence": p["licence"] == "posiada", "pass": p["pass"] == "tak",
            "core": o in core or e in core, "into": e in core and o not in core,
            "sub": len(o) > 3 or len(e) > 3, "km": los[1] / 1000, "los": los,
        })
    return out, why


# ------------------------------------------------------------------- the model
def terms(socio="full"):
    """(coefficient, alternative, what it multiplies); the car is the base."""
    out = [("walk", "walk", "walk"), ("walk.12", "walk", "walkOver12"),
           ("walk.25", "walk", "walkOver25"), ("log.walk", "walk", "logWalk"),
           ("bike", "bike", "bike"), ("ride", "car", "car"), ("ride", "pt", "gjt"),
           ("lkm.car", "car", "lkm"), ("lkm.pt", "pt", "lkm")]
    for alt in ("walk", "bike", "pt"):
        out.append(("asc." + alt, alt, "one"))
        for v in ("age0", "age1", "age3", "age4", "school", "uni", "shop", "other",
                  "core", "sub"):
            out.append(("%s.%s" % (v, alt), alt, v))
        if socio in ("full", "cars"):
            for v in ("cars0", "cars2", "licence"):
                out.append(("%s.%s" % (v, alt), alt, v))
        if socio == "full":
            out.append(("pass." + alt, alt, "pass"))
    return out


def gjt(los):
    """A journey in minutes as felt: riding, and the rest weighted."""
    _, _, walk, w1, ivt, w2, boards, _ = los
    return ivt / 60 + WAIT * (min(w1 / 60, 10) + w2 / 60) + FOOT * walk / 60 + CHANGE * (boards - 1)


def values(r, slope=CAR_SLOPE):
    car, dist = r["los"][0], r["los"][1]
    walk = dist / choice_los.WALK / 60
    return {
        "one": 1.0, "walk": walk, "walkOver12": max(0.0, walk - 12),
        "walkOver25": max(0.0, walk - 25), "logWalk": math.log(walk + 1),
        "bike": dist / BIKE / 60, "car": slope * car / 60,
        "gjt": gjt(r["los"]) if r["av"][PT] else 0.0, "lkm": math.log(dist / 1000 + .5),
        "core": float(r["core"]), "sub": float(r["sub"]),
        "age%d" % r["age"]: 1.0, r["purpose"]: 1.0,
        "cars0": float(r["cars"] == 0), "cars2": float(r["cars"] >= 2),
        "licence": float(r["licence"]), "pass": float(r["pass"]),
    }


def design(rows, tm, slope=CAR_SLOPE):
    names = list(dict.fromkeys(n for n, _, _ in tm))
    at = {n: i for i, n in enumerate(names)}
    X = np.zeros((len(rows), 4, len(names)))
    for i, r in enumerate(rows):
        v = values(r, slope)
        for n, a, f in tm:
            X[i, ALTS.index(a), at[n]] += v.get(f, 0.0)
    return X, names


def table(rows):
    w = np.array([r["w"] for r in rows])
    return np.array([r["y"] for r in rows]), np.array([r["av"] for r in rows]), w / w.mean()


def _shares(X, av, th):
    lam = th[-1]
    u = np.where(av, X @ th[:-1], -200.0)
    a = np.where(INN, u / lam, -1e9)
    top = a.max(1, keepdims=True)
    e = np.exp(a - top) * INN
    s = e.sum(1)
    q = e / s[:, None]
    I = np.log(s) + top[:, 0]
    T = np.concatenate([np.where(INN, -1e9, u), (lam * I)[:, None]], 1)
    E = np.exp(T - T.max(1, keepdims=True))
    E /= E.sum(1, keepdims=True)
    return np.where(INN, E[:, -1:] * q, E[:, :4]), q, I, E[:, -1], u


def choose(X, av, th):
    """Each trip's shares; th ends in the nest's lambda."""
    return _shares(X, av, th)[0]


def lik(th, X, y, av, w):
    """Weighted log-likelihood and its gradient."""
    n, lam, row = len(y), th[-1], np.arange(len(y))
    P, q, I, nest, u = _shares(X, av, th)
    L = (w * np.log(np.maximum(P[row, y], 1e-300))).sum()
    yi = INN[y]
    D = np.zeros((n, 4))
    D[row, y] = 1
    g = np.where(yi[:, None], (D - q) / lam * INN + q * INN, D) - P
    ui = np.where(INN, u, 0)
    dI = -(q * ui).sum(1) / lam ** 2
    dl = np.where(yi, -ui[row, y] / lam ** 2 - dI + I + lam * dI, 0.0) - nest * (I + lam * dI)
    return L, np.append(np.einsum("n,nj,njk->k", w, g, X, optimize=True), (w * dl).sum())


def fit(X, y, av, w, start=None, it=600, ridge=1e-6, mnl=False):
    from scipy.optimize import minimize
    sc = np.maximum(1e-3, np.abs(X).max((0, 1)))
    Xs = X / sc
    x0 = np.append(np.zeros(X.shape[2]) if start is None else start[:-1] * sc,
                   1.0 if mnl else 0.8 if start is None else start[-1])

    def f(th):
        L, g = lik(th, Xs, y, av, w)
        return -L + ridge * (th[:-1] ** 2).sum(), -g + np.append(2 * ridge * th[:-1], 0)

    r = minimize(f, x0, jac=True, method="L-BFGS-B",
                 bounds=[(None, None)] * X.shape[2] + [(1, 1) if mnl else (0.25, 2)],
                 options=dict(maxiter=it, maxfun=it * 2))
    return np.append(r.x[:-1] / sc, r.x[-1]), -r.fun


# ------------------------------------------------------------------ validation
def folds(groups, k, seed=3):
    """Whole households to a fold: their trips echo one another."""
    ids = sorted(set(groups))
    random.Random(seed).shuffle(ids)
    f = {g: i % k for i, g in enumerate(ids)}
    return np.array([f[g] for g in groups])


def null_ll(y, av, w):
    """Log-likelihood of knowing only the shares of whatever is available."""
    X = np.zeros((len(y), 4, 3))
    for j, a in enumerate((WALK_, BIKE_, PT)):
        X[:, a, j] = 1
    return fit(X, y, av, w, it=300, mnl=True)[1]


def _cv(a):
    X, y, av, w, tr, start = a
    return fit(X[tr], y[tr], av[tr], w[tr], start)[0]


def _boot(a):
    X, y, av, w, groups, seed, start = a
    rng = np.random.default_rng(seed)
    ids, gi = np.unique(groups, return_inverse=True)
    n = np.bincount(rng.integers(0, len(ids), len(ids)), minlength=len(ids))
    return fit(X, y, av, w * n[gi], start)[0]


def cv(X, y, av, w, groups, start, pool, k=10):
    f = folds(groups, k)
    bs = pool.map(_cv, [(X, y, av, w, f != i, start) for i in range(k)], chunksize=1)
    p = np.zeros((len(y), 4))
    for i, th in enumerate(bs):
        p[f == i] = choose(X[f == i], av[f == i], th)
    return p, (w * np.log(p[np.arange(len(y)), y])).sum()


# ------------------------------------------------------------------- scenarios
def shifted(X, names, rows, car=0.0, pt=0.0, wait=0.0, scope="touch"):
    """The table with minutes added to the trips in scope."""
    X = X.copy()
    k = names.index("ride")
    on = np.array([r["core"] if scope == "touch" else r["into"] if scope == "into" else True
                   for r in rows], float)
    X[:, CAR, k] += car * on
    X[:, PT, k] += (pt + WAIT * wait) * on
    return X


SCENARIOS = [
    ("car +5 min, trips with an end in the core", dict(car=5, scope="touch")),
    ("public transport 3 min quicker into the core", dict(pt=-3, scope="into")),
    ("both, into the core", dict(car=5, pt=-3, scope="into")),
]


def effect(X, names, av, rows, w, th, kw, sel):
    W = w[sel, None]
    mean = lambda X: (W * choose(X, av, th)[sel]).sum(0) / W.sum()
    return mean(X), mean(shifted(X, names, rows, **kw))


def main():
    rows, why = load()
    tm = terms()
    X, names = design(rows, tm)
    y, av, w = table(rows)
    home = np.array([r["home"] for r in rows])
    into = np.array([r["into"] for r in rows])
    km = np.array([r["km"] for r in rows])
    n = len(rows)
    log("%d trips; left out: %s" % (n, dict(why)))
    n0 = null_ll(y, av, w)
    th, ll = fit(X, y, av, w)
    mn, llm = fit(X, y, av, w, mnl=True)
    with Pool(WORKERS) as pool:
        p, cll = cv(X, y, av, w, home, th, pool)
        draws = np.array(pool.map(_boot, [(X, y, av, w, home, s, th) for s in range(BOOT)],
                                  chunksize=1))
    k = names.index("ride")
    log("log-likelihood: shares only %.0f, plain logit %.1f, nested %.1f; rho2 %.3f, held out %.3f; "
        "lambda %.2f" % (n0, llm, ll, 1 - ll / n0, 1 - cll / n0, th[-1]))
    se = draws.std(0, ddof=1)
    for i, nm in enumerate(names + ["lambda"]):
        log("  %-14s %8.3f  se %.3f  t %.1f" % (nm, th[i], se[i], th[i] / se[i]))
    variants = {}
    for name, kw in (("without the pass", "cars"), ("without pass, cars, licence", "none")):
        x2, n2 = design(rows, terms(kw))
        t2, l2 = fit(x2, y, av, w)
        variants[name] = (x2, n2, t2)
        log("%s: LL %.1f ride %.4f lambda %.2f" % (name, l2, t2[n2.index("ride")], t2[-1]))
    for s in (1.0, 2.3):
        x2, n2 = design(rows, tm, s)
        variants["car time x%.1f" % s] = (x2, n2, fit(x2, y, av, w, th)[0])
    variants["plain logit"] = (X, names, mn)
    raw, _ = load(clean=False)
    xr, _ = design(raw, tm)
    yr, avr, wr = table(raw)
    tr = fit(xr, yr, avr, wr, th)[0]
    log("with the impossible trips left in (n=%d): ride %.4f lambda %.2f" % (len(raw), tr[k], tr[-1]))
    log("ride in variants: " + ", ".join("%s %.4f" % (a, t[m.index("ride")]) for a, (_, m, t) in variants.items()))

    bands = []
    for lab, lo, hi in (("<1", 0, 1), ("1-2", 1, 2), ("2-5", 2, 5), ("5-10", 5, 10), ("10+", 10, 999)):
        for dest, dm in (("core", into), ("other", ~into)):
            s = (km >= lo) & (km < hi) & dm
            if s.sum() < 60:
                continue
            o = np.bincount(y[s], w[s], 4) / w[s].sum()
            q = (w[s, None] * p[s]).sum(0) / w[s].sum()
            bands.append({"km": lab, "to": dest, "n": int(s.sum()),
                          "observed": [round(float(v), 3) for v in o],
                          "heldOut": [round(float(v), 3) for v in q]})
            log("%-5s %-6s n=%5d  " % (lab, dest, s.sum()) + "  ".join(
                "%s %.0f/%.0f%%" % (a, 100 * o[j], 100 * q[j]) for j, a in enumerate(ALTS)))
    cal = []
    for lo in range(10):
        s = (p[:, CAR] >= lo / 10) & (p[:, CAR] < (lo + 1) / 10 + (lo == 9))
        cal.append([round(float((w[s] * p[s, CAR]).sum() / w[s].sum()), 3),
                    round(float((w[s] * (y[s] == CAR)).sum() / w[s].sum()), 3), int(s.sum())])
    log("car, predicted against observed by tenths: %s" % cal)

    scen = []
    pct = lambda a, b: "%.1f->%.1f%%" % (100 * a, 100 * b)
    for name, kw in SCENARIOS:
        a, b = effect(X, names, av, rows, w, th, kw, into)
        ds = [np.subtract(*effect(X, names, av, rows, w, t, kw, into)[::-1]) for t in draws]
        lo, hi = np.quantile(ds, [.05, .95], 0)
        log("%s (n=%d into core): " % (name, into.sum()) + "  ".join(
            "%s %s (%+.1f..%+.1f)" % (m, pct(a[j], b[j]), 100 * lo[j], 100 * hi[j]) for j, m in enumerate(ALTS)))
        for lab, (x2, n2, t2) in variants.items():
            a2, b2 = effect(x2, n2, av, rows, w, t2, kw, into)
            log("   %-28s car %+.2f, pt %+.2f, walk %+.2f" % (lab, *(100 * (b2 - a2)[[CAR, PT, WALK_]])))
        scen.append({"name": name, "n": int(into.sum()),
                     "before": [round(float(v), 4) for v in a], "after": [round(float(v), 4) for v in b],
                     "lo90": [round(float(v), 4) for v in lo], "hi90": [round(float(v), 4) for v in hi]})
    a, b = effect(X, names, av, rows, w, th, SCENARIOS[0][1], np.ones(n, bool))
    log("the first, over all trips: car %s" % pct(a[CAR], b[CAR]))
    el = {}
    for j, nm in ((CAR, "car"), (PT, "pt")):
        for lab, sel in (("all", np.ones(n, bool)), ("intoCore", into)):
            X2 = X.copy()
            X2[:, j, k] *= 1.1
            q0, q1 = choose(X, av, th), choose(X2, av, th)
            el["%s.%s" % (nm, lab)] = round(float(math.log(
                (w[sel] * q1[sel, j]).sum() / (w[sel] * q0[sel, j]).sum()) / math.log(1.1)), 2)
    log("own-time elasticities: %s" % el)

    # --------------------------------------------------------------- the file
    codes, L = choice_los.load()
    ix = {c: i for i, c in enumerate(codes)}
    pairs = sorted({(str(t["from"]), str(t["to"])) for t in diary.load()["trips"]
                    if str(t["from"]) in ix and str(t["to"]) in ix})
    zones = sorted({z for pr in pairs for z in pr})
    zi = {z: i for i, z in enumerate(zones)}
    by = collections.OrderedDict()
    for o, e in pairs:
        los = L[ix[o], ix[e]]
        if not np.isfinite(los[0]):
            continue
        by.setdefault(zi[o], []).append((
            zi[e], round(los[0] / 60 * CAR_SLOPE * 10), round(los[1] / 10),
            round(gjt(los) * 10) if los[7] >= MIN_SHARE else -1))
    col = lambda j: [[row[j] for row in r] for r in by.values()]
    out = {
        "meta": {
            "n": n, "people": len({r["person"] for r in rows}), "homes": len({r["home"] for r in rows}),
            "leftOut": dict(why), "alts": ALTS, "lambdaNest": ["walk", "pt"],
            "rho2": round(1 - ll / n0, 3), "cvRho2": round(1 - cll / n0, 3),
            "cvLogLik": round(float(cll / n), 4), "nullLogLik": round(float(n0 / n), 4),
            "carSlope": CAR_SLOPE, "weights": {"wait": WAIT, "walk": FOOT, "change": CHANGE},
            "maxWalk": MAX_WALK, "maxBike": MAX_BIKE, "walk": choice_los.WALK, "bike": BIKE,
            "range": 10, "bands": bands, "calibration": cal, "elasticity": el,
            "scenarios": scen, "boot": BOOT, "ride": [round(float(th[k]), 4), round(float(se[k]), 4)],
        },
        "modes": MODE, "purposes": PURPOSE, "ages": AGES,
        "core": sorted(choice_los.core_zones()),
        "names": names, "terms": tm,
        # how far the answer moves with the model, not with the sample; a
        # variable a variant leaves out has no coefficient in it
        "variants": {key: [round(float(v), 5) for v in (
            *(dict(zip(n2, t2)).get(nm, 0.0) for nm in names), t2[-1])]
            for key, (_, n2, t2) in (("noPass", variants["without the pass"]),
                                     ("long", variants["without pass, cars, licence"]),
                                     ("plain", variants["plain logit"]))},
        "coef": [round(float(v), 5) for v in th],
        "draws": [[round(float(v), 4) for v in t] for t in draws[:40]],
        "zones": zones,
        "los": {"from": list(by), "to": col(0), "car": col(1), "dist": col(2), "pt": col(3)},
    }
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log("-> public/data/choice.json, %.0f kB" % (os.path.getsize(OUT) / 1000))


if __name__ == "__main__":
    main()
