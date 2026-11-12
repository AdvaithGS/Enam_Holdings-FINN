"""What the market did in the half hour after a filing landed.

The session-level tape (digest.py) says a day was unusual; it cannot say the move
followed the filing. For filings that arrive during trading hours this module measures
the reaction at the timestamp itself, from 5-minute bars:

    pre    = bars that closed before the filing, same session (at least PRE_MIN of them)
    post   = bars that opened at or after it, for HORIZON minutes
    VWAP_w = sum(typical price x volume) / sum(volume) over window w,  typical = (H+L+C)/3
    shock  = VWAP_post / VWAP_pre - 1
    vol_x  = post-window volume / median volume of the same window on other days

The bar the filing lands in is given to neither side. Rarity is empirical, as
everywhere else: the same statistic is computed at every 5-minute anchor within
+-NEAR minutes of the same time of day on every other session we hold, and

    p = (1 + #{anchors at least this extreme}) / (1 + n)

so an 11:40 filing is compared with late mornings, not with the open.

Limits, stated: Yahoo serves about 60 sessions of 5-minute bars and they are delayed,
so this is computed in the batch run, for filings in the current window only; it is
not adjusted for the index (half-hour index moves are small next to a stock's own);
and a filing after the close has no intraday reaction to measure. It is shown as
evidence and does not enter the score: 60 sessions cannot calibrate a weight.
"""
from __future__ import annotations

import datetime as dt
import urllib.parse

import numpy as np

from . import http

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
BAR, HORIZON, NEAR = 5, 30, 60
PRE_MIN, POST_MIN, ANCHORS_MIN = 3, 4, 100


def bars(symbol: str, ttl: float = 3600) -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """5-minute bars by session date: (minute of day at bar open, typical price, volume)."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol + '.NS')}"
           f"?range=60d&interval=5m")
    res = http.get_json(url, ttl=ttl)["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    days: dict[str, list] = {}
    for i, ts in enumerate(res.get("timestamp") or []):
        h, low, c, v = q["high"][i], q["low"][i], q["close"][i], q["volume"][i]
        if None in (h, low, c) or not v:
            continue
        t = dt.datetime.fromtimestamp(ts, IST)
        days.setdefault(t.date().isoformat(), []).append((t.hour * 60 + t.minute, (h + low + c) / 3, float(v)))
    out = {}
    for d, rows in days.items():
        rows.sort()
        m, tp, v = (np.array(col, dtype=float) for col in zip(*rows))
        out[d] = (m, tp, v)
    return out


def _stat(day: tuple[np.ndarray, np.ndarray, np.ndarray], anchor: float) -> tuple[float, float] | None:
    """(shock, post volume) for one session at one anchor minute, or None if too thin."""
    m, tp, v = day
    pre = m + BAR <= anchor
    post = (m >= anchor) & (m < anchor + HORIZON)
    if pre.sum() < PRE_MIN or post.sum() < POST_MIN:
        return None
    vwap_pre = float((tp[pre] * v[pre]).sum() / v[pre].sum())
    vwap_post = float((tp[post] * v[post]).sum() / v[post].sum())
    return vwap_post / vwap_pre - 1, float(v[post].sum())


def reaction(days: dict, at: dt.datetime) -> dict | None:
    """The reaction to a filing made at `at` (IST, naive or aware), or None."""
    day = days.get(at.date().isoformat())
    if day is None:
        return None
    minute = at.hour * 60 + at.minute + at.second / 60
    anchor = BAR * np.ceil(minute / BAR)          # first bar that opens at or after the filing
    got = _stat(day, anchor)
    if got is None:
        return None
    shock, vol = got
    base_shock, base_vol = [], []
    for d, other in days.items():
        if d == at.date().isoformat():
            continue
        for a in np.arange(anchor - NEAR, anchor + NEAR + 1, BAR):
            s = _stat(other, a)
            if s:
                base_shock.append(abs(s[0]))
                base_vol.append(s[1])
    n = len(base_shock)
    if n < ANCHORS_MIN:
        return None
    base_shock, base_vol = np.array(base_shock), np.array(base_vol)
    med = float(np.median(base_vol))
    return {"at": f"{at.hour:02d}:{at.minute:02d}", "minutes": HORIZON, "shock": round(shock, 5),
            "vol_x": round(vol / med, 2) if med > 0 else None,
            "p": round((1 + int((base_shock >= abs(shock)).sum())) / (1 + n), 5),
            "p_vol": round((1 + int((base_vol >= vol).sum())) / (1 + n), 5), "n": n}
