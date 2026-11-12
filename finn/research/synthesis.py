"""Reduce step: the one place a stronger model reasons.

It never sees a raw document. It gets (a) numbers computed in code, (b) verified
extracts with ids. It must cite an id for every point; code then
  - drops any point whose citations do not exist,
  - overrides the verdict on quantified commitments that code can adjudicate itself.

Code adjudication. A commitment is checked in code when it has a number, a fiscal
year we have data for, and a metric we compute:
    revenue_growth  -> FY revenue growth          operating_margin -> FY operating margin
    pat_margin      -> FY PAT margin
With stated range [low, high] and actual x (in the same unit):
    met      x >= low            missed   x < low - tol      partial  otherwise
    tol = 1 percentage point for growth, 0.5 for margins (rounding in the way people guide)
A year still in progress is "pending", with the year-to-date figure shown.
"""
from __future__ import annotations

import json
import re

from .. import llm

SCHEMA = {
    "type": "object", "required": ["promised_vs_delivered", "narrative_vs_numbers", "bull", "bear", "watch"],
    "properties": {
        "promised_vs_delivered": {"type": "array", "items": {
            "type": "object", "required": ["commitment_id", "delivered", "verdict"],
            "properties": {
                "commitment_id": {"type": "string"},
                "delivered": {"type": "string", "description": "what the numbers or later calls show, at most 26 words, citing the period"},
                "verdict": {"type": "string", "enum": ["met", "partial", "missed", "pending", "not_measurable"]},
                "sources": {"type": "array", "items": {"type": "string"}},
            }}},
        "guidance_drift": {"type": "array", "description": "a metric guided in more than one call: how the guidance moved", "items": {
            "type": "object", "required": ["metric", "direction", "path"],
            "properties": {"metric": {"type": "string"}, "direction": {"type": "string", "enum": ["raised", "held", "lowered", "withdrawn"]},
                           "path": {"type": "string", "description": "oldest to newest, e.g. 'C4: 15-17% -> C2: 14-15% -> C1: ~13%'"},
                           "sources": {"type": "array", "items": {"type": "string"}}}}},
        "narrative_vs_numbers": {"type": "array", "items": {
            "type": "object", "required": ["story", "numbers", "verdict", "sources"],
            "properties": {"story": {"type": "string", "description": "what management says, at most 20 words"},
                           "numbers": {"type": "string", "description": "what the computed numbers show, at most 24 words, with figures"},
                           "verdict": {"type": "string", "enum": ["agree", "mixed", "diverge"]},
                           "sources": {"type": "array", "items": {"type": "string"}}}}},
        "bull": {"type": "array", "items": {"type": "object", "required": ["point", "sources"],
                 "properties": {"point": {"type": "string", "description": "at most 24 words"}, "sources": {"type": "array", "items": {"type": "string"}}}}},
        "bear": {"type": "array", "items": {"type": "object", "required": ["point", "sources"],
                 "properties": {"point": {"type": "string", "description": "at most 24 words"}, "sources": {"type": "array", "items": {"type": "string"}}}}},
        "watch": {"type": "array", "description": "what to check next quarter", "items": {"type": "object", "required": ["point", "sources"],
                  "properties": {"point": {"type": "string", "description": "at most 20 words"}, "sources": {"type": "array", "items": {"type": "string"}}}}},
    },
}

PROMPT = """You are analysing {company} for an investor. You have only the material below: numbers computed from the company's reported statements (source id FIN), extracts from its last earnings calls (C1 is the most recent; commitments have ids like C2.3), and extracts from its annual report (AR).

Rules
- Use nothing else. No outside knowledge, no news, no broker views. If the material cannot support a point, leave the point out.
- Every point must list the source ids it rests on (FIN, AR, C1..C4, or a commitment id).
- promised_vs_delivered: go through the commitments, oldest call first. For each one worth judging (at most 8), state what was delivered using FIN numbers or what a LATER call said. A full-year target judged before the year has ended is "pending" (or "partial" if year-to-date numbers are clearly behind), never "missed". Use "not_measurable" when the material has no number that bears on it.
- narrative_vs_numbers: 3 to 5 places where management's description and the FIN numbers agree or diverge. Quote figures.
- bull and bear: 3 points each, each grounded in a number or a cited statement. watch: 3 concrete things to check next quarter.
- Write plainly. No adjectives that the numbers do not earn.

FIN (rupees crore; ratios as decimals)
{fin}

CALLS
{calls}

AR
{ar}"""

_FY = re.compile(r"fy\s?'?(\d{2,4})", re.I)


def _fy_of(text: str) -> str | None:
    m = _FY.search(text or "")
    if not m or re.search(r"\bq[1-4]\b|h[12]\b|quarter|half", text or "", re.I):
        return None
    return "FY" + m.group(1)[-2:]


def adjudicate(commitment: dict, fundamentals: dict) -> dict | None:
    """Verdict computed in code, or None when the commitment is not checkable."""
    if commitment.get("unit") != "percent" or commitment.get("low") is None:
        return None
    fy = _fy_of(commitment.get("horizon") or "") or _fy_of(commitment.get("target") or "")
    if not fy:
        return None
    rows = {r["fy"]: r for r in fundamentals["annual"]}
    metric = commitment["metric"]
    low, high = commitment["low"], commitment.get("high") or commitment["low"]
    if fy not in rows:
        if int(fy[2:]) > int(fundamentals["last_fy"][2:]):
            return {"verdict": "pending", "delivered": f"{fy} is not complete; no full-year figure yet.", "by": "code"}
        return None
    r, prev = rows[fy], rows.get(f"FY{int(fy[2:]) - 1:02d}")
    if metric == "revenue_growth" and prev and prev["revenue"]:
        x, tol, name = (r["revenue"] / prev["revenue"] - 1) * 100, 1.0, "revenue growth"
    elif metric == "operating_margin" and r["opm"] is not None:
        x, tol, name = r["opm"] * 100, 0.5, "operating margin"
    elif metric == "pat_margin" and r["npm"] is not None:
        x, tol, name = r["npm"] * 100, 0.5, "PAT margin"
    else:
        return None
    verdict = "met" if x >= low else ("missed" if x < low - tol else "partial")
    rng = f"{low:g}%" if high == low else f"{low:g}-{high:g}%"
    return {"verdict": verdict, "delivered": f"{fy} {name} was {x:.1f}% against a stated {rng}.", "by": "code", "actual": round(x, 2)}


def _fin_block(f: dict) -> str:
    keep = ("fy", "revenue", "op_profit", "pat", "opm", "npm", "cfo", "fcf", "debt", "net_worth", "de", "roe", "roce", "roa",
            "debtor_days", "inventory_days", "cycle_days", "net_debt_ebitda")
    rnd = lambda v: round(v, 3) if isinstance(v, float) else v  # noqa: E731
    annual = [{k: rnd(r.get(k)) for k in keep if r.get(k) is not None} for r in f["annual"][-6:]]
    quarters = [{k: rnd(v) for k, v in q.items() if v is not None} for q in f["quarters"]]
    metrics = {k: rnd(v) for k, v in f["metrics"].items() if v is not None}
    return json.dumps({"annual": annual, "quarters": quarters, "metrics": metrics}, separators=(",", ":"))


def synthesise(company: str, fundamentals: dict, calls: list[dict], annual: dict | None) -> dict:
    ok_calls = [c for c in calls if c.get("ok")]
    calls_block = json.dumps([{"id": c["id"], "when": c["when"], "quarter": c.get("quarter"),
                               "commitments": [{k: v for k, v in m.items() if k in ("id", "metric", "target", "horizon", "quote")} for m in c["commitments"]],
                               "claims": [{"topic": m["topic"], "claim": m["claim"]} for m in c["claims"]],
                               "analyst_concerns": [m["question"] for m in c["analyst_concerns"]]} for c in ok_calls],
                             ensure_ascii=False, separators=(",", ":"))
    ar_block = json.dumps({k: v for k, v in (annual or {}).items()
                           if k in ("what_it_does", "segments", "geography", "customers", "facts", "risks")}, ensure_ascii=False) if annual and annual.get("ok") else "not available"
    got = llm.ask("flash", PROMPT.format(company=company, fin=_fin_block(fundamentals), calls=calls_block, ar=ar_block), SCHEMA, max_tokens=6000)

    commitments = {m["id"]: m for c in ok_calls for m in c["commitments"]}
    valid = {"FIN", "AR"} | {c["id"] for c in ok_calls} | set(commitments)

    def cited(items):
        out = []
        for it in items or []:
            it["sources"] = [s for s in it.get("sources", []) if s in valid]
            if it["sources"]:
                out.append(it)
        return out

    pvd = []
    for it in got.get("promised_vs_delivered", []):
        c = commitments.get(it.get("commitment_id"))
        if not c:
            continue
        it["sources"] = sorted({s for s in it.get("sources", []) if s in valid} | {c["source"]})
        it["by"] = "model"
        coded = adjudicate(c, fundamentals)
        if coded:
            it.update(coded)
            it["sources"] = sorted(set(it["sources"]) | {"FIN"})
        it.update(promised=c["target"], quote=c["quote"], metric=c["metric"], call=c["source"])
        pvd.append(it)
    counts = {}
    for it in pvd:
        counts[it["verdict"]] = counts.get(it["verdict"], 0) + 1
    return {"promised_vs_delivered": pvd, "scorecard": counts, "guidance_drift": cited(got.get("guidance_drift")),
            "narrative_vs_numbers": cited(got.get("narrative_vs_numbers")), "bull": cited(got.get("bull"))[:3],
            "bear": cited(got.get("bear"))[:3], "watch": cited(got.get("watch"))[:3]}
