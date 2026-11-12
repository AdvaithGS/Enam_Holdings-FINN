"""What kind of filing is this? Decided without a model.

Two steps. NSE files every announcement under a subject; when that subject is
specific ("Credit Rating", "Resignation") it is authoritative and maps straight to a
category. When it is a catch-all ("Updates", "Outcome of Board Meeting") the text the
company wrote decides, by ordered rules: first match wins, so the order encodes
precedence (a board outcome that approves results is `results`, not `dividend`).

Categories follow the brief's reference list. Two adaptations:
  - `routine` replaces "unclassified": it is a positive claim (known paperwork), kept
    apart from `other`, which means "no rule matched" and is therefore worth a look.
  - `shareholder_meeting` merges postal ballots with AGM/EGM notices.
"""
from __future__ import annotations

import re

CATEGORIES = {
    "results": "Results",
    "m_and_a": "M&A",
    "fund_raise": "Fund raise",
    "management_change": "Management",
    "litigation": "Legal & regulatory",
    "insider_trading": "Insider trade",
    "pledging": "Pledge",
    "earnings_call": "Earnings call",
    "investor_meetings": "Investor meet",
    "credit_rating": "Credit rating",
    "dividend": "Dividend",
    "bonus_split": "Bonus / split",
    "capex": "Capex",
    "press_release": "Business update",
    "shareholder_meeting": "Shareholder vote",
    "routine": "Routine",
    "other": "Other",
}

SUBJECT = {
    "financial result updates": "results",
    "integrated filing- financial": "results",
    "integrated filing- governance": "routine",
    "clarification - financial results": "results",
    "reply to clarification- financial results": "results",
    "acquisition": "m_and_a",
    "amalgamation/merger": "m_and_a",
    "scheme of arrangement": "m_and_a",
    "sale or disposal": "m_and_a",
    "diversification/disinvestment": "m_and_a",
    "other restructuring": "m_and_a",
    "incorporation": "m_and_a",
    "qualified institutional placement": "fund_raise",
    "preferential issue": "fund_raise",
    "buyback": "fund_raise",
    "public announcement - buyback of shares": "fund_raise",
    "post buyback public announcement": "fund_raise",
    "closure of buy back": "fund_raise",
    "issue of securities": "fund_raise",
    "appointment": "management_change",
    "resignation": "management_change",
    "cessation": "management_change",
    "retirement": "management_change",
    "demise": "management_change",
    "change in management": "management_change",
    "change in director(s)": "management_change",
    "resignation of director/kmp/smp": "management_change",
    "resignation of independent director": "management_change",
    "action(s) taken or orders passed": "litigation",
    "action(s) initiated or orders passed": "litigation",
    "pendency of litigation(s)/dispute(s) or the outcome impacting the company": "litigation",
    "disclosure under insider trading regulation": "insider_trading",
    "trading plan under pit": "insider_trading",
    "trading plan under sebi (pit) reg., 2015": "insider_trading",
    "disclosure under sebi takeover regulations": "pledging",
    "analysts/institutional investor meet/con. call updates": "investor_meetings",
    "investor presentation": "results",
    "credit rating": "credit_rating",
    "credit rating- new": "credit_rating",
    "credit rating- revision": "credit_rating",
    "credit rating- others": "credit_rating",
    "dividend": "dividend",
    "dividend updates": "dividend",
    "date of payment of dividend": "dividend",
    "bonus": "bonus_split",
    "stock split": "bonus_split",
    "capacity addition": "capex",
    "commencement of commercial production/operations": "capex",
    "bagging/receiving of orders/contracts": "press_release",
    "awarding of order(s)/contract(s)": "press_release",
    "agreements": "press_release",
    "memorandum of understanding/agreements": "press_release",
    "news verification": "press_release",
    "rumour verification - regulation 30(11)": "press_release",
    "shareholders meeting": "shareholder_meeting",
    "loss of share certificates": "routine",
    "loss of share certificate": "routine",
    "issue of duplicate share certificate": "routine",
    "copy of newspaper publication": "routine",
    "trading window": "routine",
    "esop/esos/esps": "routine",
    "allotment of esop/esps": "routine",
    "certificate under sebi (depositories and participants) regulations, 2018": "routine",
    "monitoring agency report": "routine",
    "statement of deviation(s) or variation(s) under reg. 32": "routine",
    "record date": "routine",
    "revised record date": "routine",
    "book closure": "routine",
    "change in auditors": "routine",
    "amendment to aoa/moa": "routine",
    "change in company secretary/compliance officer": "routine",
    "address change": "routine",
    "code of conduct under sebi(pit) reg., 2015": "routine",
    "options to purchase securities": "routine",
    "committee meeting updates": "routine",
    "corrigendum": "routine",
    "related party transactions": "routine",
    "spurt in volume": "press_release",
}

# Ordered text rules for catch-all subjects. (category, pattern)
_R = lambda p: re.compile(p, re.I)  # noqa: E731
TEXT_RULES: list[tuple[str, re.Pattern]] = [
    ("routine", _R(r"(appointment|re-?appointment|rotation) of .{0,30}auditors?|change (in|of) .{0,30}(address|registrar|rta)\b")),
    ("earnings_call", _R(r"transcript|audio (recording|link)|recording of (the )?(earnings|conference|analyst)|earnings (conference )?call|con(ference)?[. ]*call")),
    ("investor_meetings", _R(r"investor'?s?'? (meet|conference|day)|analyst'?s?'? (meet|day)|non-deal roadshow|one-on-one|schedule of (analyst|investor)")),
    ("results", _R(r"financial results|results for the (quarter|period|year|half)|(un)?audited .{0,40}results|investor presentation|shareholders?'? letter|earnings (release|presentation)|quarterly (update|business update)")),
    ("management_change", _R(r"\b(re-?)?appoint(ment|ed)?\b.{0,80}\b(director|chief|ceo|cfo|coo|cto|managing|chairman|chairperson|president|kmp|key managerial|senior management)|\bresign(ation|ed|s)?\b|\bcessation\b|\bretire(ment|s|d)?\b.{0,40}(director|chief|officer)|change in (senior )?(management|director|kmp)|superannuat|\bdemise\b|step(s|ped)? down (as|from)")),
    ("litigation", _R(r"\b(order|notice|demand|penalty|fine|show cause|summons)\b.{0,60}\b(gst|cgst|sgst|tax|commissioner|sebi|rbi|reserve bank|court|tribunal|nclt|nclat|cci|authority|department|directorate|customs)|\b(gst|income tax|tax|sebi|rbi|reserve bank of india|court|tribunal|nclt|nclat|cci|customs)\b.{0,60}\b(order|notice|demand|penalty|fine)|litigation|arbitra|insolvency|writ petition|\bappeal\b|warning letter|search (and|&) seizure|adjudicat|usfda|form 483|import alert")),
    ("m_and_a", _R(r"acqui(re|red|sition|ring)|merger|amalgamation|demerger|joint venture|scheme of arrangement|\bslump sale\b|divest|stake (sale|purchase)|sale of (stake|shares|business|undertaking|subsidiary)|wholly[- ]owned subsidiary|incorporation of|strategic investment|share purchase agreement|initial public offer|disposal of (stake|shares)|investment in |infusion of .{0,30}equity|liquidation of|draft red herring")),
    ("fund_raise", _R(r"\bqip\b|qualified institution|preferential (issue|allotment)|rights issue|buy-?back|raising of funds|fund rais|non-?convertible debenture|\bncds?\b|commercial paper|foreign currency (convertible )?bond|issue of (securities|debentures|bonds)|allotment of .{0,40}(non convertible|debenture|bond|preferential|qip)")),
    ("credit_rating", _R(r"credit rating|\b(icra|crisil|care ratings|india ratings|moody'?s|s&p|fitch)\b")),
    ("pledging", _R(r"\bpledge|encumbr|regulation 31\(")),
    ("insider_trading", _R(r"insider trading|regulation 7\(2\)|\bpit\b")),
    ("bonus_split", _R(r"bonus (issue|shares)|stock split|sub-?division of")),
    ("dividend", _R(r"\bdividend\b")),
    ("capex", _R(r"capacity (addition|expansion)|capex|capital expenditure|new (plant|facility|manufacturing|unit|line)|greenfield|brownfield|commenc(e|ed|ement) .{0,30}(production|operations)|expansion of")),
    ("shareholder_meeting", _R(r"postal ballot|annual general meeting|\bagm\b|\begm\b|extra-?ordinary general|e-?voting|voting results|scrutinizer")),
    ("routine", _R(r"share certificate|newspaper|trading window|esop|esps|employee stock|regulation 74\(5\)|compliance certificate|business responsibility|\bbrsr\b|sustainability report|esg rating|unclaimed dividend|\biepf\b|record date|book closure|secretarial|reg(ulation)?\.? ?40\(|investor (grievance|complaint)|annual report|change of (name|address)|registrar|statement of deviation|monitoring agency|reclassification|re-classification|tds on dividend|duplicate|statutory auditor|secretarial auditor|cost auditor|\brta\b|share transfer agent|reminder (notice|letter)|half[- ]yearly report|closure of (the )?board meeting|certificate (pursuant|under)|call money|partly paid")),
    ("press_release", _R(r"press release|media release|order|contract|launch|partner|collaborat|agreement|\bmou\b|clarification|news|rumou?r|production volume|sales volume|business update|price (revision|hike|increase)")),
]

CATCH_ALL = {"updates", "general updates", "outcome of board meeting", "press release",
             "press release (revised)", "media release", "allotment of securities",
             "disclosure of material issue", "clarification", "reply to clarification sought", ""}

# Routine paperwork that hides under specific subjects.
_ESOP = _R(r"pursuant to esop|esop/esps|employee stock")
_DEBT_ALLOT = _R(r"non convertible|debenture|commercial paper")
_REAPPOINT = _R(r"\bre-?appoint")
_TAKEOVER_31_4 = _R(r"regulation 31\(4\)")


def classify(subject: str, text: str) -> tuple[str, str]:
    """Return (category, how) where how is 'subject', 'text' or 'none'."""
    s = (subject or "").strip().lower()
    body = f"{subject} {text}"
    if s == "allotment of securities":
        if _ESOP.search(text):
            return "routine", "text"
        return "fund_raise", "text"
    if s == "disclosure under sebi takeover regulations" and _TAKEOVER_31_4.search(text):
        # Reg 31(4) is the yearly "no encumbrance" declaration, not a pledge event.
        return "routine", "text"
    if s in SUBJECT and s not in CATCH_ALL:
        return SUBJECT[s], "subject"
    for cat, pat in TEXT_RULES:
        if pat.search(body):
            return cat, "text"
    return "other", "none"


def is_reappointment(text: str) -> bool:
    return bool(_REAPPOINT.search(text or ""))


def is_routine_debt(text: str) -> bool:
    return bool(_DEBT_ALLOT.search(text or ""))
