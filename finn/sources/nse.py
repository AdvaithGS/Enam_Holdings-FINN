"""NSE: the exchange's own public endpoints.

- corporate announcements (the raw feed Push watches)
- integrated-filing financial results in XBRL (machine-readable P&L)
- the daily bhavcopy (official end-of-day price and volume for every stock)
- the list of listed equities (so research works on any NSE symbol)
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import urllib.parse
import zipfile

from .. import http

API = "https://www.nseindia.com/api"
ARCHIVE = "https://nsearchives.nseindia.com"
HOUR = 3600.0


def _d(s: str) -> dt.datetime:
    return dt.datetime.strptime(s, "%d-%b-%Y %H:%M:%S")


def announcements(symbol: str, start: dt.date, end: dt.date, ttl: float = HOUR) -> list[dict]:
    """Filings for one symbol in [start, end], newest first."""
    q = urllib.parse.urlencode({"index": "equities", "symbol": symbol,
                                "from_date": start.strftime("%d-%m-%Y"),
                                "to_date": end.strftime("%d-%m-%Y")})
    rows = http.get_json(f"{API}/corporate-announcements?{q}", ttl=ttl)
    out = []
    for r in rows:
        when = _d(r["an_dt"])
        out.append({
            "id": str(r["seq_id"]),
            "symbol": r["symbol"],
            "company": r["sm_name"],
            "at": when.isoformat(),
            "subject": (r.get("desc") or "").strip(),
            "text": " ".join((r.get("attchmntText") or "").split()),
            "url": r.get("attchmntFile") or None,
            "industry": r.get("smIndustry"),
        })
    out.sort(key=lambda x: x["at"], reverse=True)
    return out


def results_index(symbol: str, ttl: float = HOUR) -> list[dict]:
    """Every quarterly results filing we can find for a symbol, newest first.

    Results moved to the "integrated filing" format in 2025; older quarters sit
    behind the previous endpoint. Both carry a link to the XBRL instance.
    """
    out = []
    q = urllib.parse.urlencode({"index": "equities", "symbol": symbol, "period_ended": "all",
                                "type": "Integrated Filing- Financials", "page": 1, "size": 40})
    try:
        for r in http.get_json(f"{API}/integrated-filing-results?{q}", ttl=ttl).get("data", []):
            filed = r.get("broadcast_Date") or r.get("creation_Date") or r.get("revised_Date")
            if not r.get("xbrl") or not filed or not r.get("qe_Date"):
                continue
            out.append({"period_end": dt.datetime.strptime(r["qe_Date"].title(), "%d-%b-%Y").date(),
                        "consolidated": r["consolidated"].lower().startswith("consol"),
                        "filed": _d(filed).isoformat(), "xbrl": r["xbrl"],
                        "audited": r["audited"].lower().startswith("audited")})
    except http.FetchError:
        pass
    q = urllib.parse.urlencode({"index": "equities", "symbol": symbol, "period": "Quarterly"})
    try:
        for r in http.get_json(f"{API}/corporates-financial-results?{q}", ttl=24 * HOUR):
            if not (r.get("xbrl") and r.get("toDate") and r.get("broadCastDate")) or r.get("cumulative") != "Non-cumulative":
                continue
            out.append({"period_end": dt.datetime.strptime(r["toDate"], "%d-%b-%Y").date(),
                        "consolidated": r["consolidated"] == "Consolidated",
                        "filed": _d(r["broadCastDate"]).isoformat(), "xbrl": r["xbrl"],
                        "audited": r["audited"] == "Audited"})
    except http.FetchError:
        pass
    out.sort(key=lambda x: (x["period_end"], x["filed"]), reverse=True)
    return out


def bhavcopy(day: dt.date) -> dict[str, dict] | None:
    """Official end-of-day data for every EQ-series stock on `day`; None on a holiday."""
    url = f"{ARCHIVE}/content/cm/BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv.zip"
    try:
        raw = http.get(url, retries=1)
    except http.FetchError:
        return None
    z = zipfile.ZipFile(io.BytesIO(raw))
    text = z.read(z.namelist()[0]).decode()
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r["SctySrs"] != "EQ":
            continue
        out[r["TckrSymb"]] = {"close": float(r["ClsPric"]), "prev": float(r["PrvsClsgPric"]),
                              "volume": int(r["TtlTradgVol"]), "value": float(r["TtlTrfVal"]),
                              "isin": r["ISIN"]}
    return out


def equities(ttl: float = 7 * 24 * HOUR) -> list[dict]:
    """All NSE-listed equities: symbol, name, ISIN."""
    text = http.get_text(f"{ARCHIVE}/content/equities/EQUITY_L.csv", ttl=ttl)
    rows = csv.DictReader(io.StringIO(text))
    return [{"symbol": r["SYMBOL"].strip(), "name": r["NAME OF COMPANY"].strip(),
             "isin": r[" ISIN NUMBER"].strip()} for r in rows]
