"""How much does each kind of filing matter? Measured, not asserted.

An event study over the portfolio's own history. For every (stock, session) we know
which categories of filing arrived and whether the market *noticed*, defined as

    y = 1  if  min(p_return, p_volume) <= ALPHA

where p_return and p_volume are the empirical tail probabilities of that session's
abnormal return (in units of its GARCH conditional volatility) and relative volume
against the stock's own trailing 500 sessions (see stats.py). A filing made after the 15:30 close, or on a holiday, belongs to the
next session, because that is when the market could first react.

Several categories usually arrive together (results + press release + call notice),
so raw frequencies would credit all of them with the reaction to one. We therefore fit

    logit P(y = 1) = b0 + sum_c b_c x_c         x_c = 1 if category c was filed

by ridge-penalised maximum likelihood. b0 is the no-filing baseline; sigmoid(b0 + b_c)
is the chance the market notices a session whose only filing is of category c. The
ridge prior N(0, 1/LAMBDA) shrinks categories with little data toward "no effect",
so a category seen five times cannot earn a large prior by luck.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np

from . import stats
from .taxonomy import CATEGORIES, classify

ALPHA = 0.05
LAMBDA = 4.0
CLOSE = dt.time(15, 30)
MODEL_PATH = Path(__file__).resolve().parent.parent / "data" / "materiality.json"


def session_of(at: dt.datetime, sessions: list[str]) -> str | None:
    """The first trading session on which a filing made at `at` could be traded."""
    day = at.date().isoformat()
    target = day if at.time() <= CLOSE else (at.date() + dt.timedelta(days=1)).isoformat()
    import bisect
    i = bisect.bisect_left(sessions, target)
    return sessions[i] if i < len(sessions) else None


def signals(bars: list[dict], market: list[dict]) -> dict[str, dict]:
    """Per-session abnormal return, relative volume and their tail probabilities."""
    mk = {b["date"]: b["adj"] for b in market}
    rows = [b for b in bars if b["date"] in mk]
    px = np.array([b["adj"] for b in rows])
    close = np.array([b["close"] for b in rows])
    m = np.array([mk[b["date"]] for b in rows])
    vol = np.array([b["volume"] for b in rows], dtype=float)
    r, rm = stats.log_returns(px), stats.log_returns(m)
    e, beta = stats.ew_abnormal_returns(r, rm)
    vr = stats.volume_ratio(vol)
    sigma = stats.garch_vol(e)
    z = np.abs(e) / sigma
    p_ret, p_vol = stats.tail_prob(z), stats.tail_prob(vr)
    chg = np.full(len(rows), np.nan)
    chg[1:] = px[1:] / px[:-1] - 1
    out = {}
    for i, b in enumerate(rows):
        f = lambda x: None if np.isnan(x) else float(x)  # noqa: E731
        out[b["date"]] = {"close": float(close[i]), "change": f(chg[i]), "market": f(np.expm1(rm[i])) if i else None,
                          "abnormal": f(np.expm1(e[i])) if not np.isnan(e[i]) else None,
                          "beta": f(beta[i]), "sigma": f(sigma[i]), "z": f(e[i] / sigma[i]),
                          "vol_ratio": f(vr[i]), "volume": int(vol[i]),
                          "p_ret": f(p_ret[i]), "p_vol": f(p_vol[i])}
    return out


def fit(panel: list[tuple[dict[str, dict], list[dict]]]) -> dict:
    """panel: per stock, (signals by session, filings). Returns the fitted model."""
    cats = [c for c in CATEGORIES]
    idx = {c: i for i, c in enumerate(cats)}
    X, y = [], []
    for sig, filings in panel:
        sessions = sorted(sig)
        day_cats: dict[str, set] = {}
        for f in filings:
            s = session_of(dt.datetime.fromisoformat(f["at"]), sessions)
            if s:
                day_cats.setdefault(s, set()).add(classify(f["subject"], f["text"])[0])
        for s in sessions:
            g = sig[s]
            if g["p_ret"] is None or g["p_vol"] is None:
                continue
            row = np.zeros(len(cats))
            for c in day_cats.get(s, ()):
                row[idx[c]] = 1
            X.append(row)
            y.append(1.0 if min(g["p_ret"], g["p_vol"]) <= ALPHA else 0.0)
    X, y = np.array(X), np.array(y)
    w, se = stats.ridge_logistic(X, y, lam=LAMBDA)
    quiet = X.sum(axis=1) == 0
    base = stats.sigmoid(w[0])
    model = {"alpha": ALPHA, "lambda": LAMBDA, "sessions": int(len(y)),
             "noticed_rate": float(y.mean()), "quiet_rate_observed": float(y[quiet].mean()),
             "baseline": base, "intercept": float(w[0]), "categories": {}}
    for c, i in idx.items():
        n = int(X[:, i].sum())
        b, s = float(w[i + 1]), float(se[i + 1])
        model["categories"][c] = {
            "n": n, "noticed": int(y[X[:, i] == 1].sum()), "coef": b, "se": s,
            "p": stats.sigmoid(w[0] + b), "lift": stats.sigmoid(w[0] + b) / base,
            # 90% interval on the lift, from the coefficient's standard error
            "lift_lo": stats.sigmoid(w[0] + b - 1.645 * s) / base,
            "lift_hi": stats.sigmoid(w[0] + b + 1.645 * s) / base,
        }
    return model


def adjust_volume(sigs: list[dict[str, dict]], market: dict[str, float] | None = None) -> None:
    """Take the market's own volume out of each stock's volume.

    On an index-rebalance or expiry day everything trades heavily; that is not news about
    any one company. v_mkt(t) is the NIFTY 500's turnover that session over its own
    20-session average (sectors.market_volume, from the exchange's daily index file), and

        v_rel = v_t / v_mkt(t)

    Where the exchange file is missing for a date, v_mkt falls back to the median relative
    volume across the stocks held.

    is the stock's volume against the day's norm. p_vol is recomputed on v_rel, so "the
    market noticed" and every "1 in N" for volume mean unusual *for that day*.
    """
    by_date: dict[str, list[float]] = {}
    for sig in sigs:
        for d, g in sig.items():
            if g["vol_ratio"] is not None:
                by_date.setdefault(d, []).append(g["vol_ratio"])
    med = {d: float(np.median(v)) for d, v in by_date.items() if len(v) >= 5}
    med.update({d: v for d, v in (market or {}).items() if v and v > 0})
    for sig in sigs:
        ds = sorted(sig)
        rel = np.array([sig[d]["vol_ratio"] / med[d] if sig[d]["vol_ratio"] is not None and med.get(d) else np.nan for d in ds])
        p = stats.tail_prob(rel)
        for d, r, pv in zip(ds, rel, p):
            sig[d].update(vol_mkt=med.get(d), vol_rel=None if np.isnan(r) else float(r), p_vol=None if np.isnan(pv) else float(pv))


def panel(years: int = 5) -> list[tuple[dict[str, dict], list[dict]]]:
    """Signals and filings for every portfolio stock over `years` of history."""
    from .sources import nse, prices
    cfg = json.loads((MODEL_PATH.parent / "portfolio.json").read_text())
    market = prices.history(prices.NIFTY, years=years)
    today = dt.datetime.now(prices.IST).date()
    out = []
    from . import sectors
    sigs = {p["symbol"]: signals(prices.history(p["symbol"], years=years), market) for p in cfg["portfolio"]}
    adjust_volume(list(sigs.values()), sectors.market_volume(sectors.panel([b["date"] for b in market])["turnover"]))
    for p in cfg["portfolio"]:
        sig = sigs[p["symbol"]]
        first = min((d for d, g in sig.items() if g["p_ret"] is not None), default=None)
        if not first:
            continue
        filings = nse.announcements(p["symbol"], dt.date.fromisoformat(first), today, ttl=7 * 86400)
        out.append((sig, filings))
    return out


def save(model: dict) -> None:
    MODEL_PATH.write_text(json.dumps(model, indent=1))


def load() -> dict:
    return json.loads(MODEL_PATH.read_text())


if __name__ == "__main__":
    # python -m finn.materiality     refit the event study and print it
    old = load() if MODEL_PATH.exists() else None
    model = fit(panel())
    save(model)
    print(f"{model['sessions']} stock-sessions; noticed {model['noticed_rate']:.3f}; baseline {model['baseline']:.3f}")
    for c, v in sorted(model["categories"].items(), key=lambda kv: -kv[1]["lift"]):
        was = f"   was {old['categories'][c]['lift']:.2f}x" if old and c in old["categories"] else ""
        print(f"  {c:20s} n={v['n']:5d}  {v['lift']:.2f}x  [{v['lift_lo']:.2f}, {v['lift_hi']:.2f}]{was}")
