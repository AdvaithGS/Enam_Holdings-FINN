"""End-of-day price and volume.

History comes from Yahoo's chart endpoint (one request per symbol, split-adjusted).
The most recent sessions are overwritten from the NSE bhavcopy, which is the
exchange's own record, so the numbers that drive alerts are the official ones.
"""
from __future__ import annotations

import datetime as dt
import urllib.parse

from .. import http
from . import nse

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
NIFTY = "^NSEI"
NIFTY_NAME = "Nifty 50"


def history(symbol: str, years: int = 5, ttl: float = 6 * 3600) -> list[dict]:
    """Daily bars, oldest first: date, close (as traded), adj (adjusted close), volume."""
    ysym = symbol if symbol.startswith("^") else f"{symbol}.NS"
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ysym)}"
           f"?range={years}y&interval=1d")
    res = http.get_json(url, ttl=ttl)["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    out = []
    for i, ts in enumerate(res.get("timestamp") or []):
        c, a, v = q["close"][i], adj[i], q["volume"][i]
        if c is None or a is None:
            continue
        day = dt.datetime.fromtimestamp(ts, IST).date()
        out.append({"date": day.isoformat(), "close": float(c), "adj": float(a), "volume": int(v or 0)})
    # Yahoo sometimes repeats the live session as a second bar for the same date.
    dedup: dict[str, dict] = {}
    for b in out:
        dedup[b["date"]] = b
    return [dedup[k] for k in sorted(dedup)]


def overlay_index(series: list[dict], name: str = NIFTY_NAME, sessions: int = 3) -> None:
    """Bring an NSE index series up to date from the exchange's own index file.

    Yahoo's daily bar for an index can lag a session; the exchange publishes every
    index close each evening. Index levels are not adjusted, so adj = close.
    """
    day, found = dt.datetime.now(IST).date(), 0
    fresh = []
    for _ in range(sessions + 8):
        if found >= sessions:
            break
        rows = nse.index_closes(day) if day.weekday() < 5 else None
        if rows and name in rows:
            found += 1
            fresh.append((day.isoformat(), rows[name]))
        day -= dt.timedelta(days=1)
    by_date = {b["date"]: b for b in series}
    for key, row in reversed(fresh):
        hit = by_date.get(key)
        if hit:
            hit.update(close=row["c"], adj=row["c"], o=row["o"], h=row["h"], l=row["l"])
        elif not series or series[-1]["date"] < key:
            series.append({"date": key, "close": row["c"], "adj": row["c"], "volume": 0, "o": row["o"], "h": row["h"], "l": row["l"]})


def overlay_official(bars: dict[str, list[dict]], sessions: int = 3) -> str | None:
    """Replace the latest `sessions` bars with bhavcopy values. Returns the latest date."""
    day, found, latest = dt.datetime.now(IST).date(), 0, None
    for _ in range(sessions + 8):
        if found >= sessions:
            break
        bc = nse.bhavcopy(day) if day.weekday() < 5 else None
        if bc:
            found += 1
            latest = latest or day.isoformat()
            for sym, series in bars.items():
                row = bc.get(sym)
                if not row:
                    continue
                key = day.isoformat()
                hit = next((b for b in reversed(series[-10:]) if b["date"] == key), None)
                if hit:
                    # keep the adjustment factor Yahoo applied, swap in official prints
                    factor = hit["adj"] / hit["close"] if hit["close"] else 1.0
                    hit.update(close=row["close"], adj=row["close"] * factor, volume=row["volume"])
                elif series and series[-1]["date"] < key:
                    series.append({"date": key, "close": row["close"], "adj": row["close"],
                                   "volume": row["volume"]})
        day -= dt.timedelta(days=1)
    return latest
