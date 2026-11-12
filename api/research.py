"""Serverless entry for Pull. One stage per request so each fits a function's time budget.

GET  /api/research?stage=resolve&q=...          symbols matching free text
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
