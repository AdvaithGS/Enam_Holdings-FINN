"""Map step: read each primary document once with the cheap model, keep only what
can be traced to the page.

  transcript -> commitments (forward-looking statements by management, with numbers
                where stated), claims (how management describes the business now),
                and what analysts pressed on
  annual report -> business snapshot from locally selected pages

Every item carries a verbatim quote. Code checks that the quote is in the document
(ignoring spacing and punctuation); items that fail are dropped, and the drop count
is reported in the dossier so the reader can see how much was discarded.
"""
from __future__ import annotations

import re

from .. import docs, llm

METRICS = ["revenue_growth", "revenue", "operating_margin", "pat", "pat_margin", "capex", "order_book",
           "capacity", "debt", "working_capital", "credit_cost", "loan_growth", "other"]

CALL_SCHEMA = {
    "type": "object", "required": ["quarter", "commitments", "claims", "analyst_concerns"],
    "properties": {
        "quarter": {"type": "string", "description": "the quarter this call discusses, e.g. Q1 FY27"},
        "commitments": {"type": "array", "description": "explicit forward-looking guidance or targets stated by management", "items": {
            "type": "object", "required": ["metric", "target", "quote"],
            "properties": {
                "metric": {"type": "string", "enum": METRICS},
                "target": {"type": "string", "description": "the commitment in at most 20 words, with its number and period"},
                "horizon": {"type": "string", "description": "the period it applies to, e.g. FY27, Q3 FY27, 'by FY28'; empty if not stated"},
                "low": {"type": "number", "description": "lower bound of the stated number, if a number is stated"},
                "high": {"type": "number", "description": "upper bound; same as low for a point target"},
                "unit": {"type": "string", "enum": ["percent", "crore", "times", "days", "other", "none"]},
                "speaker": {"type": "string"},
                "quote": {"type": "string", "description": "the exact sentence(s) from the transcript, copied verbatim, at most 60 words"},
            }}},
        "claims": {"type": "array", "description": "management's description of current performance or its causes", "items": {
            "type": "object", "required": ["topic", "claim", "quote"],
            "properties": {"topic": {"type": "string"}, "claim": {"type": "string", "description": "at most 22 words"},
                           "quote": {"type": "string", "description": "verbatim, at most 50 words"}}}},
        "analyst_concerns": {"type": "array", "items": {
            "type": "object", "required": ["topic", "question"],
            "properties": {"topic": {"type": "string"}, "question": {"type": "string", "description": "what the analyst pressed on, at most 20 words"},
                           "quote": {"type": "string", "description": "verbatim from the analyst, at most 40 words"}}}},
    },
}

CALL_PROMPT = """This is the transcript of an earnings call of {company}, held around {when}.
Extract, using only this transcript:
1. commitments: every explicit forward-looking statement by MANAGEMENT about headline numbers (growth, revenue, margins, profit, capex, order book, capacity, debt, working capital, credit cost). Include the number and the period when stated. At most 10, the most specific first. Skip vague optimism with no number or period.
2. claims: up to 6 statements by management that explain current performance (what grew, what hurt, why).
3. analyst_concerns: up to 4 things analysts pressed on or pushed back on.
Copy each quote exactly as it appears in the transcript. Do not paraphrase inside quotes. Do not add anything from outside the transcript.

TRANSCRIPT
{text}"""


def _verified(items: list[dict], hay: str) -> tuple[list[dict], int]:
    keep = [i for i in items if docs.contains_quote(hay, i.get("quote") or "", min_len=20)]
    return keep, len(items) - len(keep)


def read_call(company: str, when: str, url: str, sid: str) -> dict:
    """Extract one transcript. `sid` is its source id (C1 = most recent)."""
    pages = docs.fetch_pages(url, ocr_limit=0)
    text = "\n".join(pages)
    if len(text) < 3000:
        return {"id": sid, "when": when, "url": url, "ok": False, "reason": "transcript text could not be read"}
    got = llm.ask("lite", CALL_PROMPT.format(company=company, when=when, text=text[:140000]), CALL_SCHEMA, max_tokens=6000)
    hay = docs.norm(text)
    commitments, d1 = _verified(got.get("commitments", []), hay)
    claims, d2 = _verified(got.get("claims", []), hay)
    concerns = [c for c in got.get("analyst_concerns", []) if not c.get("quote") or docs.contains_quote(hay, c["quote"], 16)]
    for n, c in enumerate(commitments, 1):
        c["id"] = f"{sid}.{n}"
        c["source"] = sid
    for c in claims:
        c["source"] = sid
    return {"id": sid, "when": when, "url": url, "ok": True, "quarter": got.get("quarter") or when,
            "commitments": commitments, "claims": claims, "analyst_concerns": concerns[:4],
            "dropped": d1 + d2, "pages": len(pages), "chars": len(text)}


# ----------------------------------------------------------------- annual report

_SIGNALS = [
    (re.compile(r"management discussion|md&a", re.I), 3.0),
    (re.compile(r"business (overview|segments?|model|verticals?)|segment(al)? (revenue|performance|results|information)|revenue (mix|break-?up|by)", re.I), 3.0),
    (re.compile(r"who we are|at a glance|what we do|our (business|businesses|presence|products|customers|portfolio)|company overview|corporate overview", re.I), 2.5),
    (re.compile(r"\b(exports?|domestic|geograph\w+|customers?|clients?|market share|order book|capacity|plants?|facilities|branches)\b", re.I), 0.4),
    (re.compile(r"\d+(\.\d+)?\s?%"), 0.15),
    (re.compile(r"risks? (and|&) concerns|key risks|outlook|opportunities and threats", re.I), 1.5),
]
_PENALTY = re.compile(r"notice (of|to) |annual general meeting|proxy|e-voting|secretarial audit|independent auditor|"
                      r"corporate governance report|notes (to|forming part)|significant accounting policies|brsr|"
                      r"business responsibility|din:|remuneration of|csr (activities|policy)", re.I)


def select_pages(pages: list[str], k: int = 14) -> list[int]:
    """Score every page by what it talks about; return the best k page numbers (1-based).

    score = sum over signals of weight x min(matches, 5), less a penalty for
    statutory boilerplate. Local and deterministic: no tokens are spent on the
    ~95% of an annual report that cannot answer "what does this company do".
    """
    scored = []
    for i, p in enumerate(pages):
        if len(p) < 400:
            continue
        s = sum(w * min(len(rx.findall(p)), 5) for rx, w in _SIGNALS)
        s -= 2.0 * min(len(_PENALTY.findall(p)), 5)
        scored.append((s, i + 1))
    best = sorted(scored, reverse=True)[:k]
    return sorted(n for s, n in best if s > 0)


AR_SCHEMA = {
    "type": "object", "required": ["what_it_does", "segments"],
    "properties": {
        "what_it_does": {"type": "string", "description": "two sentences, at most 45 words, plain English"},
        "segments": {"type": "array", "items": {
            "type": "object", "required": ["name"],
            "properties": {"name": {"type": "string"}, "share_pct": {"type": "number", "description": "share of revenue in percent, only if stated"},
                           "note": {"type": "string", "description": "at most 14 words"}, "page": {"type": "integer"}}}},
        "revenue_mix_basis": {"type": "string", "description": "what the shares are a share of and for which year, as stated"},
        "geography": {"type": "string", "description": "domestic vs export or regional mix as stated, at most 20 words; empty if not stated"},
        "customers": {"type": "string", "description": "customer concentration or key customer types as stated, at most 20 words; empty if not stated"},
        "facts": {"type": "array", "description": "up to 5 operating facts with numbers (capacity, plants, branches, order book, employees)", "items": {
            "type": "object", "required": ["fact", "page"], "properties": {"fact": {"type": "string"}, "page": {"type": "integer"}}}},
        "risks": {"type": "array", "description": "up to 4 risks the company itself names", "items": {
            "type": "object", "required": ["risk", "page"], "properties": {"risk": {"type": "string", "description": "at most 16 words"}, "page": {"type": "integer"}}}},
    },
}

AR_PROMPT = """These are selected pages from the {year} annual report of {company}. Each page starts with a marker like [PAGE 12].
Describe the business using only these pages. Give revenue shares only when a page states them. Cite the page number for each fact and risk.
Do not use anything you know about the company from elsewhere.

PAGES
{text}"""


def read_annual(company: str, year: int, url: str, max_pages: int | None = None) -> dict:
    pages = docs.fetch_pages(url, 1, max_pages, ocr_limit=0)
    if len(pages) < 10:
        return {"id": "AR", "year": year, "url": url, "ok": False, "reason": "annual report text could not be read"}
    picked = select_pages(pages)
    text = "\n\n".join(f"[PAGE {n}]\n{docs.clean(pages[n - 1])[:6000]}" for n in picked)
    got = llm.ask("lite", AR_PROMPT.format(company=company, year=year, text=text), AR_SCHEMA, max_tokens=3000)
    ok_pages = set(picked)
    got["facts"] = [f for f in got.get("facts", []) if f.get("page") in ok_pages][:5]
    got["risks"] = [r for r in got.get("risks", []) if r.get("page") in ok_pages][:4]
    shares = [s.get("share_pct") for s in got.get("segments", []) if s.get("share_pct")]
    if shares and not 85 <= sum(shares) <= 115:
        # shares that do not sum to ~100 are not a mix; keep the names, drop the numbers
        for s in got["segments"]:
            s.pop("share_pct", None)
        got["mix_dropped"] = True
    return {"id": "AR", "year": year, "url": url, "ok": True, "pages_total": len(pages), "pages_read": picked, **got}
