"""Fundamentals computed in code from reported statement lines.

Input: screener's standardised statements (numbers as reported, rupees crore).
Output: every metric with the formula that produced it, so the UI can show its
working and nothing here depends on a model.

Conventions
  FY columns are "Mar 2026" style; TTM is the trailing twelve months.
  A ratio over a balance-sheet item uses the average of opening and closing
  balances when both exist (a flow should be compared with the stock that earned it).
  Cumulative ratios (cash conversion) sum numerator and denominator over the window
  first, then divide: one lumpy year cannot swing the answer.

Working capital. Each balance is divided by the flow it turns over against:
    receivable days = 365 x average receivables / revenue
    inventory days  = 365 x average inventory   / cost of goods sold
    payable days    = 365 x average payables    / cost of goods sold
    cycle           = receivable + inventory - payable
  Cost of goods sold = revenue x (material cost % + manufacturing cost %), the two
  product-cost lines of the expense schedule. That schedule is published in whole
  percentage points, so COGS carries a rounding error of up to half a point of sales
  (under 1% of COGS for a manufacturer). Where a company reports no product cost of
  at least COGS_MIN of sales (services, platforms), there is no cost of goods to turn
  inventory against and all three use revenue; the row says which basis it used.
"""
from __future__ import annotations

from ..stats import cagr

COGS_MIN = 0.10   # product cost below this share of revenue: not a goods business


def _series(table: dict, *names: str) -> dict[str, float]:
    for n in names:
        row = table["rows"].get(n)
        if row:
            return {p: v for p, v in zip(table["periods"], row) if v is not None}
    return {}


def _fy(d: dict[str, float]) -> list[str]:
    return sorted((p for p in d if p != "TTM" and p[:3] == "Mar"), key=lambda p: int(p[-4:]))


def _avg(d: dict[str, float], p: str) -> float | None:
    prev = f"{p[:4]}{int(p[-4:]) - 1}"
    if p not in d:
        return None
    return (d[p] + d[prev]) / 2 if prev in d else d[p]


def _div(a, b):
    return None if a is None or b in (None, 0) else a / b


def compute(co: dict) -> dict:
    pl, bs, cf, q = co["pl"], co["bs"], co["cf"], co["quarters"]
    lender = "Financing Profit" in pl["rows"] or "Revenue" in pl["rows"] and "Sales" not in pl["rows"]
    sales = _series(pl, "Sales", "Revenue")
    op = _series(pl, "Operating Profit", "Financing Profit")
    other, interest, dep = _series(pl, "Other Income"), _series(pl, "Interest"), _series(pl, "Depreciation")
    pbt, pat = _series(pl, "Profit before tax"), _series(pl, "Net Profit")
    eq, res = _series(bs, "Equity Capital"), _series(bs, "Reserves")
    debt = _series(bs, "Borrowings", "Borrowing")
    assets = _series(bs, "Total Assets")
    cfo, fcf = _series(cf, "Cash from Operating Activity"), _series(cf, "Free Cash Flow")
    sch = co.get("schedules", {})
    oa, ol = sch.get("Other Assets", {}), sch.get("Other Liabilities", {})
    recv, inv, cash = oa.get("Trade receivables", {}), oa.get("Inventories", {}), oa.get("Cash Equivalents", {})
    pay = ol.get("Trade Payables", {})
    ex = sch.get("Expenses", {})
    mat, mfg = ex.get("Material Cost %", {}), ex.get("Manufacturing Cost %", {})

    def cogs_of(y: str) -> float | None:
        share = ((mat.get(y) or 0.0) + (mfg.get(y) or 0.0)) / 100
        return sales[y] * share if y in sales and share >= COGS_MIN else None
    nw = {p: eq[p] + res[p] for p in eq if p in res}
    years = _fy(sales)
    if len(years) < 2:
        return {"lender": lender, "years": years, "ok": False}
    last = years[-1]

    def growth(d: dict, n: int):
        ys = [y for y in years if y in d]
        if len(ys) <= n:
            return None
        return cagr(d[ys[-1 - n]], d[ys[-1]], n)

    # one basis per company, so the trend is not an artefact of switching denominators
    on_cost = not lender and cogs_of(last) is not None
    annual = []
    for y in years[-10:]:
        ebit = None if y not in pbt else pbt[y] + interest.get(y, 0.0)
        cap = None if _avg(nw, y) is None else _avg(nw, y) + (_avg(debt, y) or 0.0)
        row = {"fy": "FY" + y[-2:], "period": y, "revenue": sales.get(y), "op_profit": op.get(y), "pat": pat.get(y),
               "opm": _div(op.get(y), sales.get(y)), "npm": _div(pat.get(y), sales.get(y)),
               "cfo": cfo.get(y), "fcf": fcf.get(y), "debt": debt.get(y), "net_worth": nw.get(y),
               "de": _div(debt.get(y), nw.get(y)), "roe": _div(pat.get(y), _avg(nw, y)),
               "roce": None if lender else _div(ebit, cap), "roa": _div(pat.get(y), _avg(assets, y)) if lender else None,
               "cash": cash.get(y)}
        if not lender:
            cg = cogs_of(y) if on_cost else sales.get(y)
            row["cogs"] = cogs_of(y)
            row["days_basis"] = "cost" if on_cost else "revenue"
            row["debtor_days"] = None if _div(_avg(recv, y), sales.get(y)) is None else 365 * _avg(recv, y) / sales[y]
            row["inventory_days"] = None if _div(_avg(inv, y), cg) is None else 365 * _avg(inv, y) / cg
            row["payable_days"] = None if _div(_avg(pay, y), cg) is None else 365 * _avg(pay, y) / cg
            parts = [row["debtor_days"], row["inventory_days"], row["payable_days"]]
            row["cycle_days"] = None if parts[0] is None and parts[1] is None else (parts[0] or 0) + (parts[1] or 0) - (parts[2] or 0)
            ebitda = None if y not in op else op[y]
            nd = None if y not in debt else debt[y] - cash.get(y, 0.0)
            row["net_debt"] = nd
            row["net_debt_ebitda"] = _div(nd, ebitda) if ebitda and ebitda > 0 else None
        annual.append(row)

    def cum(num: dict, den: dict, n: int):
        ys = [y for y in years[-n:] if y in num and y in den]
        if len(ys) < n:
            return None
        d = sum(den[y] for y in ys)
        return sum(num[y] for y in ys) / d if d > 0 else None

    qs, qp = _series(q, "Sales", "Revenue"), _series(q, "Net Profit")
    qo = _series(q, "Operating Profit", "Financing Profit")
    quarters = []
    periods = q["periods"]
    for i, p in enumerate(periods):
        prev_year = periods[i - 4] if i >= 4 else None
        quarters.append({"period": p, "revenue": qs.get(p), "op_profit": qo.get(p), "pat": qp.get(p),
                         "opm": _div(qo.get(p), qs.get(p)),
                         "revenue_yoy": None if not prev_year or not qs.get(prev_year) or qs.get(p) is None else qs[p] / qs[prev_year] - 1,
                         "pat_yoy": None if not prev_year or not qp.get(prev_year) or qp.get(p) is None or qp[prev_year] <= 0 else qp[p] / qp[prev_year] - 1})
    sh = co["shareholding"]
    prom = _series(sh, "Promoters")
    prom_p = [p for p in sh["periods"] if p in prom]
    a = annual[-1]
    prev3 = annual[-4] if len(annual) >= 4 else None
    metrics = {
        "revenue_ttm": sales.get("TTM", sales[last]), "pat_ttm": pat.get("TTM", pat.get(last)),
        "opm_ttm": _div(op.get("TTM", op.get(last)), sales.get("TTM", sales[last])),
        "revenue_cagr_3y": growth(sales, 3), "revenue_cagr_5y": growth(sales, 5),
        "pat_cagr_3y": growth(pat, 3), "pat_cagr_5y": growth(pat, 5),
        "opm_change_3y": None if not prev3 or a["opm"] is None or prev3["opm"] is None else a["opm"] - prev3["opm"],
        "roe": a["roe"], "roce": a["roce"], "roa": a["roa"], "de": a["de"],
        "cash_conversion_3y": None if lender else cum(cfo, pat, 3),
        "cash_conversion_5y": None if lender else cum(cfo, pat, 5),
        "fcf_3y": None if lender else (sum(fcf[y] for y in years[-3:] if y in fcf) if all(y in fcf for y in years[-3:]) else None),
        "cycle_days": a.get("cycle_days"),
        "cycle_change_3y": None if lender or not prev3 or a.get("cycle_days") is None or prev3.get("cycle_days") is None else a["cycle_days"] - prev3["cycle_days"],
        "net_debt_ebitda": a.get("net_debt_ebitda"),
        "promoter": prom.get(prom_p[-1]) if prom_p else None,
        "promoter_change": prom[prom_p[-1]] - prom[prom_p[0]] if len(prom_p) > 1 else None,
        "promoter_span": f"{prom_p[0]} to {prom_p[-1]}" if len(prom_p) > 1 else None,
        "mcap": co.get("market_cap"),
        "pe": _div(co.get("market_cap"), pat.get("TTM", pat.get(last))) if (pat.get("TTM", pat.get(last)) or 0) > 0 else None,
    }
    formulas = {
        "opm": "operating profit / revenue",
        "revenue_cagr_3y": "(revenue FY_n / revenue FY_n-3)^(1/3) - 1",
        "roe": "PAT / average net worth (equity capital + reserves)",
        "roce": "(PBT + interest) / average (net worth + borrowings)",
        "roa": "PAT / average total assets",
        "de": "borrowings / net worth, year end",
        "cash_conversion_3y": "sum of cash from operations over 3 years / sum of PAT over 3 years",
        "debtor_days": "365 x average trade receivables / revenue",
        "cogs": "revenue x (material cost % + manufacturing cost %)",
        "inventory_days": "365 x average inventory / cost of goods sold" if on_cost else "365 x average inventory / revenue",
        "payable_days": "365 x average trade payables / cost of goods sold" if on_cost else "365 x average trade payables / revenue",
        "cycle_days": "receivable days + inventory days - payable days",
        "net_debt_ebitda": "(borrowings - cash) / operating profit",
        "pe": "market value / trailing twelve-month PAT",
    }
    return {"ok": True, "lender": lender, "last_fy": "FY" + last[-2:], "annual": annual, "quarters": quarters[-9:],
            "metrics": metrics, "formulas": formulas,
            "days_basis": "cost" if on_cost else "revenue", "basis": "consolidated" if co["consolidated"] else "standalone"}
