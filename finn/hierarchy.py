"""Subsidiaries of each holding, read from its annual report. No model.

Companies must list every subsidiary, associate and joint venture in the annual report
(Form AOC-1 and the related-party and consolidation notes). Those pages are found by
their own wording; legal-entity names are then recognised by form: a run of capitalised
words ending in a legal suffix (Limited, LLC, B.V., Pte. Ltd., Inc., GmbH ...).

  page is a listing page  if it says "subsidiar" at least MIN_HITS times or carries the
                          AOC-1 heading, and holds at least MIN_NAMES entity names
  a name is kept          if it has at least two distinctive words, is not the company
                          itself, not a third party (auditors, registrars, lenders),
                          not itself listed on NSE (a listed company is its own node:
                          Trent is not a subsidiary of Titan because both are Tata), and
                          either carries the group's own name or sits on a statutory
                          subsidiary-statement page (AOC-1)

The result is an alias table, child name -> parent symbol, shipped to the phone so that
"Jio Platforms Limited" in a filing, or on a contact's CV, resolves to Reliance.
It over-collects by design in one direction only: associates and joint ventures are
included with subsidiaries, because for "who do I know there" they are the same lead.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import docs
from .sources import screener

MIN_HITS, MIN_NAMES = 4, 6
AOC = re.compile(r"AOC[\s-]*1|Part\s*[\"“]?A[\"”]?\s*:?\s*Subsidiar|salient features of.{0,60}subsidiar|list of subsidiar|details of subsidiar", re.I | re.S)
WEAK = set("limited ltd private pvt india international holdings holding services technologies technology ventures trading company global "
           "solutions industries enterprises llc inc pte of and the for de usa uk".split())
SUFFIX = r"(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?|LLC|L\.L\.C\.?|LLP|Inc\.?|Corp\.?|Corporation|B\.V\.|N\.V\.|GmbH|S\.A\.|S\.A\.S\.|S\.r\.l\.|S\.à r\.l\.|Pte\.? Ltd\.?|PLC|plc|AG|Sdn\.? Bhd\.?|FZE|FZCO|FZ-LLC|Co\.,? Ltd\.?|Pty\.? Ltd\.?|K\.K\.|SARL|S\.P\.A\.|Oy|AB|ApS|A/S)"
NAME = re.compile(r"(?<![A-Za-z])((?:[A-Z0-9][A-Za-z0-9&'’.\-]*|of|and|de|for|the|&)(?:[ \t]+(?:[A-Z0-9(][A-Za-z0-9&'’.()\-]*|of|and|de|for|the|&)){0,8}?[ \t]+" + SUFFIX + r")(?![A-Za-z])")
THIRD = re.compile(r"chartered accountants|\bllp$|registrar|kfin|link intime|depositor|stock exchange|\bnse\b|\bbse\b|crisil|icra|care ratings|india ratings|"
                   r"state bank|\bbank\b|insurance|deloitte|price waterhouse|\bs\.? ?r\.? ?b|kpmg|ernst|walker chandiok|mutual fund|trustee|clearing|life insurance corporation", re.I)


def subsidiaries(symbol: str) -> list[str]:
    co = screener.company(symbol)
    ars = sorted((co or {}).get("docs", {}).get("annual_reports", []), key=lambda a: -a["year"])
    if not ars:
        return []
    from .sources import nse
    own = re.sub(r"\b(limited|ltd\.?)$", "", (co["name"] or "").strip(), flags=re.I).strip().lower()
    brand = own.split()[0]
    key = lambda n: re.sub(r"[^a-z0-9]+", " ", re.sub(r"(?i)\b(limited|ltd)\b\.?", "", n).lower()).strip()  # noqa: E731
    listed = {key(r["name"]) for r in nse.equities()}
    found: dict[str, int] = {}
    for page in docs.fetch_pages(ars[0]["url"], ocr_limit=0):
        if len(re.findall(r"subsidiar", page, re.I)) < MIN_HITS and not re.search(r"AOC[\s-]*1", page):
            continue
        names = {re.sub(r"\s+", " ", m).strip(" .,") for m in NAME.findall(page)}
        names = {n for n in names if 2 <= len(n.split()) <= 9 and not THIRD.search(n) and not n.lower().startswith(own) and not re.match(r"(?i)(the|of|and|for)\b", n)}
        statutory = bool(AOC.search(page))
        if len(names) >= MIN_NAMES:
            for n in names:
                strong = [w for w in re.findall(r"[A-Za-z]{2,}", n) if w.lower() not in WEAK]
                if len(strong) < 2 and not (len(strong) == 1 and len(strong[0]) >= 6):
                    continue   # "Services Limited": a fragment of a name broken across a table cell
                if re.match(r"(?i)subsidiar", n) or re.search(r"\b\d{2,}\b", n) or key(n) in listed:
                    continue
                if statutory or brand in n.lower():
                    found[n] = found.get(n, 0) + 1
    return sorted(found, key=lambda n: (-found[n], n))


def build(symbols: list[str], log=print) -> dict:
    out = {}
    for s in symbols:
        try:
            out[s] = subsidiaries(s)
        except Exception as ex:
            out[s] = []
            log(f"  ! hierarchy {s}: {ex!r}")
        log(f"  {s}: {len(out[s])} group entities")
    path = Path(__file__).resolve().parent.parent / "public" / "data" / "hierarchy.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return out


if __name__ == "__main__":
    import sys
    cfg = json.loads((Path(__file__).resolve().parent.parent / "data" / "portfolio.json").read_text())
    build(sys.argv[1:] or [p["symbol"] for p in cfg["portfolio"]])
