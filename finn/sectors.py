"""The market's volume and the sector factors, from the exchange's own daily index file.

One small file per session (nse.index_closes) carries, for every NSE index, its close
and the turnover of its constituents. Two things are built from it.

Market volume.   v_mkt(t) = T_t / mean(T_{t-20..t-1}),  T = NIFTY 500 turnover in rupees.
                 Turnover, not share count: shares of different stocks do not add.

Sector factors.  For each sector index s, its return net of the market,
                     f_s,t = r_s,t - (a + b m_t)        (same conditional beta as stocks)
                 A stock's own residual e is then regressed on each candidate factor over
                 the N sessions BEFORE the window being explained:
                     e_t = g f_s,t + u_t
                 The candidates are the sector indices whose official constituent list
                 (membership()) contains the stock; among them the best fit (highest R^2)
                 is its sector, provided |t(g)| >= T_MIN. With ~30 candidates tested, T_MIN = 3.5 keeps
                 the chance of a spurious sector under 2% (Bonferroni on a two-sided
                 normal tail: 30 x 0.00047). N = 250, so this is not a small-sample
                 correlation, and the loading is estimated out of sample.
                 On day d the sector accounts for g f_s,d of the stock's residual.

The factor is the exchange's cap-weighted sector index, not a principal component
computed from constituents. That is a choice: the first principal component of a
sector's constituent residuals is, in practice, close to its cap-weighted index
residual, and the index is published daily by the exchange, whereas a PCA needs every
constituent's history and re-estimation as membership changes.
"""
from __future__ import annotations

import datetime as dt

import numpy as np

from . import stats
from .sources import nse

MARKET = "Nifty 500"
CANDIDATES = [
    "Nifty Auto", "Nifty Bank", "Nifty Private Bank", "Nifty PSU Bank", "Nifty Financial Services", "Nifty Financial Services Ex-Bank", "Nifty NBFC",
    "Nifty Small Finance Banks & Microfinance Institutions", "Nifty Capital Markets", "Nifty Insurance", "Nifty FMCG", "Nifty IT", "Nifty Media",
    "Nifty Metal", "Nifty Pharma", "Nifty Healthcare Index", "Nifty Realty", "Nifty Energy", "Nifty Oil & Gas", "Nifty Power", "Nifty Infrastructure",
    "Nifty Capital Goods", "Nifty Chemicals", "Nifty Consumer Durables", "Nifty Retail", "Nifty Telecommunications", "Nifty India Internet",
    "Nifty India Manufacturing", "Nifty India Defence", "Nifty Cement", "Nifty Construction", "Nifty India Consumption",
]
N_FIT, T_MIN = 250, 3.5
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


def membership() -> dict[str, list[str]]:
    """symbol -> the sector indices whose official constituent list contains it."""
    import csv
    import io
    from . import http
    out: dict[str, list[str]] = {}
    for name, f in LISTS.items():
        try:
            text = http.get_text(f"{nse.ARCHIVE}/content/indices/ind_{f}.csv", ttl=7 * 86400, retries=1)
        except http.FetchError:
            continue
        for r in csv.DictReader(io.StringIO(text)):
            if r.get("Symbol"):
                out.setdefault(r["Symbol"].strip(), []).append(name)
    return out


def panel(dates: list[str]) -> dict:
    """Turnover of the NIFTY 500 and closes of the candidate indices, by date."""
    turnover: dict[str, float] = {}
    close: dict[str, dict[str, float]] = {c: {} for c in CANDIDATES}
    for d in dates:
        rows = nse.index_closes(dt.date.fromisoformat(d))
        if not rows:
            continue
        if rows.get(MARKET, {}).get("t"):
            turnover[d] = rows[MARKET]["t"]
        for c in CANDIDATES:
            if c in rows:
                close[c][d] = rows[c]["c"]
    return {"turnover": turnover, "close": {c: v for c, v in close.items() if len(v) >= 0.8 * N_FIT}}


def market_volume(turnover: dict[str, float], window: int = stats.VOL_WINDOW) -> dict[str, float]:
    ds = sorted(turnover)
    out = {}
    for i in range(window, len(ds)):
        base = sum(turnover[x] for x in ds[i - window:i]) / window
        if base > 0:
            out[ds[i]] = turnover[ds[i]] / base
    return out


def factors(close: dict[str, dict[str, float]], market: list[dict]) -> dict[str, dict[str, float]]:
    """Each sector's return net of the market, by date."""
    mk = {b["date"]: b["adj"] for b in market}
    out = {}
    for name, series in close.items():
        ds = [d for d in sorted(series) if d in mk]
        if len(ds) < 0.8 * N_FIT:
            continue
        r = stats.log_returns(np.array([series[d] for d in ds]))
        m = stats.log_returns(np.array([mk[d] for d in ds]))
        f, _ = stats.ew_abnormal_returns(r, m)
        out[name] = {d: float(x) for d, x in zip(ds, f) if not np.isnan(x)}
    return out


def loading(e: dict[str, float], f: dict[str, float], before: str, n: int = N_FIT) -> dict | None:
    """OLS through the origin of a stock's residual on one sector factor, on the n sessions before `before`."""
    ds = [d for d in sorted(e) if d < before and d in f][-n:]
    if len(ds) < n * 0.8:
        return None
    x, y = np.array([f[d] for d in ds]), np.array([e[d] for d in ds])
    sxx = float(x @ x)
    if sxx <= 0:
        return None
    g = float(x @ y) / sxx
    resid = y - g * x
    se = float(np.sqrt(resid @ resid / (len(ds) - 1) / sxx))
    return {"g": g, "t": g / se if se > 0 else 0.0, "r2": 1 - float(resid @ resid) / float(y @ y), "n": len(ds)}


def sector_of(e: dict[str, float], facs: dict[str, dict[str, float]], before: str, member_of: list[str] | None = None) -> dict | None:
    """The stock's sector factor, if one passes the test.

    Candidates are the sector indices the exchange lists the stock in. Among them the one
    with the highest R^2 is taken (a bank is in Bank, Private Bank and Financial Services;
    the tightest fit is its sector). A stock in no listed sector index falls back to all
    candidates, and the result is marked "statistical", not membership.
    """
    listed = [n for n in (member_of or []) if n in facs]
    best = None
    for name in (listed or list(facs)):
        fit = loading(e, facs[name], before)
        if fit and fit["g"] > 0 and fit["t"] >= T_MIN and (best is None or fit["r2"] > best["r2"]):
            best = {"name": name, "basis": "member" if listed else "statistical", **fit}
    return best
