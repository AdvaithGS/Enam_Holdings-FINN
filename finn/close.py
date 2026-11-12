"""The close: what the session amounted to, once it is over.

One block of the digest, all of it arithmetic on end-of-day data:

    portfolio   equal-weight return r_p, the index m, and
                alpha = mean_i e_i   (e_i = market-model residual of stock i, stats.py)
                i.e. what the holdings did beyond their market exposure, with its own
                empirical rarity over the trailing RARITY_WINDOW sessions
    movers      the stocks whose session was a tail day, and what was filed
    regime      GARCH(1,1) conditional volatility of the NIFTY, annualised, and where it
                sits in its own trailing distribution
    sectors     each NSE sector index against the NIFTY today and over the 20 sessions
                before; rotation = Spearman rank correlation between the two across
                sectors (negative: today's leaders were the month's laggards)
    world       the last COMPLETED session of each major index, with daily candles

Portfolio weights are not held, so "portfolio" means equal weight; that is stated on
screen. A foreign index whose session is still open when the job runs is shown as of
its previous close, never as a half-finished bar.

`links` on a world index say why it bears on this portfolio. They are stated judgment
(ordinary public industry structure), not measured, and are what lets the phone attach
a contact from the investor's own network to a foreign move.
"""
from __future__ import annotations

import datetime as dt
import urllib.parse

import numpy as np

from . import http, stats
from .sources import nse, prices

# id, label, Yahoo symbol (history), name in the exchange's index file (latest sessions), holdings
SECTORS = [
    ("bank", "Bank", "^NSEBANK", "Nifty Bank", ["HDFCBANK"]), ("it", "IT", "^CNXIT", "Nifty IT", ["TCS"]),
    ("auto", "Auto", "^CNXAUTO", "Nifty Auto", ["MARUTI"]), ("pharma", "Pharma", "^CNXPHARMA", "Nifty Pharma", ["SUNPHARMA"]),
    ("fmcg", "FMCG", "^CNXFMCG", "Nifty FMCG", ["ITC"]), ("energy", "Energy", "^CNXENERGY", "Nifty Energy", ["RELIANCE"]),
    ("infra", "Infra", "^CNXINFRA", "Nifty Infrastructure", ["LT", "BHARTIARTL"]), ("metal", "Metal", "^CNXMETAL", "Nifty Metal", []),
    ("realty", "Realty", "^CNXREALTY", "Nifty Realty", []),
]
WORLD = [
    ("nikkei", "Nikkei 225", "^N225", "Asia", [{"symbol": "MARUTI", "why": "Suzuki, Maruti's parent, is listed in Tokyo"}]),
    ("hangseng", "Hang Seng", "^HSI", "Asia", [{"theme": "specialty-chemicals", "why": "Chinese chemical supply sets the export prices Indian producers meet"}]),
    ("shanghai", "Shanghai", "000001.SS", "Asia", [{"theme": "specialty-chemicals", "why": "Chinese chemical supply sets the export prices Indian producers meet"}]),
    ("kospi", "KOSPI", "^KS11", "Asia", [{"theme": "semiconductors", "why": "memory makers dominate the Korean index"},
                                         {"theme": "electronics-manufacturing", "why": "Samsung is a principal customer of Indian contract manufacturers"}]),
    ("dax", "DAX", "^GDAXI", "Europe", []), ("stoxx", "Euro Stoxx 50", "^STOXX50E", "Europe", []),
    ("ftse", "FTSE 100", "^FTSE", "Europe", []),
    ("sp500", "S&P 500", "^GSPC", "US", [{"theme": "it-services", "why": "US clients are most of Indian IT revenue"},
                                         {"theme": "pharma", "why": "the US is the largest market for Indian generics"}]),
    ("nasdaq", "Nasdaq", "^IXIC", "US", [{"theme": "semiconductors", "why": "chip designers and equipment makers set the cycle"}]),
]
CANDLES = 30


def ohlc(ysym: str, now: dt.datetime, ttl: float = 3600) -> list[dict]:
    """Completed daily bars, oldest first: date (exchange-local), o, h, l, c."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ysym)}?range=3y&interval=1d"
    res = http.get_json(url, ttl=ttl)["chart"]["result"][0]
    q, meta = res["indicators"]["quote"][0], res["meta"]
    tz = dt.timezone(dt.timedelta(seconds=meta.get("gmtoffset", 0)))
    rows: dict[str, dict] = {}
    stamps = res.get("timestamp") or []
    for i, ts in enumerate(stamps):
        o, h, low, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if c is None and i == len(stamps) - 1 and meta.get("regularMarketPrice"):
            # the daily bar of a session that has just ended is published without its close
            # for some hours; the quote block already carries the last print and the range
            c, h, low = meta["regularMarketPrice"], meta.get("regularMarketDayHigh"), meta.get("regularMarketDayLow")
        if c is None or c <= 0:
            continue
        o = o if o and o > 0 else c
        h = max(h or c, o, c)
        low = min(low, o, c) if low and low > 0 else min(o, c)
        rows[dt.datetime.fromtimestamp(ts, tz).date().isoformat()] = {"o": float(o), "h": float(h), "l": float(low), "c": float(c)}
    out = [{"date": d, **rows[d]} for d in sorted(rows)]
    # a session still trading is not a bar yet
    period = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    if out and period.get("start") and period.get("end") and period["start"] <= now.timestamp() < period["end"]:
        if out[-1]["date"] == dt.datetime.fromtimestamp(period["start"], tz).date().isoformat():
            out.pop()
    return out


def _official(bars: list[dict], name: str, session: str, sessions: int = 3) -> list[dict]:
    """Overwrite or append the latest sessions of an NSE index from the exchange's file."""
    by_date = {b["date"]: b for b in bars}
    day, found = dt.date.fromisoformat(session), 0
    for _ in range(sessions + 8):
        if found >= sessions:
            break
        rows = nse.index_closes(day) if day.weekday() < 5 else None
        if rows and name in rows:
            found += 1
            by_date[day.isoformat()] = {"date": day.isoformat(), **rows[name]}
        day -= dt.timedelta(days=1)
    return [by_date[d] for d in sorted(by_date)]


def _rarity(closes: np.ndarray) -> float | None:
    r = np.abs(stats.log_returns(closes))
    p = stats.tail_prob(r)
    return None if np.isnan(p[-1]) else float(p[-1])


def _spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 5:
        return None
    ra, rb = np.argsort(np.argsort(a)).astype(float), np.argsort(np.argsort(b)).astype(float)
    ra, rb = ra - ra.mean(), rb - rb.mean()
    den = float(np.sqrt((ra ** 2).sum() * (rb ** 2).sum()))
    return float((ra * rb).sum() / den) if den > 0 else None


def build(companies: dict, market: list[dict], events: list[dict], now: dt.datetime, log=print) -> dict | None:
    """`companies[s]["_sig"]` holds per-session signals; `market` the NIFTY bars."""
    # ---- the session: the latest one on which the market model could be evaluated
    by_date: dict[str, list[tuple[str, dict]]] = {}
    for s, c in companies.items():
        for d, g in c["_sig"].items():
            if g.get("abnormal") is not None:
                by_date.setdefault(d, []).append((s, g))
    full = [d for d in sorted(by_date) if len(by_date[d]) >= max(3, len(companies) // 2)]
    if not full:
        return None
    session = full[-1]
    today = by_date[session]
    alpha_series = np.array([float(np.mean([g["abnormal"] for _, g in by_date[d]])) for d in full])
    p_alpha = stats.tail_prob(np.abs(alpha_series))[-1]
    changes = [g["change"] for _, g in today if g["change"] is not None]
    order = {"act": 0, "glance": 1, "aside": 2}
    movers = []
    for s, g in today:
        ps = [x for x in (g.get("p_ret"), g.get("p_vol")) if x is not None]
        if not ps or min(ps) > 0.10:
            continue
        evs = sorted((e for e in events if e["symbol"] == s and e["session"] == session), key=lambda e: order[e["tier"]])
        movers.append({"symbol": s, "change": g["change"], "abnormal": g["abnormal"], "vol_ratio": g["vol_ratio"],
                       "p": round(min(ps), 4), "event": evs[0]["id"] if evs else None,
                       "event_title": evs[0]["title"] if evs else None})
    movers.sort(key=lambda m: m["p"])
    r4 = lambda x: None if x is None or np.isnan(x) else round(float(x), 4)  # noqa: E731
    portfolio = {"n": len(today), "ret": r4(np.mean(changes)) if changes else None, "market": r4(today[0][1]["market"]),
                 "alpha": r4(alpha_series[-1]), "alpha_p": r4(p_alpha), "up": sum(1 for x in changes if x > 0),
                 "down": sum(1 for x in changes if x < 0), "unusual": len([m for m in movers if m["p"] <= 0.05])}

    # ---- volatility regime of the index
    md = [b["date"] for b in market if b["date"] <= session]
    mr = stats.log_returns(np.array([b["adj"] for b in market if b["date"] <= session]))
    sig = stats.garch_vol(mr - np.nanmean(mr))
    regime = None
    hist = sig[-stats.RARITY_WINDOW:]
    hist = hist[~np.isnan(hist)]
    if len(hist) >= 120 and md and md[-1] == session:
        pct = float((hist <= hist[-1]).mean())
        label = "calm" if pct < 0.5 else "normal" if pct < 0.8 else "elevated" if pct < 0.95 else "stressed"
        regime = {"vol": round(float(hist[-1]) * 252 ** 0.5, 4), "pct": round(pct, 3), "label": label, "sessions": int(len(hist))}
    nifty = {b["date"]: b["adj"] for b in market}

    # ---- sectors against the index
    sectors = []
    for sid, name, ysym, official, held in SECTORS:
        try:
            bars = [b for b in _official(ohlc(ysym, now), official, session) if b["date"] in nifty and b["date"] <= session]
        except Exception as ex:
            log(f"  ! sector {name}: {ex!r}")
            continue
        if len(bars) < 30 or bars[-1]["date"] != session:
            continue
        c = np.array([b["c"] for b in bars])
        m = np.array([nifty[b["date"]] for b in bars])
        rel = stats.log_returns(c) - stats.log_returns(m)
        p = stats.tail_prob(np.abs(rel))[-1]
        sectors.append({"id": sid, "name": name, "ret": r4(c[-1] / c[-2] - 1), "rel": r4(np.expm1(rel[-1])),
                        "rel_20": r4(np.expm1(np.nansum(rel[-21:-1]))), "p": r4(p), "held": [s for s in held if s in companies]})
    sectors.sort(key=lambda s: -(s["rel"] or 0))
    rho = _spearman([s["rel"] for s in sectors], [s["rel_20"] for s in sectors]) if all(s["rel_20"] is not None for s in sectors) else None

    # ---- the world, as of each market's last completed session
    world = []
    for wid, name, ysym, region, links in WORLD:
        try:
            bars = ohlc(ysym, now)
        except Exception as ex:
            log(f"  ! index {name}: {ex!r}")
            continue
        if len(bars) < 30:
            continue
        c = np.array([b["c"] for b in bars])
        last = bars[-CANDLES:]
        world.append({"id": wid, "name": name, "region": region, "session": bars[-1]["date"], "close": round(float(c[-1]), 2),
                      "change": r4(c[-1] / c[-2] - 1), "p": r4(_rarity(c)), "links": links,
                      "dates": [b["date"] for b in last], "o": [round(b["o"], 2) for b in last], "h": [round(b["h"], 2) for b in last],
                      "l": [round(b["l"], 2) for b in last], "c": [round(b["c"], 2) for b in last]})
    try:
        nb = [b for b in _official(ohlc(prices.NIFTY, now), prices.NIFTY_NAME, session) if b["date"] <= session][-CANDLES:]
        india = {"id": "nifty", "name": "NIFTY 50", "region": "India", "session": nb[-1]["date"], "close": round(nb[-1]["c"], 2),
                 "change": portfolio["market"], "p": r4(_rarity(np.array([b["adj"] for b in market if b["date"] <= session]))), "links": [],
                 "dates": [b["date"] for b in nb], "o": [round(b["o"], 2) for b in nb], "h": [round(b["h"], 2) for b in nb],
                 "l": [round(b["l"], 2) for b in nb], "c": [round(b["c"], 2) for b in nb]}
        at = next((i for i, w in enumerate(world) if w["region"] != "Asia"), len(world))
        world.insert(at, india)
    except Exception as ex:
        log(f"  ! NIFTY candles: {ex!r}")

    filed = [e for e in events if e["session"] == session]
    ist_close = dt.datetime.combine(dt.date.fromisoformat(session), dt.time(15, 30), prices.IST)
    return {"session": session, "final": now >= ist_close, "portfolio": portfolio, "movers": movers[:5], "regime": regime,
            "sectors": sectors, "rotation": None if rho is None else round(rho, 2), "world": world,
            "filed": {t: sum(1 for e in filed if e["tier"] == t) for t in ("act", "glance", "aside")},
            "act": [e["id"] for e in filed if e["tier"] == "act"]}
