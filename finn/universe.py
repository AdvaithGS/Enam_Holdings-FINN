"""What every NIFTY 500 company does, in its own words and numbers. For theme search.

For each constituent:
  segments   reported segment names with their share of segment revenue (results XBRL)
  about      the company description and industry path on its screener page
  industry   the exchange's industry label (NIFTY 500 constituent file)

Ask matches a theme against these fields on the phone and ranks companies by the revenue
share of the matching segment, so "adhesives" finds the company whose business that is
rather than every company that mentions the word.

Built occasionally (python -m finn.universe): about 1,500 polite requests, all cached.
"""
from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

from . import http, results
from .sources import nse, screener

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "universe.json"


def build(log=print) -> list[dict]:
    text = http.get_text(f"{nse.ARCHIVE}/content/indices/ind_nifty500list.csv", ttl=7 * 86400)
    rows = list(csv.DictReader(io.StringIO(text)))
    out = []
    for n, r in enumerate(rows, 1):
        sym = r["Symbol"].strip()
        item = {"s": sym, "n": r["Company Name"].strip(), "i": r.get("Industry", "").strip(), "a": "", "p": [], "g": []}
        try:
            html = None
            for path in (f"/company/{sym}/consolidated/", f"/company/{sym}/"):
                try:
                    html = http.get_text(screener.BASE + path, ttl=14 * 86400, retries=1)
                    break
                except http.FetchError:
                    continue
            if html:
                soup = BeautifulSoup(html, "lxml")
                about = soup.select_one(".company-profile .about")
                item["a"] = re.sub(r"\s+", " ", re.sub(r"\[\d+\]", "", about.get_text(" ", strip=True)))[:420] if about else ""
                box = soup.select_one("#peers")
                item["p"] = [a.get_text(strip=True) for a in box.select("a[href^='/market/']")][-2:] if box else []
        except Exception as ex:
            log(f"  ! about {sym}: {ex!r}")
        try:
            item["g"] = [[x["name"], round(x["share"], 3)] for x in results.segments(sym) if x["share"] >= 0.02][:8]
        except Exception as ex:
            log(f"  ! segments {sym}: {ex!r}")
        out.append(item)
        if n % 50 == 0:
            log(f"  {n}/{len(rows)}")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    log(f"universe: {len(out)} companies, {sum(1 for x in out if x['g'])} with segments, {sum(1 for x in out if x['a'])} with a description")
    return out


if __name__ == "__main__":
    build()
