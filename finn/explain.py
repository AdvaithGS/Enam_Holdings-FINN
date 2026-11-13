"""When a stock moves and nothing was filed: what else could explain it?

"No filing" is where the work starts, not where it ends. For every stock-session in the
window that moved unusually and has no filing the investor would see, this module tests
a fixed list of public explanations, in order of how much each can account for, and
reports the ones the data supports. Nothing here is a model's guess.

  1. The market.   r = beta * m + e. The part beta * m is the market's; if it is at least
                   half the move, the move is systematic, not the stock's.
  2. The sector.   The stock's NSE sector index against the NIFTY that day.
  3. Breadth.      How many holdings had a tail session the same day (a macro day shows
                   up as many at once; volatility scaling alone cannot see that).
  4. Peers.        Other holdings in the same field moving the same way beyond the market.
  5. Deals.        Bulk and block deals reported to the exchange for that day, sized
                   against the day's traded volume.
  6. Calendar.     A board meeting to consider results within the next week, results
                   filed the session before, or a filing that arrived the session after.
  7. Shape.        Heavy volume with almost no price change is the signature of a
                   negotiated or index-related trade, not of news.

If none applies, the note says so plainly: every public explanation was checked and
failed, which is itself the finding, and the phone attaches the person to call.
News is not searched: FINN reads primary sources, and a headline is someone's guess too.
"""
from __future__ import annotations

import datetime as dt
import urllib.parse

from . import http
from .sources import nse, prices

SECTOR = {
    "HDFCBANK": ("Nifty Bank", "^NSEBANK"), "BAJFINANCE": ("Nifty Financial Services", "^CNXFIN"), "PAYTM": ("Nifty Financial Services", "^CNXFIN"),
    "CREDITACC": ("Nifty Financial Services", "^CNXFIN"), "TCS": ("Nifty IT", "^CNXIT"), "MARUTI": ("Nifty Auto", "^CNXAUTO"),
    "SUNPHARMA": ("Nifty Pharma", "^CNXPHARMA"), "ITC": ("Nifty FMCG", "^CNXFMCG"), "RELIANCE": ("Nifty Energy", "^CNXENERGY"),
    "LT": ("Nifty Infrastructure", "^CNXINFRA"), "BHARTIARTL": ("Nifty Infrastructure", "^CNXINFRA"), "CGPOWER": ("Nifty Infrastructure", "^CNXINFRA"),
}
MOVE, VOL, RARE, TAIL = 0.02, 2.0, 0.10, 0.05
BROAD = 0.3   # share of holdings with a tail session at once before the day is called broad (expected by chance: about 0.1)


def _returns(ysym: str) -> dict[str, float]:
    bars = prices.history(ysym, years=1)
    return {b["date"]: b["close"] / a["close"] - 1 for a, b in zip(bars, bars[1:]) if a["close"]}


def deals(symbol: str, start: dt.date, end: dt.date) -> dict[str, list[dict]]:
    """Bulk and block deals the exchange reported for a symbol, by date."""
    out: dict[str, list[dict]] = {}
    for kind in ("bulk_deals", "block_deals"):
        q = urllib.parse.urlencode({"optionType": kind, "symbol": symbol, "from": start.strftime("%d-%m-%Y"), "to": end.strftime("%d-%m-%Y")})
        try:
            rows = http.get_json(f"{nse.API}/historicalOR/bulk-block-short-deals?{q}", ttl=6 * 3600, retries=1).get("data", [])
        except http.FetchError:
            continue
        for r in rows:
            try:
                day = dt.datetime.strptime(r["BD_DT_DATE"].title(), "%d-%b-%Y").date().isoformat()
                out.setdefault(day, []).append({"kind": kind.split("_")[0], "who": r["BD_CLIENT_NAME"].strip().title(), "side": r["BD_BUY_SELL"].lower(),
                                                "qty": float(r["BD_QTY_TRD"]), "price": float(r["BD_TP_WATP"])})
            except (KeyError, ValueError):
                continue
    return out


def results_meetings(symbol: str) -> list[str]:
    """Dates of board meetings called to consider financial results."""
    try:
        rows = http.get_json(f"{nse.API}/corporate-board-meetings?index=equities&symbol={urllib.parse.quote(symbol)}", ttl=12 * 3600, retries=1)
    except http.FetchError:
        return []
    out = []
    for r in rows:
        if "result" in (r.get("bm_desc") or "").lower():
            try:
                out.append(dt.datetime.strptime(r["bm_date"], "%d-%b-%Y").date().isoformat())
            except (KeyError, ValueError):
                pass
    return out


def build(companies: dict, events: list[dict], start: dt.date, today: dt.date, log=print) -> dict:
    seen = {(e["symbol"], e["session"]): e for e in events if e["tier"] != "aside"}
    by_day: dict[tuple, list[dict]] = {}
    for e in events:
        by_day.setdefault((e["symbol"], e["session"]), []).append(e)
    sig = {s: c["_sig"] for s, c in companies.items()}
    rare = lambda g: min([x for x in (g.get("p_ret"), g.get("p_vol")) if x is not None], default=1.0)  # noqa: E731
    breadth: dict[str, int] = {}
    for s in sig:
        for d, g in sig[s].items():
            if rare(g) <= TAIL:
                breadth[d] = breadth.get(d, 0) + 1
    sector_cache: dict[str, dict] = {}
    out: dict[str, dict] = {}
    n = 0
    for s, c in companies.items():
        days = [d for d, g in sig[s].items() if d >= start.isoformat() and g.get("change") is not None and (s, d) not in seen
                and (abs(g["change"]) >= MOVE or (g.get("vol_ratio") or 0) >= VOL or rare(g) <= RARE)]
        if not days:
            continue
        dl = deals(s, start, today)
        meetings = results_meetings(s)
        ses = c["sessions"]
        for d in days:
            g = sig[s][d]
            ch, why = g["change"], []
            beta, mkt = g.get("beta"), g.get("market")
            parts = None
            if beta is not None and mkt is not None:
                m_part = beta * mkt
                parts = {"market": round(m_part, 4), "own": round(ch - m_part, 4)}
                if abs(ch) >= 0.01 and m_part * ch > 0 and abs(m_part) >= 0.5 * abs(ch):
                    why.append({"k": "market", "text": f"Mostly the market: NIFTY {mkt:+.1%} at this stock's beta of {beta:.2f} accounts for {m_part:+.1%} of the {ch:+.1%}."})
            if s in SECTOR and mkt is not None:
                label, ysym = SECTOR[s]
                try:
                    if ysym not in sector_cache:
                        sector_cache[ysym] = _returns(ysym)
                    sr = sector_cache[ysym].get(d)
                except Exception:
                    sr = None
                if sr is not None and (sr - mkt) * ch > 0 and abs(sr - mkt) >= 0.008:
                    why.append({"k": "sector", "text": f"Its sector moved with it: {label} {'beat' if sr > mkt else 'lagged'} the NIFTY by {abs(sr - mkt):.1%} ({sr:+.1%} against {mkt:+.1%})."})
            if breadth.get(d, 0) >= BROAD * len(companies):
                why.append({"k": "breadth", "text": f"A broad day: {breadth[d]} of your {len(companies)} holdings had a tail session at once, which points at macro, not at this company."})
            own = g.get("abnormal")
            if own is not None and abs(own) >= 0.015:
                peers = [(o, sig[o][d]["abnormal"]) for o, oc in companies.items() if o != s and oc["sector"].split(" ")[-1] == c["sector"].split(" ")[-1]
                         and d in sig[o] and sig[o][d].get("abnormal") is not None and sig[o][d]["abnormal"] * own > 0 and abs(sig[o][d]["abnormal"]) >= 0.015]
                if peers:
                    why.append({"k": "peers", "text": "Peers you hold moved the same way beyond the market: " + ", ".join(f"{o} {a:+.1%}" for o, a in peers) + "."})
            for x in sorted(dl.get(d, []), key=lambda x: -x["qty"])[:2]:
                share = x["qty"] / g["volume"] if g.get("volume") else None
                why.append({"k": "deal", "text": f"{x['kind'].title()} deal: {x['who']} {'bought' if x['side'] == 'buy' else 'sold'} {x['qty'] / 1e5:,.1f} lakh shares at ₹{x['price']:,.0f} "
                                                 f"(₹{x['qty'] * x['price'] / 1e7:,.0f} cr" + (f", {share:.0%} of the day's volume)." if share else ").")})
            ahead = [m for m in meetings if d < m <= (dt.date.fromisoformat(d) + dt.timedelta(days=7)).isoformat()]
            if ahead:
                why.append({"k": "calendar", "text": f"Results are due: the board meets on {dt.date.fromisoformat(min(ahead)):%-d %b} to approve them. Positioning ahead of results is common."})
            i = ses.index(d) if d in ses else -1
            if i > 0 and any(e["category"] == "results" and e.get("results") for e in by_day.get((s, ses[i - 1]), [])):
                why.append({"k": "calendar", "text": "Results were filed the session before; this is the market still digesting them."})
            if 0 <= i < len(ses) - 1:
                nxt = [e for e in by_day.get((s, ses[i + 1]), []) if e["tier"] != "aside"]
                if nxt:
                    why.append({"k": "calendar", "text": f"A filing followed the next session: “{nxt[0]['title'][:90]}”. The move may have anticipated it."})
            if (g.get("vol_ratio") or 0) >= VOL and own is not None and abs(own) < 0.01 and not dl.get(d):
                why.append({"k": "shape", "text": f"{g['vol_ratio']:.1f}x volume with the price barely moving beyond the market ({own:+.1%}): the shape of a negotiated or index-related trade, not of news."})
            found = bool(why)
            if not found:
                why.append({"k": "none", "text": "No public explanation holds: not the market, not its sector, no peers, no reported deals, nothing on the calendar. That is a reason to ask someone."})
            out.setdefault(s, {})[d] = {"parts": parts, "why": why, "found": found, "broad": breadth.get(d, 0)}
            n += 1
    log(f"moves without a filing: {n} examined, {sum(1 for s in out.values() for x in s.values() if x['found'])} with a supported explanation")
    return out
