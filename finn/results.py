"""Quarterly results from the company's own XBRL filing. No model reads a number.

Every listed company files its results with the exchange as an XBRL instance: each
line of the P&L is a tagged fact with an exact value. We read the facts for the
single-quarter context, define the four headline numbers from them, and check the
statement's own accounting identities before trusting anything.

Definitions (rupees; shown in crore)
  Companies      Revenue = RevenueFromOperations
                 EBITDA  = PBT before exceptional items + finance costs
                           + depreciation & amortisation - other income
                 PBT     = ProfitBeforeTax        PAT = ProfitLossForPeriod
  Lenders (NBFC) Finance cost is their raw material, so EBITDA is meaningless.
                 We show pre-provision operating profit instead:
                 PPOP    = PBT before exceptional items + impairment on financial instruments
                 NII     = interest earned - finance costs
  Banks          Revenue = total income, NII = interest earned - interest expended,
                 PPOP    = operating profit before provisions and contingencies (as filed)

Identities checked (tolerance: 0.5 of the filing's own rounding unit per term)
  I1  Income = Revenue + Other income
  I2  PBT before exceptionals = Income - Expenses
  I3  PBT = PBT before exceptionals + exceptional items
  I4  Profit from continuing operations = PBT - tax
A failed identity means the filing is internally inconsistent or uses a layout we
do not model; the card says so instead of showing a confident number.
"""
from __future__ import annotations

import datetime as dt
import re

from . import http
from .sources import nse

CRORE = 1e7
_FACT = re.compile(r"<(?:[\w-]+):(\w+)\s([^>]*?)>([^<]*)</", re.S)
_CTX = re.compile(r'<xbrli:context id="([^"]+)">(.*?)</xbrli:context>', re.S)
_ROUND = {"crores": 1e7, "lakhs": 1e5, "millions": 1e6, "thousands": 1e3, "billions": 1e9,
          "actual": 1.0, "hundreds": 1e2}


def parse_xbrl(xml: str) -> dict:
    """Facts of the single-quarter context of one results filing."""
    periods = {}
    for cid, body in _CTX.findall(xml):
        if "segment" in body or "scenario" in body:
            continue
        s = re.search(r"<xbrli:startDate>([^<]+)", body)
        e = re.search(r"<xbrli:endDate>([^<]+)", body)
        if s and e:
            periods[cid] = (dt.date.fromisoformat(s.group(1).strip()), dt.date.fromisoformat(e.group(1).strip()))
    if not periods:
        raise ValueError("no duration context")
    # the quarter is the shortest duration that ends on the latest date
    last = max(e for _, e in periods.values())
    cid = min((c for c, (s, e) in periods.items() if e == last), key=lambda c: (periods[c][1] - periods[c][0]).days)
    start, end = periods[cid]
    if not 80 <= (end - start).days <= 100:
        raise ValueError(f"shortest context is {(end - start).days} days, not a quarter")
    num, txt = {}, {}
    for name, attrs, val in _FACT.findall(xml):
        m = re.search(r'contextRef="([^"]+)"', attrs)
        if not m or m.group(1) != cid:
            continue
        val = val.strip()
        try:
            num.setdefault(name, float(val))
        except ValueError:
            txt.setdefault(name, val)
    unit = _ROUND.get(txt.get("LevelOfRoundingUsedInFinancialStatements", "").lower(), 1e5)
    return {"start": start, "end": end, "num": num, "txt": txt, "unit": unit}


def _g(n: dict, *names: str) -> float | None:
    for k in names:
        if k in n:
            return n[k]
    return None


def headline(f: dict) -> dict:
    """Headline lines + identity checks for one parsed filing. Values in rupees."""
    n, tol = f["num"], f["unit"] * 0.5
    checks = []

    def check(code: str, lhs: float | None, *terms: float | None, label: str):
        if lhs is None or any(t is None for t in terms):
            return
        gap = abs(lhs - sum(terms))
        checks.append({"id": code, "label": label, "ok": gap <= tol * (len(terms) + 1), "gap": gap})

    if "InterestExpended" in n:  # banking layout
        kind = "bank"
        income = _g(n, "Income")
        pbt = _g(n, "ProfitLossFromOrdinaryActivitiesBeforeTax")
        pat = _g(n, "ProfitLossForThePeriod")
        ppop = _g(n, "OperatingProfitBeforeProvisionAndContingencies")
        lines = {"revenue": income, "nii": n["InterestEarned"] - n.get("InterestExpended", 0.0),
                 "ppop": ppop, "pbt": pbt, "pat": pat}
        check("I1", income, n.get("InterestEarned"), n.get("OtherIncome"), label="Income = interest earned + other income")
        check("I2", ppop, income, -_g(n, "ExpenditureExcludingProvisionsAndContingencies") if _g(n, "ExpenditureExcludingProvisionsAndContingencies") is not None else None,
              label="Operating profit = income - expenditure")
        check("I3", pbt, ppop, -(n.get("ProvisionsOtherThanTaxAndContingencies") or 0.0), n.get("ExceptionalItems") or 0.0,
              label="PBT = operating profit - provisions + exceptional items")
        check("I4", _g(n, "ProfitLossFromOrdinaryActivitiesAfterTax"), pbt, -n["TaxExpense"] if "TaxExpense" in n else None,
              label="Profit after tax = PBT - tax")
        owners = _g(n, "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates")
    else:
        rev, other, income = _g(n, "RevenueFromOperations"), _g(n, "OtherIncome"), _g(n, "Income")
        pbt_be = _g(n, "ProfitBeforeExceptionalItemsAndTax")
        pbt = _g(n, "ProfitBeforeTax")
        pat = _g(n, "ProfitLossForPeriod")
        fin = _g(n, "FinanceCosts")
        dep = _g(n, "DepreciationDepletionAndAmortisationExpense")
        impair = _g(n, "ImpairmentOnFinancialInstruments")
        interest = _g(n, "InterestEarned", "InterestIncome")
        lender = impair is not None or interest is not None
        kind = "lender" if lender else "company"
        lines = {"revenue": rev, "pbt": pbt, "pat": pat}
        if lender:
            lines["ppop"] = pbt_be + (impair or 0.0) if pbt_be is not None else None
            lines["nii"] = interest - fin if interest is not None and fin is not None else None
        elif None not in (pbt_be, fin, dep, other):
            lines["ebitda"] = pbt_be + fin + dep - other
        check("I1", income, rev, other, label="Income = revenue + other income")
        check("I2", pbt_be, income, -n["Expenses"] if "Expenses" in n else None, label="PBT before exceptionals = income - expenses")
        check("I3", pbt, pbt_be, n.get("ExceptionalItemsBeforeTax", 0.0), label="PBT = PBT before exceptionals + exceptional items")
        check("I4", _g(n, "ProfitLossForPeriodFromContinuingOperations"), pbt, -n["TaxExpense"] if "TaxExpense" in n else None,
              label="Profit from continuing operations = PBT - tax")
        owners = _g(n, "ProfitOrLossAttributableToOwnersOfParent")
    exceptional = _g(n, "ExceptionalItemsBeforeTax", "ExceptionalItems") or 0.0
    return {"kind": kind, "lines": {k: v for k, v in lines.items() if v is not None},
            "owners_pat": owners, "exceptional": exceptional, "checks": checks,
            "eps": _g(n, "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
                      "BasicEarningsPerShareAfterExtraordinaryItems")}


def _load(entry: dict) -> dict | None:
    try:
        f = parse_xbrl(http.get_text(entry["xbrl"]))
    except (http.FetchError, ValueError):
        return None
    h = headline(f)
    h.update(start=f["start"], end=f["end"], filed=entry["filed"], source=entry["xbrl"],
             consolidated=entry["consolidated"], audited=entry["audited"])
    return h


def _shift(end: dt.date, months: int) -> dt.date:
    """Quarter-end `months` earlier (quarter ends are month ends)."""
    y, m = end.year, end.month - months
    while m <= 0:
        y, m = y - 1, m + 12
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - dt.timedelta(days=1)


def _pct(a: float | None, b: float | None) -> float | None:
    """Growth of a over b. Undefined when the base is not positive (a loss has no growth rate)."""
    if a is None or b is None or b <= 0:
        return None
    return a / b - 1


LABELS = {"revenue": "Revenue", "ebitda": "EBITDA", "nii": "Net interest income",
          "ppop": "Pre-provision profit", "pbt": "PBT", "pat": "PAT"}
ORDER = ["revenue", "nii", "ebitda", "ppop", "pbt", "pat"]


def card(symbol: str, period_end: dt.date | None = None) -> dict | None:
    """Headline numbers for the latest (or given) quarter, vs last quarter and last year.

    Consolidated figures when the company files them, else standalone; the three
    quarters compared always use the same basis. Each comes from that quarter's own
    filing, so comparatives are as originally reported, not as later restated.
    """
    idx = nse.results_index(symbol)
    if not idx:
        return None
    period_end = period_end or idx[0]["period_end"]
    basis = any(e["consolidated"] for e in idx if e["period_end"] == period_end)

    def pick(end: dt.date) -> dict | None:
        for e in idx:  # newest filing first, so a revised filing wins
            if e["period_end"] == end and e["consolidated"] == basis:
                got = _load(e)
                if got and got["end"] == end:
                    return got
        return None

    cur = pick(period_end)
    if not cur:
        return None
    prev, year = pick(_shift(period_end, 3)), pick(_shift(period_end, 12))
    rows = []
    for k in ORDER:
        if k not in cur["lines"]:
            continue
        v = cur["lines"][k]
        q = prev["lines"].get(k) if prev else None
        y = year["lines"].get(k) if year else None
        row = {"key": k, "label": LABELS[k], "value": v / CRORE,
               "prev": None if q is None else q / CRORE, "year": None if y is None else y / CRORE,
               "qoq": _pct(v, q), "yoy": _pct(v, y)}
        rev = cur["lines"].get("revenue")
        if k in ("ebitda", "ppop", "pat") and rev:
            row["margin"] = v / rev
            for tag, other in (("margin_prev", prev), ("margin_year", year)):
                if other and other["lines"].get(k) is not None and other["lines"].get("revenue"):
                    row[tag] = other["lines"][k] / other["lines"]["revenue"]
        rows.append(row)
    notes = []
    if cur["exceptional"]:
        notes.append(f"Includes exceptional items of ₹{cur['exceptional'] / CRORE:,.0f} cr before tax.")
    if cur["owners_pat"] and cur["lines"].get("pat") and abs(cur["owners_pat"] - cur["lines"]["pat"]) > cur["lines"]["pat"] * 0.005:
        notes.append(f"Of PAT, ₹{cur['owners_pat'] / CRORE:,.0f} cr belongs to the company's shareholders; the rest to minority holders.")
    fy = period_end.year + (period_end.month > 3)
    qn = {6: 1, 9: 2, 12: 3, 3: 4}.get(period_end.month)
    return {"symbol": symbol, "period": f"Q{qn} FY{fy % 100:02d}" if qn else period_end.isoformat(),
            "period_end": period_end.isoformat(), "kind": cur["kind"],
            "basis": "consolidated" if basis else "standalone", "audited": cur["audited"],
            "rows": rows, "notes": notes, "eps": cur["eps"],
            "checks": cur["checks"], "checks_ok": all(c["ok"] for c in cur["checks"]) and len(cur["checks"]) >= 3,
            "filed": cur["filed"], "source": cur["source"],
            "sources": {"prev": prev and prev["source"], "year": year and year["source"]}}
