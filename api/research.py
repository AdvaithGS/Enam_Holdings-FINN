"""Serverless entry for Pull. One stage per request so each fits a function's time budget.

GET  /api/research?stage=resolve&q=...          symbols matching free text
POST /api/research?stage=plan    {q, themes}    a masked question -> field ids (no network data)
GET  /api/research?stage=base&symbol=KAYNES     statements, computed fundamentals, document links
POST /api/research?stage=call    {name, call}   one transcript -> verified extracts
POST /api/research?stage=annual  {name, ar}     annual report -> business snapshot
POST /api/research?stage=synth   {base, calls, annual}

The phone holds the intermediate results; the server keeps nothing between requests.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.environ.get("VERCEL"):
    os.environ.setdefault("FINN_CACHE", "/tmp/finn-http")
    os.environ.setdefault("FINN_LLM_CACHE", "/tmp/finn-llm")

from finn import llm  # noqa: E402
from finn.research import dossier  # noqa: E402

AR_PAGE_CAP = 140  # the business sections sit in the front of an annual report


def run(stage: str, query: dict, body: dict) -> tuple[int, dict]:
    try:
        if stage == "resolve":
            return 200, {"matches": dossier.resolve(query.get("q", ""))}
        if stage == "plan":
            return 200, plan(body.get("q", ""), body.get("themes", []))
        if stage == "base":
            return 200, dossier.base(query.get("symbol", ""))
        if stage == "call":
            return 200, dossier.call(body["name"], body["call"])
        if stage == "annual":
            return 200, dossier.annual(body["name"], body["ar"], AR_PAGE_CAP)
        if stage == "synth":
            return 200, dossier.synth(body["base"], body["calls"], body.get("annual"))
        return 400, {"error": f"unknown stage {stage!r}"}
    except llm.Unavailable as e:
        return 503, {"error": "The reading model is not available right now.", "detail": str(e)}
    except KeyError as e:
        return 400, {"error": f"missing field {e}"}
    except Exception as e:  # report, never hang the phone
        return 500, {"error": "This stage failed.", "detail": repr(e)[:300]}


PLAN_SCHEMA = {"type": "object", "required": ["themes"], "properties": {
    "themes": {"type": "array", "items": {"type": "string"}, "description": "ids from the list, most relevant first, at most 3"}}}


def plan(question: str, themes: list) -> dict:
    """Map an unusual question to fields of expertise. The phone has already removed
    every name from its network; the answer is ids from the list it sent, nothing else."""
    allowed = {t["id"]: t["label"] for t in themes if isinstance(t, dict) and "id" in t}
    if not question.strip() or not allowed:
        return {"themes": []}
    listing = "\n".join(f"{i}: {label}" for i, label in allowed.items())
    got = llm.ask("lite", "An investor asks which of their contacts could help with a question. "
                  "Pick the fields of industry experience (at most 3, by id) whose practitioners would know the answer. "
                  "If the question is about suppliers or customers of an industry, pick the supplier or customer fields. "
                  f"Return an empty list if none fits.\n\nFIELDS\n{listing}\n\nQUESTION\n{question[:400]}", PLAN_SCHEMA, max_tokens=200)
    return {"themes": [t for t in got.get("themes", []) if t in allowed][:3]}


class handler(BaseHTTPRequestHandler):
    def _respond(self, body: dict):
        parts = urlsplit(self.path)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        code, out = run(query.get("stage", ""), query, body)
        raw = json.dumps(out, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self._respond({})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            body = {}
        self._respond(body)

    def log_message(self, *args):
        pass
