"""A logistic model with crossed random effects, fitted by the Laplace
approximation: eta = X b + sum_k u_k[idx_k], each u_k ~ N(0, sd_k^2), with an
optional effect each row has once (a household), eliminated by its Schur
complement. The sds maximise the approximate marginal likelihood (Nelder-Mead
on their logs) under a weak prior that keeps them off zero; numpy and scipy
only. statsmodels' variational fit collapsed the district sd here.

Set BLAS to one thread before numpy is imported when fitting in parallel.
"""
import os
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1"); os.environ.setdefault("OMP_NUM_THREADS", "1"); os.environ.setdefault("MKL_NUM_THREADS", "1")
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
import scipy.sparse as sp
from scipy.linalg import cho_factor, cho_solve

GH_X, GH_W = np.polynomial.hermite_e.hermegauss(41)
GH_W = GH_W / GH_W.sum()


def marg(eta, sd):
    """E expit(eta + sd*z), z~N(0,1)"""
    if sd < 1e-6:
        return expit(eta)
    return expit(np.asarray(eta)[..., None] + sd * GH_X) @ GH_W


class Fit:
    pass


def fit(y, X, factors, diag=None, prior_sd=3.0, start=None, fixed_ls=None):
    """factors: list of int index arrays (dense-handled).
    diag: index array of a factor each obs belongs to once (household)."""
    n, p = X.shape
    sizes = [int(f.max()) + 1 for f in factors]
    offs = np.cumsum([p] + sizes)
    q = offs[-1]
    D = sp.hstack([sp.csr_matrix(X)] + [sp.csr_matrix((np.ones(n), (np.arange(n), f)), shape=(n, s)) for f, s in zip(factors, sizes)]).tocsr()
    DT = D.T.tocsr()
    nh = int(diag.max()) + 1 if diag is not None else 0
    ZhT = sp.csr_matrix((np.ones(n), (diag, np.arange(n))), shape=(nh, n)) if nh else None
    K = len(factors) + (diag is not None)
    state = {"d": np.zeros(q), "h": np.zeros(nh)}

    def hess(w, pen, ph):
        Dw = sp.diags(w) @ D
        Hdd = (DT @ Dw).toarray() + np.diag(pen)
        if nh:
            Hhh = np.bincount(diag, w, nh) + ph
            B = (ZhT @ Dw).tocsr()
            return Hdd - (B.T @ sp.diags(1 / Hhh) @ B).toarray(), B, Hhh
        return Hdd, None, None

    def inner(ls):
        sd = np.exp(ls)
        pen = np.full(q, 1e-4)  # weak ridge on fixed effects
        for k, (o, s) in enumerate(zip(offs, sizes)):
            pen[o:o + s] = 1 / sd[k] ** 2
        ph = 1 / sd[-1] ** 2 if nh else 0
        d, h = state["d"].copy(), state["h"].copy()

        def pl(d, h):
            eta = D @ d + (h[diag] if nh else 0)
            ll = (y * eta - np.logaddexp(0, eta)).sum()
            return ll - 0.5 * (pen * d * d).sum() - 0.5 * ph * (h * h).sum(), eta
        cur, eta = pl(d, h)
        for it in range(60):
            pr = expit(eta)
            w = pr * (1 - pr)
            r = y - pr
            gd = D.T @ r - pen * d
            S, B, Hhh = hess(w, pen, ph)
            if nh:
                gh = np.bincount(diag, r, nh) - ph * h
                rhs = gd - B.T @ (gh / Hhh)
            else:
                rhs = gd
            dd = cho_solve(cho_factor(S, lower=True), rhs)
            dh = (gh - B @ dd) / Hhh if nh else 0
            step = 1.0
            while True:
                new, eta2 = pl(d + step * dd, h + step * dh)
                if new >= cur - 1e-10 or step < 1e-4:
                    break
                step /= 2
            d, h, eta = d + step * dd, h + step * dh, eta2
            done = abs(new - cur) < 1e-8
            cur = new
            if done:
                break
        pr = expit(eta)
        w = pr * (1 - pr)
        S, B, Hhh = hess(w, pen, ph)
        logdet = np.log(Hhh).sum() if nh else 0.0
        L = np.linalg.cholesky(S)
        logdet += 2 * np.log(np.diag(L)).sum()
        state["d"], state["h"] = d, h
        lap = cur - 0.5 * logdet - sum(s * l for s, l in zip(sizes, ls)) - (nh * ls[-1] if nh else 0)
        # boundary-avoiding prior on sd: gamma(shape 2) x half-normal(prior_sd), on the log-sd scale
        lap += (2 * ls - sd ** 2 / (2 * prior_sd ** 2)).sum()
        return lap, d, h, S, eta

    if fixed_ls is not None:
        ls = np.asarray(fixed_ls, float)
        nfev = 1
    else:
        obj = lambda ls: -inner(np.clip(ls, -6, 3))[0]
        x0 = np.full(K, -0.7) if start is None else np.asarray(start, float)
        res = minimize(obj, x0, method="Nelder-Mead", options={"xatol": 0.02, "fatol": 0.01, "maxiter": 400})
        ls = np.clip(res.x, -6, 3)
        nfev = res.nfev
    lap, d, h, S, eta = inner(ls)
    F = Fit()
    F.sd = np.exp(ls); F.ls = ls; F.lap = lap; F.d = d; F.h = h; F.S = S; F.p = p; F.offs = offs; F.sizes = sizes
    F.D = D; F.eta = eta; F.nfev = nfev; F.beta = d[:p]
    F.u = [d[o:o + s] for o, s in zip(offs, sizes)]
    F.cov = np.linalg.inv(S)
    return F
