"""screener.in: standardised multi-year statements and links to primary documents.

Used for two things only: the reported statement lines (as numbers) and the URLs of
annual reports and concall transcripts. Screener's own derived ratios are ignored;
ours are computed from the statement lines in research/fundamentals.py.
"""
from __future__ import annotations

import re
import urllib.parse

from bs4 import BeautifulSoup

from .. import http

BASE = "https://www.screener.in"
DAY = 86400.0


def search(query: str) -> list[dict]:
    q = urllib.parse.quote(query)
    rows = http.get_json(f"{BASE}/api/company/search/?q={q}", ttl=7 * DAY)
    out = []
    for r in rows:
        m = re.match(r"/company/([^/]+)/", r.get("url") or "")
        if m:
            out.append({"symbol": m.group(1), "name": r["name"]})
    return out


def _num(s: str) -> float | None:
    s = s.replace(",", "").replace("%", "").replace("₹", "").replace("Cr.", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _table(soup: BeautifulSoup, section: str) -> dict:
    t = soup.select_one(f"#{section} table")
    if not t:
        return {"periods": [], "rows": {}}
    periods = [th.get_text(strip=True) for th in t.select("thead th")][1:]
    rows = {}
    for tr in t.select("tbody tr"):
        tds = [td.get_text(" ", strip=True) for td in tr.select("td")]
        if not tds:
            continue
        name = tds[0].replace("+", "").strip()
        rows[name] = [_num(x) for x in tds[1:]]
    return {"periods": periods, "rows": rows}


def _schedule(company_id: str, parent: str, section: str, consolidated: bool) -> dict:
    q = urllib.parse.urlencode({"parent": parent, "section": section,
                                "consolidated": "true" if consolidated else ""})
    try:
        data = http.get_json(f"{BASE}/api/company/{company_id}/schedules/?{q}", ttl=DAY)
    except http.FetchError:
        return {}
    return {k: {p: _num(str(v)) for p, v in row.items() if isinstance(v, (str, int, float))}
            for k, row in data.items() if isinstance(row, dict)}


def peers(symbol: str) -> tuple[str | None, list[str]]:
    """Companies screener lists in the same basic industry (the exchange's industry classification)."""
    for path in (f"/company/{symbol}/consolidated/", f"/company/{symbol}/"):
        try:
            soup = BeautifulSoup(http.get_text(BASE + path, ttl=DAY), "lxml")
        except http.FetchError:
            continue
        info = soup.find(id="company-info")
        wid = info.get("data-warehouse-id") if info else None
        if not wid:
            continue
        box = soup.select_one("#peers")
        industry = [a.get_text(strip=True) for a in box.select("a[href^='/market/']")] if box else []
        try:
            table = BeautifulSoup(http.get_text(f"{BASE}/api/company/{wid}/peers/", ttl=7 * DAY), "lxml")
        except http.FetchError:
            return (industry[-1] if industry else None), []
        out = []
        for a in table.select("a[href^='/company/']"):
            m = re.match(r"/company/([^/]+)/", a["href"])
            if m and m.group(1) != symbol and not m.group(1).isdigit():
                out.append(m.group(1))
        return (industry[-1] if industry else None), out
    return None, []


def company(symbol: str, ttl: float = DAY) -> dict | None:
    """Statements + document links for one company. Consolidated when available."""
    html, consolidated = None, True
    for path, cons in ((f"/company/{symbol}/consolidated/", True), (f"/company/{symbol}/", False)):
        try:
            html = http.get_text(BASE + path, ttl=ttl)
        except http.FetchError:
            continue
        soup = BeautifulSoup(html, "lxml")
        pl = _table(soup, "profit-loss")
        if pl["rows"].get("Sales") or pl["rows"].get("Revenue"):
            consolidated = cons
            break
        html = None
    if html is None:
        return None
    info = soup.find(id="company-info")
    cid = info.get("data-company-id") if info else None
    top = {}
    for li in soup.select("#top-ratios li"):
        name = li.select_one(".name")
        val = li.select_one(".number")
        if name and val:
            top[name.get_text(strip=True)] = _num(val.get_text(strip=True))
    docs = {"annual_reports": [], "concalls": []}
    box = soup.find(id="documents")
    if box:
        for sec in box.select(".documents"):
            title = sec.h3.get_text(strip=True).lower() if sec.h3 else ""
            for li in sec.select("li"):
                if "annual" in title:
                    a = li.find("a")
                    m = re.search(r"(20\d\d)", a.get_text(" ", strip=True)) if a else None
                    if a and m:
                        docs["annual_reports"].append({"year": int(m.group(1)), "url": a["href"]})
                elif "concall" in title:
                    when = li.find(class_=re.compile("ink-600|font-size-15")) or li
                    label = " ".join(when.get_text(" ", strip=True).split()[:2])
                    links = {a.get_text(strip=True).lower(): a["href"] for a in li.find_all("a") if a.get("href")}
                    if links.get("transcript"):
                        docs["concalls"].append({"when": label, "transcript": links["transcript"],
                                                 "ppt": links.get("ppt")})
    peers = soup.select_one("#peers")
    industry = [a.get_text(strip=True) for a in peers.select("a[href^='/market/']")] if peers else []
    about = soup.select_one(".company-profile .about")
    out = {
        "symbol": symbol, "name": soup.h1.get_text(strip=True) if soup.h1 else symbol,
        "consolidated": consolidated, "url": BASE + (f"/company/{symbol}/consolidated/" if consolidated else f"/company/{symbol}/"),
        "market_cap": top.get("Market Cap"), "price": top.get("Current Price"),
        "industry": industry, "about": about.get_text(" ", strip=True) if about else None,
        "quarters": _table(soup, "quarters"), "pl": _table(soup, "profit-loss"),
        "bs": _table(soup, "balance-sheet"), "cf": _table(soup, "cash-flow"),
        "shareholding": _table(soup, "shareholding"), "docs": docs, "schedules": {},
    }
    if cid:
        for parent in ("Other Assets", "Other Liabilities", "Borrowings"):
            out["schedules"][parent] = _schedule(cid, parent, "balance-sheet", consolidated)
        # cost lines as a share of sales: the only place the statement splits "Expenses"
        out["schedules"]["Expenses"] = _schedule(cid, "Expenses", "profit-loss", consolidated)
    return out
