"""The market's volume and each stock's sector factor.

Market volume.  The typical stock's volume against its own norm:
                    v_mkt(t) = median over NIFTY 500 constituents of  T_i,t / mean(T_i,t-20..t-1)
                T_i = rupee turnover of constituent i from the exchange's bhavcopy. A median,
                because one block deal in one name moves a sum and cannot move a median.
                Before the bhavcopy archive in this format begins (and as a fallback), the
                NIFTY 500's aggregate turnover over its own 20-session mean is used.

Sector factor.  Who are the stock's peers? In order (peer_sets):
                  1. sets named in portfolio.json, for the cases a classification cannot
                     express (a conglomerate is several businesses: one set per business);
                  2. its basic-industry peers, found programmatically from the exchange's
                     industry classification (CG Power -> BHEL, ABB, Siemens, Hitachi Energy);
                  3. the narrowest NSE sector index that lists it, largest ten by turnover.
                The stock itself is never in its own factor. Each peer's return is taken
                net of the market (same conditional beta as everywhere), standardised on
                the N_FIT sessions before the window, and the factor is the first principal
                component of their correlation matrix on those sessions:
                    f_t = v . z_t ,   v = leading eigenvector, sum(v) > 0
                It is a factor only if its eigenvalue clears the Marchenko-Pastur edge
                (1 + sqrt(n/T))^2, the largest eigenvalue pure noise would produce.
                The stock's residual is then regressed on f over the same sessions,
                    e_t = g f_t + u_t ,
                and the sector is accepted at t(g) >= 2.58 (1%, one pre-specified factor).
                With several sets (sector_model) the regression is joint, each loading is
                partial, and the bar rises to the 1% level shared across the sets tested. Weights, scaling and loading are
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
# A stock that is a tenth of the NIFTY moves the NIFTY. Net of that index its residual is
# mechanically pushed AGAINST its own peers (HDFC Bank on its businesses: t = -3.0 against
# the NIFTY 50, +5.0 against this index, same sessions). For index heavyweights the sector
# stage therefore measures everything against a market in which each name is 1%.
EQUAL_WEIGHT = "Nifty100 Equal Weight"
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


def peer_sets(symbol: str, given, lists: dict[str, list[str]], size: dict[str, float]) -> list[list[dict]]:
    """Candidate peer sets, in the order they are tried. Each entry is a list of sets
    that are tested TOGETHER (one set: a single factor; several: a multi-factor model).

      1. sets named in portfolio.json: a list (one basket) or {business: [symbols]} for a
         company that is several businesses at once;
      2. the company's basic-industry peers (screener's peer list, which follows the
         exchange's industry classification): found programmatically, no hand input;
      3. the narrowest NSE sector index that lists the stock.
    """
    out: list[list[dict]] = []
    if isinstance(given, dict):
        out.append([{"name": k, "basis": "basket", "peers": [p for p in v if p != symbol][:TOP]} for k, v in given.items()])
    elif given:
        out.append([{"name": "its named peers", "basis": "basket", "peers": [p for p in given if p != symbol][:TOP]}])
    try:
        from .sources import screener
        industry, found = screener.peers(symbol)
    except Exception:
        industry, found = None, []
    if len(found) >= MIN_PEERS:
        out.append([{"name": f"its {industry} peers" if industry else "its industry peers", "basis": "industry", "peers": found[:TOP]}])
    mine = [(n in BROAD, len(v), n) for n, v in lists.items() if symbol in v]
    if mine:
        name = min(mine)[2]   # sector-specific lists before broad ones, then the smallest
        ranked = sorted((p for p in lists[name] if p != symbol), key=lambda p: -size.get(p, 0.0))
        out.append([{"name": f"its {name} peers", "basis": "member", "peers": ranked[:TOP]}])
    return out


def nifty500() -> list[str]:
    import csv
    import io
    text = http.get_text(f"{nse.ARCHIVE}/content/indices/ind_nifty500list.csv", ttl=7 * 86400)
    return [r["Symbol"].strip() for r in csv.DictReader(io.StringIO(text)) if r.get("Symbol")]


def panel(dates: list[str]) -> dict:
    """Aggregate NIFTY 500 turnover by date (index file), per-constituent turnover for the
    latest BHAV_SESSIONS (bhavcopy), and each constituent's latest turnover as a size proxy."""
    turnover: dict[str, float] = {}
    equal: list[dict] = []
    for d in dates:
        rows = nse.index_closes(dt.date.fromisoformat(d))
        if rows and rows.get(MARKET, {}).get("t"):
            turnover[d] = rows[MARKET]["t"]
        if rows and EQUAL_WEIGHT in rows:
            equal.append({"date": d, "adj": rows[EQUAL_WEIGHT]["c"], "close": rows[EQUAL_WEIGHT]["c"]})
    members = set(nifty500())
    by_stock: dict[str, dict[str, float]] = {}
    size: dict[str, float] = {}
    for d in dates[-BHAV_SESSIONS:]:
        bc = nse.bhavcopy(dt.date.fromisoformat(d))
        if not bc:
            continue
        by_stock[d] = {s: r["value"] for s, r in bc.items() if s in members and r["value"] > 0}
        size = {s: r["value"] for s, r in bc.items()}
    return {"turnover": turnover, "by_stock": by_stock, "size": size, "equal": equal}


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


def _pc1(peer_set: dict, fit_days: list[str], market: list[dict], cache: dict) -> dict | None:
    """First principal component of one peer set on the fit sessions, if it is a real factor."""
    res = {}
    for p in peer_set["peers"]:
        if p not in cache:
            try:
                cache[p] = _residuals(p, market)
            except Exception:
                cache[p] = {}
        if cache[p]:
            res[p] = cache[p]
    names = [p for p in res if sum(d in res[p] for d in fit_days) >= 0.9 * len(fit_days)]
    days = [d for d in fit_days if all(d in res[p] for p in names)]
    if len(names) < MIN_PEERS or len(days) < 0.8 * N_FIT:
        return None
    X = np.array([[res[p][d] for p in names] for d in days])
    mu, sd = X.mean(0), X.std(0)
    w, V = np.linalg.eigh(np.corrcoef(((X - mu) / sd).T))
    lam, v = float(w[-1]), V[:, -1]
    edge = (1 + math.sqrt(len(names) / len(days))) ** 2
    if lam <= edge:
        return None   # the peers share no factor beyond what noise would show
    v = v if v.sum() > 0 else -v
    score = lambda d: float(((np.array([res[p][d] for p in names]) - mu) / sd) @ v)  # noqa: E731
    return {**peer_set, "peers": names, "lam": lam, "edge": edge, "share": lam / len(names), "days": set(days), "score": score,
            "has": lambda d: all(d in res[p] for p in names)}


def t_min(k: int) -> float:
    """Two-sided 1% critical value shared across k factors tested together (Bonferroni)."""
    from statistics import NormalDist
    return NormalDist().inv_cdf(1 - 0.005 / max(1, k))


def sector_model(e: dict[str, float], sets: list[dict], market: list[dict], before: str, cache: dict) -> dict | None:
    """The stock's residual on the principal components of its peer sets, jointly.

        e_t = sum_k g_k f_k,t + u_t          f_k = PC1 of peer set k (stock excluded)

    Ordinary least squares on the N_FIT sessions before `before`; each g_k is a partial
    loading (what set k explains that the others do not). A factor is kept when its
    partial t clears t_min(k); the model is refitted on the survivors. One set is the
    single-factor case. Returns None when nothing survives.
    """
    fit = [d for d in sorted(e) if d < before][-N_FIT:]
    pcs = [p for p in (_pc1(s, fit, market, cache) for s in sets) if p]
    while pcs:
        days = [d for d in fit if all(d in p["days"] for p in pcs)]
        if len(days) < 0.8 * N_FIT:
            return None
        F = np.array([[p["score"](d) for p in pcs] for d in days])
        y = np.array([e[d] for d in days])
        G = np.linalg.inv(F.T @ F)
        g = G @ F.T @ y
        u = y - F @ g
        se = np.sqrt(np.diag(G) * float(u @ u) / (len(days) - len(pcs)))
        t = g / se
        keep = [i for i in range(len(pcs)) if g[i] > 0 and t[i] >= t_min(len(sets))]
        if len(keep) == len(pcs):
            later = [d for d in sorted(e) if d >= before and all(p["has"](d) for p in pcs)]
            return {"n": len(days), "r2": 1 - float(u @ u) / float(y @ y), "tested": len(sets),
                    "factors": [{"name": p["name"], "basis": p["basis"], "peers": p["peers"], "g": float(g[i]), "t": float(t[i]), "share": p["share"],
                                 "lam": p["lam"], "edge": p["edge"], "f": {d: p["score"](d) for d in later}} for i, p in enumerate(pcs)]}
        pcs = [pcs[i] for i in keep]
    return None


def sotp_model(e: dict[str, float], parts: list[dict], market: list[dict], before: str, cache: dict) -> dict | None:
    """Sum of the parts: one factor for a company that is several businesses.

    parts: [{name, share, peers}], share = the business's share of reported segment
    revenue (results.segments, from the company's XBRL). Each business gets the first
    principal component of its own peers, f_k (unit variance on the fit sessions), and
    the company's factor is their revenue-weighted sum
        f = sum_k share_k f_k / sum_k share_k .
    The weights come from the accounts, not from a fit, so this is ONE pre-specified
    factor and one test (t >= 2.58): it spends one degree of freedom where a free
    multi-factor regression spends one per business, which is what a conglomerate whose
    individual loadings are each too weak to pass needs. Exposure of business k is then
    g x share_k, reported per business.
    """
    fit = [d for d in sorted(e) if d < before][-N_FIT:]
    pcs = []
    for part in parts:
        pc = _pc1({"name": part["name"], "basis": "sotp", "peers": [p for p in part["peers"]][:TOP]}, fit, market, cache)
        if pc:
            sd = float(np.std([pc["score"](d) for d in pc["days"]])) or 1.0
            pcs.append((part, pc, sd))
    if not pcs:
        return None
    total = sum(p["share"] for p, _, _ in pcs)
    days = [d for d in fit if all(d in pc["days"] for _, pc, _ in pcs)]
    if len(days) < 0.8 * N_FIT or total <= 0:
        return None
    comp = lambda d: sum(p["share"] * pc["score"](d) / sd for p, pc, sd in pcs) / total  # noqa: E731
    x, y = np.array([comp(d) for d in days]), np.array([e[d] for d in days])
    g = float(x @ y) / float(x @ x)
    u = y - g * x
    t = g / math.sqrt(float(u @ u) / (len(days) - 1) / float(x @ x))
    if g <= 0 or t < T_MIN:
        return None
    later = [d for d in sorted(e) if d >= before and all(pc["has"](d) for _, pc, _ in pcs)]
    mix = ", ".join(f"{p['share'] / total:.0%} {p['name']}" for p, _, _ in pcs)
    return {"n": len(days), "r2": 1 - float(u @ u) / float(y @ y), "tested": 1, "covered": total,
            "factors": [{"name": f"its businesses by revenue ({mix})", "basis": "sotp", "peers": [q for _, pc, _ in pcs for q in pc["peers"][:2]], "g": g, "t": t,
                         "share": float(np.mean([pc["share"] for _, pc, _ in pcs])), "lam": 0.0, "edge": 0.0, "f": {d: comp(d) for d in later},
                         "parts": [{"name": p["name"], "share": p["share"] / total, "f": {d: pc["score"](d) / sd for d in later}} for p, pc, sd in pcs]}]}
