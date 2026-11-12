"""Push: everything filed across the portfolio, folded into events and ranked.

    prices -> signals -> filings -> classify -> fold -> read -> score -> digest.json

Score. Each event gets P(matters), built in log-odds from parts that can each be
shown to the investor:

    z = b0 + b_category                    measured by the event study (materiality.py)
    z = max(z, logit(ACT) + ln(rho))       size: rho = amount / SEBI materiality line
    z = max(z, logit(ACT) + role term)     who: role tier of the person changing
    z += ln(ALPHA / p_session)             the tape: only if the session was a tail day

The SEBI line is Regulation 30(4)(i)(c) of the listing rules: an event is material
when its value exceeds the lowest of 2% of turnover, 2% of net worth and 5% of the
three-year average profit after tax. So rho = 1 is the regulator's own definition of
material, and we pin it exactly to the "what matters" cut-off ACT; each doubling of
rho doubles the odds.

ACT is three times the no-filing baseline: an event enters "what matters" when it is
at least three times likelier than a quiet day to be a day the market notices.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import time
from pathlib import Path

from . import docs, enrich, http, llm, materiality, results, stats
from .sources import nse, prices, screener
from .taxonomy import CATEGORIES, classify, is_reappointment, is_routine_debt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
PAPERWORK = {"routine", "investor_meetings", "shareholder_meeting"}
READ_CATEGORIES = {"m_and_a", "litigation", "capex", "fund_raise", "press_release", "credit_rating", "other",
                   "pledging", "insider_trading", "bonus_split", "dividend"}
ROLE_TERM = {1: math.log(4.0), 2: math.log(1.0), 3: math.log(0.4), 4: math.log(0.1)}
RESULTS_WORDS = re.compile(r"financial results|results for|earnings|quarter(ly)? (and|ended|update)|presentation|press release|"
                           r"media (statement|release)|outcome of (the )?board meeting|\bq[1-4]\b|h[12] ?fy", re.I)
MAX_READS = 60

log_lines: list[str] = []


def log(msg: str = "") -> None:
    print(msg, flush=True)
    log_lines.append(msg)


def sebi_line(co: dict) -> dict | None:
    """Regulation 30(4)(i)(c) materiality line in rupees crore, with its three legs."""
    pl, bs = co["pl"], co["bs"]
    fy = [i for i, p in enumerate(pl["periods"]) if p != "TTM"]
    if not fy:
        return None
    sales = pl["rows"].get("Sales") or pl["rows"].get("Revenue") or []
    profit = pl["rows"].get("Net Profit") or []
    last = fy[-1]
    legs = {}
    if last < len(sales) and sales[last]:
        legs["2% of turnover"] = 0.02 * sales[last]
    bfy = [i for i, p in enumerate(bs["periods"]) if p.startswith("Mar")]
    if bfy:
        eq = (bs["rows"].get("Equity Capital") or [None])[bfy[-1]] if len(bs["rows"].get("Equity Capital", [])) > bfy[-1] else None
        rs = (bs["rows"].get("Reserves") or [None])[bfy[-1]] if len(bs["rows"].get("Reserves", [])) > bfy[-1] else None
        if eq is not None and rs is not None and eq + rs > 0:
            legs["2% of net worth"] = 0.02 * (eq + rs)
    pats = [abs(profit[i]) for i in fy[-3:] if i < len(profit) and profit[i] is not None]
    if pats:
        legs["5% of 3-year average profit"] = 0.05 * sum(pats) / len(pats)
    if not legs:
        return None
    k = min(legs, key=legs.get)
    return {"cr": legs[k], "leg": k}


def _fx() -> dict[str, float]:
    out = {}
    for code in ("USD", "EUR", "GBP"):
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}INR%3DX?range=5d&interval=1d"
            res = http.get_json(url, ttl=12 * 3600)["chart"]["result"][0]
            out[code] = float(res["meta"]["regularMarketPrice"])
        except Exception:
            pass
    return out


def _tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", s.lower())
            if w not in {"limited", "company", "exchange", "informed", "regarding", "about", "with", "that", "this", "from", "update", "updates"}}


def fold(filings: list[dict]) -> list[dict]:
    """Group filings into events: one disclosure often arrives as several filings."""
    events: list[dict] = []
    by_key: dict[tuple, dict] = {}
    # a results announcement can straddle the close: treat its session and the next as one
    results_days: dict[tuple, str] = {}
    for f in sorted(filings, key=lambda x: x["at"]):
        if f["category"] == "results" and f.get("is_results"):
            ses, nxt = f["session"], f.get("next_session")
            first = results_days.setdefault((f["symbol"], ses), ses)
            if nxt:
                results_days.setdefault((f["symbol"], nxt), first)
    for f in sorted(filings, key=lambda x: x["at"]):
        key = (f["symbol"], f["session"], f["category"])
        if (f["symbol"], f["session"]) in results_days and (
                f["category"] in ("results", "earnings_call") or
                (f["category"] in ("press_release", "routine", "dividend", "other") and RESULTS_WORDS.search(f["subject"] + " " + f["text"]))):
            key = (f["symbol"], results_days[(f["symbol"], f["session"])], "results")
        ev = by_key.get(key)
        if not ev:
            ev = {"symbol": f["symbol"], "session": f["session"], "category": key[2], "filings": []}
            by_key[key] = ev
            events.append(ev)
        ev["filings"].append(f)
    # story threads: the same matter filed again on another day
    merged: list[dict] = []
    for ev in events:
        lead = max(ev["filings"], key=lambda f: (f["informative"], len(f["title"])))
        ev["tok"] = _tokens(lead["title"]) if lead["informative"] else set()
        host = None
        if ev["category"] not in PAPERWORK | {"results"} and len(ev["tok"]) >= 3:
            for m in merged:
                if m["symbol"] == ev["symbol"] and m["category"] == ev["category"] and m["tok"]:
                    # overlap coefficient: a follow-up usually repeats the matter and adds words
                    j = len(m["tok"] & ev["tok"]) / min(len(m["tok"]), len(ev["tok"]))
                    if j >= 0.6:
                        host = m
                        break
        if host:
            host["filings"].extend(ev["filings"])
            host["session"] = max(host["session"], ev["session"])
            host["tok"] |= ev["tok"]
        else:
            merged.append(ev)
    return merged


def build(days: int = 35, today: dt.date | None = None) -> dict:
    t0 = time.time()
    cfg = json.loads((ROOT / "data" / "portfolio.json").read_text())
    today = today or dt.datetime.now(prices.IST).date()
    start = today - dt.timedelta(days=days)
    model = materiality.load()
    b0 = model["intercept"]
    base = model["baseline"]
    act = 3 * base
    z_act = stats.logit(act)
    log(f"FINN digest  {dt.datetime.now(prices.IST):%Y-%m-%d %H:%M} IST  window {start} .. {today}")
    log(f"baseline P(noticed | no filing) = {base:.3f}; 'what matters' cut-off = 3x = {act:.3f}")

    # ---- market
    market = prices.history(prices.NIFTY)
    bars = {p["symbol"]: prices.history(p["symbol"]) for p in cfg["portfolio"]}
    bars[prices.NIFTY] = market
    as_of = prices.overlay_official({k: v for k, v in bars.items() if k != prices.NIFTY})
    if as_of and market[-1]["date"] < as_of:
        log(f"note: index history ends {market[-1]['date']}, stock prices run to {as_of}; later sessions have no abnormal return yet")
    fx = _fx()
    companies, series = {}, {}
    for p in cfg["portfolio"]:
        s = p["symbol"]
        sig = materiality.signals(bars[s], market)
        own = {b["date"]: b for b in bars[s]}
        ses = sorted(sig)
        # sessions after the index history ends still get raw change and volume
        tail = [b["date"] for b in bars[s] if b["date"] > (ses[-1] if ses else "")]
        co = screener.company(s) or {}
        line = sebi_line(co) if co else None
        dates = (ses + tail)[-260:]
        rows = []
        vols = [b["volume"] for b in bars[s]]
        idx = {b["date"]: i for i, b in enumerate(bars[s])}
        for d in dates:
            g = sig.get(d)
            i = idx[d]
            if g:
                rows.append(g)
            else:
                prev = bars[s][i - 1]
                avg = sum(vols[i - 20:i]) / 20 if i >= 20 else None
                rows.append({"close": own[d]["close"], "change": own[d]["adj"] / prev["adj"] - 1, "abnormal": None,
                             "vol_ratio": own[d]["volume"] / avg if avg else None, "volume": own[d]["volume"],
                             "p_ret": None, "p_vol": None, "market": None, "beta": None})
        r4 = lambda x: None if x is None else round(x, 4)  # noqa: E731
        series[s] = {"dates": dates, "close": [round(r["close"], 2) for r in rows],
                     "change": [r4(r["change"]) for r in rows], "abnormal": [r4(r["abnormal"]) for r in rows],
                     "vol_ratio": [None if r["vol_ratio"] is None else round(r["vol_ratio"], 2) for r in rows],
                     "p_ret": [r4(r["p_ret"]) for r in rows], "p_vol": [r4(r["p_vol"]) for r in rows]}
        companies[s] = {"symbol": s, "name": p["name"], "legal_name": co.get("name"), "sector": p["sector"],
                        "industry": (co.get("industry") or [None])[-1], "mcap_cr": co.get("market_cap"),
                        "line": line, "beta": next((r4(r["beta"]) for r in reversed(rows) if r.get("beta") is not None), None),
                        "sessions": ses + tail, "_sig": {d: r for d, r in zip(dates, rows)}}
    log(f"prices: {len(companies)} stocks, latest session {as_of}; fx {fx}")

    # ---- filings
    filings = []
    for s, c in companies.items():
        for f in nse.announcements(s, start, today):
            cat, how = classify(f["subject"], f["text"])
            title, informative = enrich.title_of(f["subject"], f["text"])
            ses = materiality.session_of(dt.datetime.fromisoformat(f["at"]), c["sessions"])
            i = c["sessions"].index(ses) if ses else -1
            f.update(category=cat, how=how, title=title, informative=informative, session=ses or f["at"][:10],
                     next_session=c["sessions"][i + 1] if 0 <= i < len(c["sessions"]) - 1 else None)
            filings.append(f)
    log(f"filings: {len(filings)} in window")

    # opaque titles: read the letter's own subject line (local, no model)
    opened = 0
    for f in filings:
        if f["informative"] or not f["url"] or not f["url"].lower().endswith(".pdf"):
            continue
        if f["category"] in PAPERWORK and f["how"] == "subject":
            continue
        page = docs.fetch_pages(f["url"], 1, 2, ocr_limit=2)
        opened += 1
        sub = enrich.subject_from_document("\n".join(page))
        if sub:
            f["title"], f["informative"] = enrich.short(sub[0].upper() + sub[1:], 140), True
            if f["how"] != "subject" or f["category"] in ("other", "press_release"):
                cat, how = classify("", sub)
                if how == "text" and cat != "results":
                    f["category"], f["how"] = cat, "document"
    log(f"opaque titles opened locally: {opened} (OCR pages: {docs.stats['ocr_pages']})")

    idx_cache: dict[str, list] = {}
    for f in filings:
        if f["category"] != "results":
            continue
        s = f["symbol"]
        if s not in idx_cache:
            idx_cache[s] = nse.results_index(s)
        at = dt.datetime.fromisoformat(f["at"])
        hit = next((e for e in idx_cache[s] if abs((dt.datetime.fromisoformat(e["filed"]) - at).total_seconds()) < 2 * 86400), None)
        if hit:
            f["is_results"], f["period_end"] = True, hit["period_end"]

    events = fold(filings)
    log(f"events after folding: {len(events)}")

    # ---- read and score
    reads = 0
    out_events = []
    for ev in events:
        s = ev["symbol"]
        c = companies[s]
        fs = sorted(ev["filings"], key=lambda f: f["at"], reverse=True)
        lead = max(fs, key=lambda f: (f["informative"], f["at"]))
        cat = ev["category"]
        e = {"id": f"{s}-{lead['id']}", "symbol": s, "at": fs[0]["at"], "session": ev["session"], "category": cat,
             "label": CATEGORIES[cat], "title": lead["title"], "url": lead["url"], "summary": None,
             "filings": [{"id": f["id"], "at": f["at"], "subject": f["subject"], "title": f["title"], "url": f["url"]} for f in fs]}
        evidence = []
        coef = model["categories"].get(cat, {}).get("coef", 0.0)
        info = model["categories"].get(cat, {})
        is_results = cat == "results" and any(f.get("is_results") for f in fs)
        if cat == "results" and not is_results:
            coef = 0.0  # a date notice or a presentation alone is not a results day
            evidence.append({"k": "category", "text": "Results-related paperwork, no results filed in this event", "d": 0.0})
        else:
            evidence.append({"k": "category", "d": round(coef, 2),
                             "text": f"{CATEGORIES[cat]} filings: market noticed {info.get('p', base):.0%} of such days vs {base:.0%} base "
                                     f"({info.get('lift', 1):.1f}x, n={info.get('n', 0)})"})
        z = b0 + coef
        floor = None

        if is_results:
            pe = next(f["period_end"] for f in fs if f.get("is_results"))
            e["at"] = min(f["at"] for f in fs if f.get("is_results"))
            try:
                card = results.card(s, pe)
            except Exception as ex:  # a layout we do not model must not sink the run
                card = None
                log(f"  ! results card failed for {s}: {ex!r}")
            if card:
                e["results"] = card
                e["title"] = f"{card['period']} results"
                rev, pat = (next((r for r in card["rows"] if r["key"] == k), None) for k in ("revenue", "pat"))
                if rev and pat and rev["yoy"] is not None and pat["yoy"] is not None:
                    e["title"] = f"{card['period']}: revenue {rev['yoy']:+.0%}, PAT {pat['yoy']:+.0%} YoY"

        elif cat == "management_change":
            people = []
            seen = set()
            for f in fs:
                p = enrich.person_in_text(f["text"])
                if p and p["name"].lower() not in seen:
                    seen.add(p["name"].lower())
                    people.append(p)
            if True:
                try:
                    src = next((f for f in fs if f["url"] and f["url"].lower().endswith(".pdf")), None)
                    if src and reads < MAX_READS:
                        pg = docs.fetch_pages(src["url"], 1, 8)
                        got = enrich.people_from_document(c["legal_name"] or c["name"], pg)
                        reads += 1
                        if got:
                            people = got
                except llm.Unavailable:
                    pass
            if any(is_reappointment(f["text"]) for f in fs):
                for p in people:
                    if p["action"] == "appointed":
                        p["action"] = "reappointed"
            if people:
                e["people"] = people
                moving = [p for p in people if p["action"] != "reappointed"] or people
                top = min(moving, key=lambda p: p["tier"])
                tier = top["tier"] + (1 if top["action"] == "reappointed" else 0)
                floor = z_act + ROLE_TERM.get(min(tier, 4), ROLE_TERM[4])
                names = {1: "runs the company or its finances", 2: "senior executive", 3: "board oversight role", 4: "secretarial role"}
                evidence.append({"k": "role", "d": round(ROLE_TERM.get(min(tier, 4), 0), 2),
                                 "text": f"{top['name']}, {top['role']}: {names[min(tier, 4)]}"
                                         + (" (re-appointment)" if top["action"] == "reappointed" else "")})
                verb = {"appointed": "joins as", "reappointed": "re-appointed as", "resigned": "resigns as", "retired": "retires as",
                        "ceased": "ceases to be", "died": "has died;", "redesignated": "becomes"}[top["action"]]
                e["title"] = enrich.short(f"{top['name']} {verb} {top['role']}", 120)

        elif cat in READ_CATEGORIES:
            amount = None
            for f in fs:
                amount = amount or enrich.amount_in_text(f["text"] + " " + f["title"], fx)
            facts = None
            src = next((f for f in fs if f["url"] and f["url"].lower().endswith(".pdf")), None)
            routine_debt = cat == "fund_raise" and all(is_routine_debt(f["text"] + f["title"]) for f in fs)
            if src and reads < MAX_READS and not routine_debt:
                try:
                    pg = docs.fetch_pages(src["url"], 1, 6)
                    facts = enrich.facts_from_document(c["legal_name"] or c["name"], CATEGORIES[cat], pg, fx)
                    reads += 1
                except llm.Unavailable:
                    facts = None
            if facts:
                if facts["headline"]:
                    e["title"] = facts["headline"]
                e["summary"] = facts["so_what"] or None
                e["counterparty"] = facts["counterparty"]
                if facts["people"]:
                    e["names"] = facts["people"]
                amount = facts.get("amount") or amount
            if amount and c["line"]:
                rho = amount["cr"] / c["line"]["cr"]
                e["amount"] = {**amount, "cr": round(amount["cr"], 2), "rho": round(rho, 3),
                               "line_cr": round(c["line"]["cr"], 1), "leg": c["line"]["leg"]}
                d = max(-3.0, min(3.0, math.log(rho))) if rho > 0 else -3.0
                floor = z_act + d
                evidence.append({"k": "size", "d": round(d, 2),
                                 "text": f"₹{amount['cr']:,.0f} cr is {rho:.2g}x this company's SEBI materiality line "
                                         f"(₹{c['line']['cr']:,.0f} cr, {c['line']['leg']})"})
                if rho < 1:
                    z = min(z, floor)  # a stated, sub-material amount caps the event below the cut-off
            if routine_debt:
                z = min(z, b0)
                evidence.append({"k": "routine", "d": 0.0, "text": "Routine debt issuance for a borrower of this kind"})

        if floor is not None:
            z = max(z, floor) if not (e.get("amount") and e["amount"]["rho"] < 1) else z

        g = c["_sig"].get(ev["session"])
        if g:
            e["market"] = {"change": g["change"], "abnormal": g["abnormal"], "vol_ratio": g["vol_ratio"],
                           "p_ret": g["p_ret"], "p_vol": g["p_vol"]}
        e.update(_z=z, _paper=cat in PAPERWORK and floor is None, _dated=cat == "results" and not is_results, evidence=evidence)
        out_events.append(e)

    # ---- the tape. A tail session is evidence that *something* that day mattered, not
    # that everything filed that day did. If exactly one of the session's events caused
    # the move, with prior weight proportional to its pre-tape odds o_i, then event i is
    # responsible with probability r_i = o_i / sum(o), and its odds are multiplied by
    #     1 + r_i (LR - 1),      LR = ALPHA / p_session
    # so the most plausible cause takes most of the credit and paperwork takes almost none.
    by_session: dict[tuple, list] = {}
    for e in out_events:
        by_session.setdefault((e["symbol"], e["session"]), []).append(e)
    for (s, ses), group in by_session.items():
        g = companies[s]["_sig"].get(ses)
        ps = [x for x in (g["p_ret"], g["p_vol"]) if x is not None] if g else []
        if not ps or min(ps) > materiality.ALPHA:
            continue
        lr = materiality.ALPHA / min(ps)
        odds = [math.exp(e["_z"]) for e in group]
        for e, o in zip(group, odds):
            r = o / sum(odds)
            d = math.log(1 + r * (lr - 1))
            e["_z"] += d
            if d >= 0.1:
                move = f"{g['abnormal']:+.1%} vs market" if g["abnormal"] is not None else f"{g['change']:+.1%}"
                share = "" if len(group) == 1 else f" This event carries {r:.0%} of the credit among {len(group)} that session."
                e["evidence"].append({"k": "tape", "d": round(d, 2),
                                      "text": f"The stock moved {move} on {g['vol_ratio']:.1f}x volume that session; "
                                              f"a day this unusual comes about 1 in {round(1 / min(ps))}.{share}"})
    for e in out_events:
        p = stats.sigmoid(e.pop("_z"))
        paper, dated = e.pop("_paper"), e.pop("_dated")
        tier = "aside" if (paper or dated) else ("act" if p >= act - 1e-9 else "glance")
        e.update(p=round(p, 4), lift=round(p / base, 2), tier=tier)

    out_events.sort(key=lambda e: (e["tier"] != "act", -e["p"], e["at"]))
    for c in companies.values():
        c.pop("_sig")
        c.pop("sessions")
    digest = {
        "generated_at": dt.datetime.now(prices.IST).isoformat(timespec="seconds"),
        "as_of": as_of, "window_days": days,
        "model": {"baseline": round(base, 4), "act": round(act, 4), "alpha": model["alpha"], "sessions": model["sessions"],
                  "categories": {k: {"n": v["n"], "p": round(v["p"], 4), "lift": round(v["lift"], 2),
                                     "lo": round(v["lift_lo"], 2), "hi": round(v["lift_hi"], 2)}
                                 for k, v in model["categories"].items()}},
        "labels": CATEGORIES, "companies": companies, "events": out_events,
        "run": {"filings": len(filings), "events": len(out_events), "documents_read": reads,
                "llm": dict(llm.usage), "http": dict(http.stats), "seconds": round(time.time() - t0, 1),
                "ocr_pages": docs.stats["ocr_pages"], "llm_available": llm.available()},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "digest.json").write_text(json.dumps(digest, ensure_ascii=False, separators=(",", ":")))
    (OUT / "market.json").write_text(json.dumps({"as_of": as_of, "series": series}, separators=(",", ":")))

    log("")
    for tier, name in (("act", "WHAT MATTERS"), ("glance", "WORTH A GLANCE")):
        rows = [e for e in out_events if e["tier"] == tier]
        log(f"--- {name} ({len(rows)})")
        for e in rows[:60]:
            log(f"  {e['p']:.2f} {e['symbol']:10s} {e['at'][:10]} {e['label']:16s} {e['title'][:90]}")
            for ev in e["evidence"][1:]:
                log(f"         . {ev['text']}")
    aside = [e for e in out_events if e["tier"] == "aside"]
    log(f"--- SET ASIDE ({len(aside)} events, {sum(len(e['filings']) for e in aside)} filings)")
    log(f"\nrun: {digest['run']}")
    (ROOT / "data" / "last-run.log").write_text("\n".join(log_lines) + "\n")
    return digest


if __name__ == "__main__":
    import sys
    build(int(sys.argv[1]) if len(sys.argv) > 1 else 35)
