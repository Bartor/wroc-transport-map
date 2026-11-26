"""Opinions as an average interviewer would have recorded them.

Answers to the survey's opinion questions depend on who asked far more than on
where people live: on the logit scale the interviewers' sd is 1-3, districts'
0.3-0.5, and what the respondents are (age, sex, schooling, mode, cars, ...)
does not explain it. Each interviewer worked in several districts, so the two
can be told apart (Vassallo, Durrant & Smith 2017; O'Muircheartaigh & Campanelli
1998).

For every option of a question, and for its "good" answers together, a
logistic model with crossed random effects of interviewer, district and zone
and the respondent's traits as fixed effects (glmm.py). A person's corrected
value is the model's prediction with the interviewer averaged out, which the
app sums with the survey weights like any answer (poststratification to the
weighted sample). Its uncertainty comes from draws of the effects around the
fit: the level of a city or district is uncertain by much more than its count
says, because there are only some forty interviewers.

Interviewers who recorded nearly one answer for everyone are kept: the model
makes them nearly uninformative. They are named, and the question is fitted
again without them, so the app can say how much that changes. How well the
pattern of districts holds is measured by fitting each half of the
interviewers apart (split-half), several times.

    python etl/interviewers.py check    # the fitter recovers known sds
"""
import os
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1"); os.environ.setdefault("OMP_NUM_THREADS", "1"); os.environ.setdefault("MKL_NUM_THREADS", "1")
import sys
import numpy as np
from scipy.special import expit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glmm

DRAWS = 120          # draws of the effects for the uncertainty
COVER = 1.15         # what the draws miss of the sds' own uncertainty (89-93% coverage)
FEW = 50             # fewer yes or no answers than this: not fitted, shown raw
SPLITS = 6


def traits(P):
    """The respondent's traits, as dummies: what the groups of the app are made of."""
    cols = {
        "age": lambda p: p["age"], "sex": lambda p: p["sex"] if p["sex"] in ("kobieta", "mężczyzna") else "kobieta",
        "school": lambda p: p["school"] or "?", "usual": lambda p: p["usual"] or "?", "cars": lambda p: p["cars"] or "?",
        "job": lambda p: p["job"] or "?", "kids": lambda p: p["smallKids"] or "?", "limited": lambda p: p["mobility"] or "?",
    }
    out = [np.ones(len(P))]
    for f in cols.values():
        vals = [f(p) for p in P]
        levels = sorted(set(vals), key=str)
        for lev in levels[1:]:
            out.append(np.array([v == lev for v in vals], float))
    size = np.array([min(5, float(p["nPeople"] or 1)) for p in P])
    out.append(size - 3)
    return np.column_stack(out)


def _fit(y, X, factors):
    """The model, or a simpler one, or None. Every sd at its mode."""
    for k in (len(factors), 2):
        try:
            F = glmm.fit(y, X, factors[:k])
        except Exception:
            continue
        if np.all((F.ls > -5.9) & (F.ls < 2.9)) and np.isfinite(F.lap):
            return F
    return None


def _without(F, X, factors):
    """The design without the interviewer's columns, to predict with."""
    import scipy.sparse as sp
    n = X.shape[0]
    cols = [sp.csr_matrix(X)]
    for k, (f, s) in enumerate(zip(factors[:len(F.sizes)], F.sizes)):
        cols.append(sp.csr_matrix((np.ones(n) * (k > 0), (np.arange(n), f)), shape=(n, s)))
    return sp.hstack(cols).tocsr()


def job(args):
    """One set of options: the corrected value of each person, its draws, the
    interviewers' effects. Factors: interviewer first."""
    y, X, factors, seed, draws = args
    F = _fit(y, X, factors)
    if F is None:
        return None
    D0 = _without(F, X, factors)
    mean = glmm.marg(D0 @ F.d, F.sd[0])
    out = {"mean": mean.astype(np.float32), "sd": [round(float(s), 3) for s in F.sd], "u": F.u[0]}
    if draws:
        rng = np.random.default_rng(seed)
        L = np.linalg.cholesky(F.cov + 1e-12 * np.eye(len(F.d)))
        out["draws"] = np.stack([glmm.marg(D0 @ (F.d + L @ rng.standard_normal(len(F.d))), F.sd[0])
                                 for _ in range(draws)], axis=1).astype(np.float32)
    return out


def run(tasks, workers=None):
    """Jobs in parallel, in their order."""
    import multiprocessing as mp
    with mp.get_context("spawn").Pool(workers or max(1, (os.cpu_count() or 2) - 2)) as pool:
        return pool.map(job, tasks, chunksize=1)


def district_means(values, w, di, keep):
    """Weighted mean of each district with enough answers."""
    return {d: float(w[di == d] @ values[di == d] / w[di == d].sum()) for d in keep}


def check():
    """Known sds come back from data made on a design like the survey's."""
    rng = np.random.default_rng(3)
    n, A, Dn, Zn = 6000, 40, 50, 300
    zone = rng.integers(0, Zn, n)
    district = zone % Dn
    # each interviewer works in a few districts
    home = rng.integers(0, A, Dn * 3).reshape(Dn, 3)
    asker = home[district, rng.integers(0, 3, n)]
    X = np.column_stack([np.ones(n), rng.standard_normal(n)])
    eta = -0.2 + 0.5 * X[:, 1] + 2.0 * rng.standard_normal(A)[asker] + 0.4 * rng.standard_normal(Dn)[district] \
        + 0.5 * rng.standard_normal(Zn)[zone]
    y = (rng.random(n) < expit(eta)).astype(float)
    F = glmm.fit(y, X, [asker, district, zone])
    print("sd of interviewer, district, zone: %.2f %.2f %.2f (made with 2.0 0.4 0.5)" % tuple(F.sd))
    assert 1.4 < F.sd[0] < 2.8 and 0.15 < F.sd[1] < 0.8, F.sd


if __name__ == "__main__":
    check()
