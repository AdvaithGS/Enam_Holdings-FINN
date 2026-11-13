"""The statistics FINN rests on. Pure functions, no I/O.

Notation
    r_t   = ln(P_t / P_{t-1})            log return on adjusted close
    m_t   = same for the NIFTY 50
    e_t   = r_t - (a + b m_t)            abnormal return; a, b by exponentially weighted
                                         least squares, half-life 90 sessions (conditional beta)
    v_t   = V_t / mean(V_{t-20..t-1})    volume relative to its 20-session average

    s_t   = conditional volatility of e_t, GARCH(1,1), known at the close of t-1
    z_t   = e_t / s_t                    the move in units of that day's expected size

"Unusual" is never a Gaussian z-score: daily returns are fat-tailed, so rarity is the
empirical tail frequency of the stock's own history,

    p_t = (1 + #{s in W : |z_s| >= |z_t|}) / (1 + |W|),

which is distribution-free and reads directly as "this happens about once in 1/p days".
It is taken on z, not e: volatility clusters, so in a turbulent month every stock's raw
residual looks rare at once. Dividing by s_t first asks the sharper question, "is this
large for the state the stock is in?" (filtered historical simulation).
"""
from __future__ import annotations

import math

try:  # the serverless research path needs only the scalar helpers below
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

BETA_WINDOW = 250      # sessions used to fit the market model
RARITY_WINDOW = 500    # sessions that define "normal" for a stock
VOL_WINDOW = 20


def log_returns(prices):
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


# GARCH(1,1) parameter grid. Variance targeting fixes the long-run level, so only the
# reaction (a) and persistence (b) are searched; a = b = 0 is constant variance, which
# the data may prefer. A grid is coarse but cannot fail to converge on 250 points.
_GRID = [(0.0, 0.0)] + [(0.02 * i, 0.50 + 0.02 * j) for i in range(1, 16) for j in range(25)
                        if 0.02 * i + 0.50 + 0.02 * j < 0.995]
GARCH_MIN, GARCH_MAX, GARCH_REFIT = 120, 750, 21


def _garch_fit(x2: np.ndarray) -> tuple[float, float, float, float]:
    """Quasi-maximum-likelihood GARCH(1,1) on squared residuals x2, by grid.

        s2_t = w + a x2_{t-1} + b s2_{t-1},      w = v (1 - a - b),  v = mean(x2)

    Returns (w, a, b, s2 forecast for the session after the sample).
    """
    v = float(x2.mean())
    if not v > 0:
        return 0.0, 0.0, 0.0, 0.0
    a, b = (np.array(col) for col in zip(*_GRID))
    w = v * (1 - a - b)
    s2 = np.full(len(a), v)
    ll = np.zeros(len(a))
    for x in x2:
        ll -= np.log(s2) + x / s2
        s2 = w + a * x + b * s2
    k = int(np.argmax(ll))
    return float(w[k]), float(a[k]), float(b[k]), float(s2[k])


def garch_vol(e: np.ndarray, min_obs: int = GARCH_MIN, max_obs: int = GARCH_MAX,
              refit: int = GARCH_REFIT) -> np.ndarray:
    """One-step-ahead conditional volatility of e, strictly out of sample.

    s_t uses parameters fitted on residuals up to t-1 (re-estimated every `refit`
    sessions on at most `max_obs` of them) and the recursion run up to t-1.
    """
    out = np.full(len(e), np.nan)
    idx = np.flatnonzero(~np.isnan(e))
    x2 = e[idx] ** 2
    w = a = b = s2 = 0.0
    for i in range(min_obs, len(idx)):
        if (i - min_obs) % refit == 0:
            w, a, b, s2 = _garch_fit(x2[max(0, i - max_obs):i])
        else:
            s2 = w + a * x2[i - 1] + b * s2
        if s2 > 0:
            out[idx[i]] = math.sqrt(s2)
    return out


# Chosen by measurement, not taste: out-of-sample residual variance against a flat 250-session
# fit, over 23,224 stock-sessions of this portfolio, is 1.011 at a half-life of 30, 1.001 at 60,
# 0.999 at 90 and 0.998 at 125 (and 1.030 / 0.997 at 30 / 90 on days the NIFTY moved 1.2%+).
# A 30-session half-life chases noise; 90 is the shortest that beats the flat fit.
BETA_HALFLIFE = 90


def ew_abnormal_returns(r: np.ndarray, m: np.ndarray, halflife: float = BETA_HALFLIFE, min_obs: int = 60
                        ) -> tuple[np.ndarray, np.ndarray]:
    """Market-model residuals with a conditional beta, out of sample.

    Weighted least squares with weight L^k on the observation k sessions back,
    L = 0.5^(1/halflife): the most recent `halflife` sessions carry half the weight, so
    beta follows the stock's current behaviour rather than its average over a year.

        b_t = (E[r m] - E[r] E[m]) / (E[m^2] - E[m]^2),   E = exponentially weighted mean
        a_t = E[r] - b_t E[m],   e_t = r_t - (a_t + b_t m_t)

    The weighted sums are updated recursively and day t enters them only after e_t is
    computed. The effective sample is (1+L)/(1-L), about 260 sessions at a 90-session
    half-life, with the latest 30 sessions carrying 21% of the weight (12% in a flat fit).
    """
    n, lam = len(r), 0.5 ** (1 / halflife)
    e, beta = np.full(n, np.nan), np.full(n, np.nan)
    w = sr = sm = srm = smm = 0.0
    seen = 0
    for t in range(n):
        if np.isnan(r[t]) or np.isnan(m[t]):
            continue
        if seen >= min_obs:
            mr, mm = sr / w, sm / w
            var = smm / w - mm * mm
            b = (srm / w - mr * mm) / var if var > 0 else 1.0
            e[t], beta[t] = r[t] - (mr - b * mm + b * m[t]), b
        w, sr, sm = lam * w + 1, lam * sr + r[t], lam * sm + m[t]
        srm, smm = lam * srm + r[t] * m[t], lam * smm + m[t] * m[t]
        seen += 1
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
