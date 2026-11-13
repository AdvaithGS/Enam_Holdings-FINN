"""The market's volume and each stock's sector factor.

Market volume.  The typical stock's volume against its own norm:
                    v_mkt(t) = median over NIFTY 500 constituents of  T_i,t / mean(T_i,t-20..t-1)
                T_i = rupee turnover of constituent i from the exchange's bhavcopy. A median,
                because one block deal in one name moves a sum and cannot move a median.
                Before the bhavcopy archive in this format begins (and as a fallback), the
                NIFTY 500's aggregate turnover over its own 20-session mean is used.

Sector factor.  Who are the stock's peers?
                  1. a named basket of direct competitors, where the investor has set one
                     (portfolio.json "peers": CG Power against Siemens, ABB, BHEL...), else
                  2. the constituents of the narrowest NSE sector index that lists the
                     stock (the exchange's own list files), largest ten by turnover.
                The stock itself is never in its own factor. Each peer's return is taken
                net of the market (same conditional beta as everywhere), standardised on
                the N_FIT sessions before the window, and the factor is the first principal
                component of their correlation matrix on those sessions:
                    f_t = v . z_t ,   v = leading eigenvector, sum(v) > 0
                It is a factor only if its eigenvalue clears the Marchenko-Pastur edge
                (1 + sqrt(n/T))^2, the largest eigenvalue pure noise would produce.
                The stock's residual is then regressed on f over the same sessions,
                    e_t = g f_t + u_t ,
                and the sector is accepted at |t(g)| >= T_MIN = 2.58 (1%, one pre-specified
                factor, so no multiple-testing correction). Weights, scaling and loading are
                all fixed before the window; inside it, g f_d is out of sample.

Why not regress on the cap-weighted sector index: a large stock IS a large part of its
index (HDFC Bank in Nifty Bank), so the loading would partly be the stock on itself.
"""
from __future__ import annotations

import datetime as dt
import math
import warnings

import numpy as np

from . import http, stats
from .sources import nse, prices

MARKET = "Nifty 500"
N_FIT, T_MIN, TOP, MIN_PEERS = 250, 2.58, 10, 4
BHAV_SESSIONS = 600   # sessions of per-stock turnover to hold: 500 for rarity, 20 for the mean, a margin
BROAD = {"Nifty Infrastructure", "Nifty India Manufacturing", "Nifty India Consumption", "Nifty Energy"}
# The exchange's own constituent files: which sector indices a stock actually belongs to.
LISTS = {
    "Nifty Auto": "niftyautolist", "Nifty Bank": "niftybanklist", "Nifty Private Bank": "nifty_privatebanklist", "Nifty PSU Bank": "niftypsubanklist",
    "Nifty Financial Services": "niftyfinancelist", "Nifty Financial Services Ex-Bank": "niftyfinancialservicesexbank_list", "Nifty FMCG": "niftyfmcglist",
    "Nifty IT": "niftyitlist", "Nifty Media": "niftymedialist", "Nifty Metal": "niftymetallist", "Nifty Pharma": "niftypharmalist",
    "Nifty Healthcare Index": "niftyhealthcarelist", "Nifty Realty": "niftyrealtylist", "Nifty Energy": "niftyenergylist", "Nifty Oil & Gas": "niftyoilgaslist",
    "Nifty Infrastructure": "niftyinfralist", "Nifty Capital Goods": "niftyCapitalGoods_list", "Nifty Chemicals": "niftyChemicals_list",
    "Nifty Consumer Durables": "niftyconsumerdurableslist", "Nifty India Manufacturing": "niftyindiamanufacturing_list",
    "Nifty India Defence": "niftyindiadefence_list", "Nifty India Consumption": "niftyconsumptionlist",
}


def _lists() -> dict[str, list[str]]:
    import csv
    import io
    out = {}
    for name, f in LISTS.items():
        try:
            text = http.get_text(f"{nse.ARCHIVE}/content/indices/ind_{f}.csv", ttl=7 * 86400, retries=1)
        except http.FetchError:
            continue
        out[name] = [r["Symbol"].strip() for r in csv.DictReader(io.StringIO(text)) if r.get("Symbol")]
    return out


def peers_of(symbol: str, basket: list[str] | None, lists: dict[str, list[str]], size: dict[str, float]) -> dict | None:
    """The stock's peer set: a named basket if given, else its narrowest sector list."""
    if basket:
        return {"name": "its direct competitors", "basis": "basket", "peers": [p for p in basket if p != symbol][:TOP]}
    mine = [(n in BROAD, len(v), n) for n, v in lists.items() if symbol in v]
    if not mine:
        return None
    name = min(mine)[2]   # sector-specific lists before broad ones, then the smallest
    ranked = sorted((p for p in lists[name] if p != symbol), key=lambda p: -size.get(p, 0.0))
    return {"name": name, "basis": "member", "peers": ranked[:TOP]}


def nifty500() -> list[str]:
    import csv
    import io
    text = http.get_text(f"{nse.ARCHIVE}/content/indices/ind_nifty500list.csv", ttl=7 * 86400)
    return [r["Symbol"].strip() for r in csv.DictReader(io.StringIO(text)) if r.get("Symbol")]


def panel(dates: list[str]) -> dict:
    """Aggregate NIFTY 500 turnover by date (index file), per-constituent turnover for the
    latest BHAV_SESSIONS (bhavcopy), and each constituent's latest turnover as a size proxy."""
    turnover: dict[str, float] = {}
    for d in dates:
        rows = nse.index_closes(dt.date.fromisoformat(d))
        if rows and rows.get(MARKET, {}).get("t"):
            turnover[d] = rows[MARKET]["t"]
    members = set(nifty500())
    by_stock: dict[str, dict[str, float]] = {}
    size: dict[str, float] = {}
    for d in dates[-BHAV_SESSIONS:]:
        bc = nse.bhavcopy(dt.date.fromisoformat(d))
        if not bc:
            continue
        by_stock[d] = {s: r["value"] for s, r in bc.items() if s in members and r["value"] > 0}
        size = {s: r["value"] for s, r in bc.items()}
    return {"turnover": turnover, "by_stock": by_stock, "size": size}


def market_volume(p: dict, window: int = stats.VOL_WINDOW) -> dict[str, float]:
    """v_mkt by date: the constituent median where the bhavcopy is held, else the aggregate ratio."""
    out = _aggregate_ratio(p["turnover"], window)
    ds = sorted(p["by_stock"])
    if len(ds) > window:
        syms = sorted({s for d in ds for s in p["by_stock"][d]})
        M = np.array([[p["by_stock"][d].get(s, np.nan) for s in syms] for d in ds])
        for i in range(window, len(ds)):
            with np.errstate(all="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)   # a stock with no history in the window
                base = np.nanmean(M[i - window:i], axis=0)
                ratio = M[i] / base
            ratio = ratio[np.isfinite(ratio)]
            if len(ratio) >= 100:
                out[ds[i]] = float(np.median(ratio))
    return out


def _aggregate_ratio(turnover: dict[str, float], window: int) -> dict[str, float]:
    ds = sorted(turnover)
    out = {}
    for i in range(window, len(ds)):
        base = sum(turnover[x] for x in ds[i - window:i]) / window
        if base > 0:
            out[ds[i]] = turnover[ds[i]] / base
    return out


def _residuals(symbol: str, market: list[dict]) -> dict[str, float]:
    mk = {b["date"]: b["adj"] for b in market}
    bars = [b for b in prices.history(symbol, years=2) if b["date"] in mk]
    if len(bars) < N_FIT:
        return {}
    e, _ = stats.ew_abnormal_returns(stats.log_returns(np.array([b["adj"] for b in bars])), stats.log_returns(np.array([mk[b["date"]] for b in bars])))
    return {b["date"]: float(x) for b, x in zip(bars, e) if not np.isnan(x)}


def sector_factor(e: dict[str, float], peer_set: dict, market: list[dict], before: str, cache: dict) -> dict | None:
    """First principal component of the peers' residuals, and the stock's tested loading on it."""
    res = {}
    for p in peer_set["peers"]:
        if p not in cache:
            try:
                cache[p] = _residuals(p, market)
            except Exception:
                cache[p] = {}
        if cache[p]:
            res[p] = cache[p]
    fit = [d for d in sorted(e) if d < before][-N_FIT:]
    names = [p for p in res if sum(d in res[p] for d in fit) >= 0.9 * len(fit)]
    fit = [d for d in fit if all(d in res[p] for p in names)]
    if len(names) < MIN_PEERS or len(fit) < 0.8 * N_FIT:
        return None
    X = np.array([[res[p][d] for p in names] for d in fit])
    mu, sd = X.mean(0), X.std(0)
    w, V = np.linalg.eigh(np.corrcoef(((X - mu) / sd).T))
    lam, v = float(w[-1]), V[:, -1]
    edge = (1 + math.sqrt(len(names) / len(fit))) ** 2
    if lam <= edge:
        return None   # the peers share no factor beyond what noise would show
    v = v if v.sum() > 0 else -v
    f_fit = ((X - mu) / sd) @ v
    y = np.array([e[d] for d in fit])
    g = float(f_fit @ y) / float(f_fit @ f_fit)
    u = y - g * f_fit
    se = math.sqrt(float(u @ u) / (len(fit) - 1) / float(f_fit @ f_fit))
    t = g / se if se > 0 else 0.0
    if g <= 0 or t < T_MIN:
        return None
    later = [d for d in sorted(e) if d >= before and all(d in res[p] for p in names)]
    f = {d: float(((np.array([res[p][d] for p in names]) - mu) / sd) @ v) for d in later}
    return {**peer_set, "peers": names, "g": g, "t": t, "n": len(fit), "share": lam / len(names), "edge": edge, "lam": lam, "f": f}
