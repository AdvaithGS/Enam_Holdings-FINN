"""Reading a filing. Rules and local tools first; a small model only to read prose.

The model never scores anything. It returns facts with the verbatim sentence each
came from, and code keeps a fact only if that sentence is really in the document.
"""
from __future__ import annotations

import html
import re

from . import docs, llm

# ---------------------------------------------------------------- titles

_BOILER = re.compile(
    r"^.{0,80}?\b(has|have) (informed|submitted to) the exchange,?\s*(regarding|about|that|a copy of)?\s*", re.I)
_REG = re.compile(
    r"(intimation|disclosure|announcement|information)?\s*(under|pursuant to|in terms of)\s+reg(ulation)?\.?\s*\d+[\w()]*"
    r"(\s*(read with|and)\s*[\w\s,()]*?schedule\s*iii)?(\s*of\s*(the\s*)?(sebi|securities and exchange board of india)"
    r"\s*\(?(lodr|listing obligations? (and|&) disclosure requirements?)\)?,?\s*(regulations?)?,?\s*(2015)?)?", re.I)
_GENERIC = re.compile(r"^(general )?updates?$|^outcome of (the )?board meeting$|^press release( dated .{0,20})?$|^acquisition$"
                      r"|^change in management$|^issue of securities$|^action\(s\) taken or orders passed$|^credit rating$", re.I)


_LEFTOVER = re.compile(r"listing obligations|disclosure requirements|^(of|and|under|the|in terms)\b|sebi circular|"
                       r"^outcome of (the )?board meeting|^(a )?press release dated|^please find|prohibition of insider", re.I)


def title_of(subject: str, text: str) -> tuple[str, bool]:
    """A readable one-line title, and whether it actually says anything."""
    t = html.unescape(text or "").strip()
    t = _BOILER.sub("", t)
    m = re.search(r'titled\s+["“\']+(.+?)["”\']*\.?$', t)
    if m:
        t = m.group(1)
    t = _REG.sub(" ", t)
    t = re.sub(r"\(\s*[\"']?\s*sebi listing regulations\s*[\"']?\s*\)", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" '\".,:;-–")
    informative = (len(re.findall(r"[A-Za-z]{3,}", t)) >= 3 and not _GENERIC.match(t)
                   and t.lower() != (subject or "").lower() and not _LEFTOVER.search(t))
    if not t:
        t = subject
    if t:
        t = t[0].upper() + t[1:]
    return t, informative


_SUBJECT_LINE = re.compile(r"(?im)^\s*(?:sub(?:ject)?|re|ref)\s*[:.\-–]+\s*(.+(?:\n(?!\s*\n).+){0,2})")


def subject_from_document(first_page: str) -> str | None:
    """Indian exchange letters carry a 'Sub:' line. It is the company's own title."""
    m = _SUBJECT_LINE.search(first_page or "")
    if not m:
        return None
    s = re.sub(r"\s+", " ", m.group(1)).strip()
    s = _REG.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" '\".,:;-–")
    s = re.sub(r"^(intimation|disclosure|announcement|update|information)\s*(of|on|for|regarding|about|-|:)?\s*$", "", s, flags=re.I)
    if _LEFTOVER.search(s):
        return None
    return s if len(re.findall(r"[A-Za-z]{3,}", s)) >= 2 else None


def short(text: str, limit: int = 120) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:-") + "…"


# ---------------------------------------------------------------- money

_UNIT = {"crore": 1.0, "crores": 1.0, "cr": 1.0, "lakh": 0.01, "lakhs": 0.01, "lac": 0.01, "lacs": 0.01,
         "million": 0.1, "mn": 0.1, "billion": 100.0, "bn": 100.0}
_INR = re.compile(r"(?:rs\.?|inr|₹|&#8377;)\s*([\d,]+(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|million|mn|billion|bn)\b", re.I)
_FX = re.compile(r"(usd|us\$|\$|eur|€|gbp|£)\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)\b", re.I)
_FX_CODE = {"usd": "USD", "us$": "USD", "$": "USD", "eur": "EUR", "€": "EUR", "gbp": "GBP", "£": "GBP"}


def to_crore(value: float, unit: str, currency: str, fx: dict[str, float]) -> float | None:
    """Convert a stated amount to rupees crore. fx maps currency code -> rupees."""
    u = _UNIT.get((unit or "").lower().strip("."))
    if u is None:
        return None
    if currency == "INR":
        return value * u
    rate = fx.get(currency)
    if rate is None:
        return None
    # foreign amounts are stated in million/billion units of that currency
    units = {0.1: 1e6, 100.0: 1e9}.get(u)
    return value * units * rate / 1e7 if units else None


def amount_in_text(text: str, fx: dict[str, float]) -> dict | None:
    """The first explicit money amount in a headline, in crore, with its source text."""
    t = html.unescape(text or "")
    m = _INR.search(t)
    if m:
        cr = to_crore(float(m.group(1).replace(",", "")), m.group(2), "INR", fx)
        return {"cr": cr, "quote": m.group(0), "from": "headline"} if cr else None
    m = _FX.search(t)
    if m:
        cr = to_crore(float(m.group(2).replace(",", "")), m.group(3), _FX_CODE[m.group(1).lower()], fx)
        return {"cr": cr, "quote": m.group(0), "from": "headline"} if cr else None
    return None


# ---------------------------------------------------------------- people

_PERSON = re.compile(
    r"\b(?P<action>re-?appointment|appointment|resignation|cessation|retirement|demise|superannuation)\s+of\s+"
    r"(?:(?:mr|ms|mrs|dr|shri|smt|prof)\.?\s+)?(?P<name>[A-Z][A-Za-z.'\-]*(?:\s+[A-Z][A-Za-z.'\-]*){0,5}?)"
    r"\s*(?:\(DIN[:\s]*\d+\))?\s*(?:,\s*|\s+)(?:as|from the (?:post|position|office) of)\s+(?:an?\s+|the\s+)?(?P<role>.+?)"
    r"(?:\s+of\s+(?:the\s+)?(?:company|bank|\w[\w ]{0,40}limited))?(?:\s+w\.?e\.?f\.?\s*(?P<date>[A-Za-z0-9 ,]+?))?\s*\.?\s*$",
    re.I)
_ACTION = {"appointment": "appointed", "reappointment": "reappointed", "re-appointment": "reappointed",
           "resignation": "resigned", "cessation": "ceased", "retirement": "retired", "demise": "died",
           "superannuation": "retired"}
_TIER1 = re.compile(r"managing director|chief executive|\bceo\b|\bcfo\b|chief financial|chairman|chairperson|\bmd\b", re.I)
_TIER2 = re.compile(r"whole[- ]?time|executive director|deputy|\bcoo\b|\bcto\b|\bcio\b|\bcro\b|\bchro\b|chief |president|key managerial|\bkmp\b|senior management|business head|head of", re.I)
_TIER4 = re.compile(r"company secretary|compliance officer|auditor|secretarial", re.I)
_NONEXEC = re.compile(r"non[- ]*executive|independent|nominee|additional director", re.I)


def role_tier(role: str) -> int:
    """1 runs the company or its money; 2 senior executive; 3 board oversight; 4 paperwork."""
    r = role or ""
    if _TIER4.search(r):
        return 4
    if _NONEXEC.search(r) and not re.search(r"chairman|chairperson", r, re.I):
        return 3
    if re.search(r"deputy|joint|assistant|vice", r, re.I) and not re.search(r"\bcfo\b|chief financial|chief executive", r, re.I):
        return 2
    if _TIER1.search(r):
        return 1
    if _TIER2.search(r):
        return 2
    return 3


def person_in_text(text: str) -> dict | None:
    m = _PERSON.search(html.unescape(text or "").strip())
    if not m:
        return None
    role = re.sub(r"\s+", " ", m.group("role")).strip(" .,")
    role = re.sub(r"non-\s+executive", "Non-Executive", role, flags=re.I)
    return {"name": re.sub(r"\s+", " ", m.group("name")).strip(), "role": role,
            "action": _ACTION[m.group("action").lower().replace(" ", "")],
            "effective": (m.group("date") or "").strip() or None, "tier": role_tier(role), "source": "exchange"}


PEOPLE_SCHEMA = {
    "type": "object", "required": ["people"],
    "properties": {"people": {"type": "array", "items": {
        "type": "object", "required": ["name", "action", "role"],
        "properties": {
            "name": {"type": "string"},
            "action": {"type": "string", "enum": ["appointed", "reappointed", "resigned", "retired", "ceased", "died", "redesignated"]},
            "role": {"type": "string", "description": "the role at this company that the change concerns"},
            "effective": {"type": "string"},
            "reason": {"type": "string", "description": "stated reason for leaving, verbatim, else empty"},
            "age": {"type": "integer"},
            "career": {"type": "array", "description": "previous and current employers stated in the profile", "items": {
                "type": "object", "required": ["org"],
                "properties": {"org": {"type": "string"}, "role": {"type": "string"},
                               "from_year": {"type": "integer"}, "to_year": {"type": "integer"}}}},
            "education": {"type": "array", "items": {
                "type": "object", "required": ["school"],
                "properties": {"school": {"type": "string"}, "degree": {"type": "string"}, "year": {"type": "integer"}}}},
            "bio": {"type": "string", "description": "at most 35 words, only facts stated in the document"},
        }}}},
}

PEOPLE_PROMPT = """You are reading a stock-exchange filing about a change in directors or senior management at {company}.
List every person whose appointment, re-appointment, resignation, retirement or cessation the filing announces.
Use only what the document states. Do not add anything you know from elsewhere. Leave a field out if the document does not state it.
For "career", list each employer named in the person's brief profile, using the organisation's name exactly as written.
For "education", list each institution named, exactly as written.

DOCUMENT
{text}"""


def people_from_document(company: str, pages: list[str]) -> list[dict]:
    """People and their stated backgrounds. Every org/school must appear in the text."""
    text = "\n".join(pages)[:24000]
    if len(text.strip()) < 200:
        return []
    got = llm.ask("lite", PEOPLE_PROMPT.format(company=company, text=text), PEOPLE_SCHEMA)
    hay = docs.norm(text)
    out = []
    for p in got.get("people", []):
        last = docs.norm((p.get("name") or "").split()[-1]) if p.get("name") else ""
        if not last or last not in hay:
            continue  # a name the document does not contain is not a finding
        p["career"] = [c for c in p.get("career", []) if c.get("org") and docs.norm(c["org"]) in hay]
        p["education"] = [e for e in p.get("education", []) if e.get("school") and docs.norm(e["school"]) in hay]
        p["name"] = re.sub(r"^(mr|ms|mrs|dr|shri|smt|prof)\.?\s+", "", p["name"].strip(), flags=re.I)
        p["tier"] = role_tier(p.get("role", ""))
        p["source"] = "filing"
        out.append(p)
    return out


# ---------------------------------------------------------------- facts

FACTS_SCHEMA = {
    "type": "object", "required": ["headline", "so_what"],
    "properties": {
        "headline": {"type": "string", "description": "what happened, at most 16 words, concrete, no company name prefix"},
        "so_what": {"type": "string", "description": "one sentence, at most 28 words: the consequence for a shareholder, using only facts in the document. Empty if the document gives no basis."},
        "counterparty": {"type": "string", "description": "the other organisation involved (target, customer, regulator, partner), exactly as written; empty if none"},
        "amount_value": {"type": "number", "description": "the single money amount that sizes this event (deal value, order value, demand, capex, issue size)"},
        "amount_unit": {"type": "string", "enum": ["crore", "lakh", "million", "billion", "none"]},
        "amount_currency": {"type": "string", "enum": ["INR", "USD", "EUR", "GBP", "other"]},
        "amount_quote": {"type": "string", "description": "the exact words from the document that state this amount"},
        "people": {"type": "array", "items": {"type": "string"}, "description": "named individuals central to the event"},
    },
}

FACTS_PROMPT = """You are reading a stock-exchange filing by {company} ({category}).
Report what it says. Use only the document. Do not judge importance and do not add outside knowledge.
If the document states a money amount that sizes the event, give it with the exact words that state it; otherwise set amount_unit to "none".
Do not use totals that describe the company in general (its revenue, market value, net worth).

DOCUMENT
{text}"""


def facts_from_document(company: str, category: str, pages: list[str], fx: dict[str, float]) -> dict | None:
    text = "\n".join(pages)[:20000]
    if len(text.strip()) < 200:
        return None
    got = llm.ask("lite", FACTS_PROMPT.format(company=company, category=category, text=text), FACTS_SCHEMA, max_tokens=1024)
    out = {"headline": short(got.get("headline", ""), 130), "so_what": short(got.get("so_what", ""), 220),
           "counterparty": (got.get("counterparty") or "").strip() or None,
           "people": [p for p in got.get("people", []) if docs.norm(p.split()[-1]) in docs.norm(text)][:4]}
    hay = docs.norm(text)
    if out["counterparty"] and docs.norm(out["counterparty"]) not in hay:
        out["counterparty"] = None
    unit, quote = got.get("amount_unit"), got.get("amount_quote") or ""
    if unit and unit != "none" and got.get("amount_value") and docs.contains_quote(hay, quote, min_len=4):
        # the number itself must be inside the quoted words
        digits = re.sub(r"[^\d.]", "", f"{got['amount_value']:.10g}")
        if digits.rstrip("0").rstrip(".") in re.sub(r"[^\d.]", "", quote):
            cr = to_crore(float(got["amount_value"]), unit, got.get("amount_currency") or "INR", fx)
            if cr:
                out["amount"] = {"cr": cr, "quote": short(quote, 160), "from": "document"}
    return out
