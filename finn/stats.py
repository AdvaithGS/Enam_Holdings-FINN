"""The statistics FINN rests on. Pure functions, no I/O.

Notation
    r_t   = ln(P_t / P_{t-1})            log return on adjusted close
    m_t   = same for the NIFTY 50
    e_t   = r_t - (a + b m_t)            abnormal return; a, b by OLS on a trailing window
    v_t   = V_t / mean(V_{t-20..t-1})    volume relative to its 20-session average

"Unusual" is never a Gaussian z-score: daily returns are fat-tailed, so rarity is the
empirical tail frequency of the stock's own history,

    p_t = (1 + #{s in W : |e_s| >= |e_t|}) / (1 + |W|),

which is distribution-free and reads directly as "this happens about once in 1/p days".
"""
from __future__ import annotations

import math

import numpy as np

BETA_WINDOW = 250      # sessions used to fit the market model
RARITY_WINDOW = 500    # sessions that define "normal" for a stock
VOL_WINDOW = 20


def log_returns(prices: np.ndarray) -> np.ndarray:
    out = np.full(len(prices), np.nan)
    out[1:] = np.log(prices[1:] / prices[:-1])
    return out


def abnormal_returns(r: np.ndarray, m: np.ndarray, window: int = BETA_WINDOW,
                     min_obs: int = 60) -> tuple[np.ndarray, np.ndarray]:
    """Out-of-sample market-model residuals and the betas used.

    For day t the model is fitted on [t-window, t-1], so e_t never sees itself.
    Closed-form OLS via rolling sums: b = cov(r, m) / var(m), a = mean(r) - b mean(m).
    """
    n = len(r)
    e, beta = np.full(n, np.nan), np.full(n, np.nan)
    ok = ~(np.isnan(r) | np.isnan(m))
    for t in range(n):
        lo = max(0, t - window)
        w = ok[lo:t]
        if not ok[t] or w.sum() < min_obs:
            continue
        rr, mm = r[lo:t][w], m[lo:t][w]
        var = mm.var()
        b = float(((rr - rr.mean()) * (mm - mm.mean())).mean() / var) if var > 0 else 1.0
        a = float(rr.mean() - b * mm.mean())
        e[t], beta[t] = r[t] - (a + b * m[t]), b
    return e, beta


def volume_ratio(v: np.ndarray, window: int = VOL_WINDOW) -> np.ndarray:
    out = np.full(len(v), np.nan)
    c = np.concatenate([[0.0], np.cumsum(v, dtype=float)])
    for t in range(window, len(v)):
        base = (c[t] - c[t - window]) / window
        if base > 0:
            out[t] = v[t] / base
    return out


def tail_prob(x: np.ndarray, window: int = RARITY_WINDOW, min_obs: int = 120) -> np.ndarray:
    """p_t = (1 + #{s in trailing window : x_s >= x_t}) / (1 + n). x must be >= 0."""
    out = np.full(len(x), np.nan)
    for t in range(len(x)):
        if np.isnan(x[t]):
            continue
        w = x[max(0, t - window):t]
        w = w[~np.isnan(w)]
        if len(w) >= min_obs:
            out[t] = (1 + int((w >= x[t]).sum())) / (1 + len(w))
    return out


def ridge_logistic(X: np.ndarray, y: np.ndarray, lam: float = 1.0, iters: int = 50
                   ) -> tuple[np.ndarray, np.ndarray]:
    """Maximum a-posteriori logistic regression by Newton's method.

    Model  P(y=1|x) = s(b0 + x.b),  prior b_j ~ N(0, 1/lam) on every coefficient
    except the intercept. Returns (coefficients incl. intercept first, standard errors
    from the inverse Hessian at the optimum).
    """
    n, k = X.shape
    A = np.hstack([np.ones((n, 1)), X])
    P = np.eye(k + 1) * lam
    P[0, 0] = 0.0
    w = np.zeros(k + 1)
    w[0] = math.log(max(y.mean(), 1e-6) / max(1 - y.mean(), 1e-6))
    def objective(w):
        z = A @ w
        # negative penalised log-likelihood; logaddexp keeps it finite for large |z|
        return float(np.logaddexp(0, z).sum() - y @ z + 0.5 * w @ P @ w)

    H = np.eye(k + 1)
    f = objective(w)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-np.clip(A @ w, -30, 30)))
        g = A.T @ (p - y) + P @ w
        H = (A * (p * (1 - p))[:, None]).T @ A + P
        step = np.linalg.solve(H, g)
        t = 1.0  # backtracking: the objective is convex, so halving always terminates
        while t > 1e-6 and objective(w - t * step) > f:
            t /= 2
        w = w - t * step
        f_new = objective(w)
        if f - f_new < 1e-10:
            break
        f = f_new
    p = 1 / (1 + np.exp(-np.clip(A @ w, -30, 30)))
    H = (A * (p * (1 - p))[:, None]).T @ A + P
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return w, se


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def cagr(first: float, last: float, years: float) -> float | None:
    """Compound annual growth; undefined when either end is non-positive."""
    if first is None or last is None or years <= 0 or first <= 0 or last <= 0:
        return None
    return (last / first) ** (1 / years) - 1
