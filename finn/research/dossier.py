"""Pull: a research dossier on any NSE company, in stages.

Each stage is a pure function of its inputs, so the same code serves the batch
script (all stages in one process) and the serverless API (one stage per request,
the phone holding the intermediate results between requests).

    base(symbol)                 statements -> computed fundamentals, document links
    call(symbol, i)              transcript i -> verified commitments and claims
    annual(symbol)               annual report -> business snapshot
    synth(base, calls, annual)   one reasoning call over the extracts
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

from .. import llm
from ..sources import nse, screener
from . import documents, fundamentals, synthesis

OUT = Path(__file__).resolve().parent.parent.parent / "public" / "data" / "research"
N_CALLS = 4


def resolve(query: str) -> list[dict]:
    """Match free text to NSE symbols: exact symbol, then name prefix, then substring."""
    q = re.sub(r"\s+", " ", query.strip()).upper()
    if not q:
        return []
    rows = nse.equities()
    words = q.split()

    def rank(r):
        s, n = r["symbol"], r["name"].upper()
        if s == q:
            return 0
        if s.startswith(q):
            return 1
        if n.startswith(q):
            return 2
        if all(w in n for w in words):
            return 3
        return None
    hits = [(rank(r), len(r["symbol"]), r) for r in rows if rank(r) is not None]
    if not hits:
        # nothing matched exactly: fall back to the closest names by edit similarity
        import difflib
        sim = lambda x, y: difflib.SequenceMatcher(None, x, y).ratio()  # noqa: E731
        scored = []
        for r in rows:
            by_symbol, by_name = sim(q, r["symbol"]), sim(words[0], r["name"].upper().split()[0])
            if max(by_symbol, by_name) >= 0.78:
                scored.append((-max(by_symbol, by_name), -by_symbol, len(r["symbol"]), r))
        return [r for *_, r in sorted(scored, key=lambda t: t[:3])[:5]]
    return [r for _, _, r in sorted(hits, key=lambda t: (t[0], t[1]))[:8]]


def base(symbol: str) -> dict:
    symbol = symbol.upper().strip()
    co = screener.company(symbol)
    if not co:
        return {"ok": False, "symbol": symbol, "reason": "No reported statements found for this symbol."}
    f = fundamentals.compute(co)
    calls = [{"id": f"C{i + 1}", "when": c["when"], "url": c["transcript"]} for i, c in enumerate(co["docs"]["concalls"][:N_CALLS])]
    ars = sorted(co["docs"]["annual_reports"], key=lambda a: -a["year"])
    return {"ok": f.get("ok", False), "symbol": symbol, "name": co["name"], "industry": co["industry"],
            "about_source": co["url"], "fundamentals": f, "calls": calls,
            "annual_report": ars[0] if ars else None, "llm": llm.available(),
            "sources": {"FIN": {"label": "Reported statements (screener.in)", "url": co["url"]}}}


def call(name: str, c: dict) -> dict:
    return documents.read_call(name, c["when"], c["url"], c["id"])


def annual(name: str, ar: dict, max_pages: int | None = None) -> dict:
    return documents.read_annual(name, ar["year"], ar["url"], max_pages)


def synth(b: dict, calls: list[dict], ar: dict | None) -> dict:
    return synthesis.synthesise(b["name"], b["fundamentals"], calls, ar)


def build(symbol: str, save: bool = True) -> dict:
    b = base(symbol)
    if not b["ok"]:
        return b
    d = {**b, "generated_at": dt.datetime.now().isoformat(timespec="seconds"), "stages": {}}
    try:
        d["call_extracts"] = [call(b["name"], c) for c in b["calls"]]
        d["annual"] = annual(b["name"], b["annual_report"]) if b["annual_report"] else None
        d["analysis"] = synth(b, d["call_extracts"], d["annual"])
        d["stages"]["documents"] = "ok"
    except llm.Unavailable as e:
        d["stages"]["documents"] = f"skipped: {e}"
    for c in d.get("call_extracts", []):
        d["sources"][c["id"]] = {"label": f"Earnings call, {c['when']}", "url": c["url"]}
    if d.get("annual") and d["annual"].get("ok"):
        d["sources"]["AR"] = {"label": f"Annual report {d['annual']['year']}", "url": d["annual"]["url"]}
    d["usage"] = dict(llm.usage)
    if save:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"{b['symbol']}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":"), default=str))
        index = sorted(p.stem for p in OUT.glob("*.json") if p.stem != "index")
        names = {}
        for s in index:
            try:
                names[s] = json.loads((OUT / f"{s}.json").read_text())["name"]
            except Exception:
                names[s] = s
        (OUT / "index.json").write_text(json.dumps([{"symbol": s, "name": names[s]} for s in index]))
    return d


if __name__ == "__main__":
    import sys
    for s in sys.argv[1:]:
        d = build(s)
        print(s, d.get("stages"), {k: v for k, v in llm.usage.items() if k != "by_tier"})
