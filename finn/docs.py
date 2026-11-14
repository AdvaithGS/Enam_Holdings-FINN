"""PDF to text, locally and for free.

Order of preference:
  1. poppler's pdftotext (fast, keeps table layout)      - batch pipeline
  2. pypdf (pure Python)                                 - serverless, no binaries
  3. tesseract OCR on rasterised pages                   - scanned filings only
A page is treated as scanned when it yields fewer than MIN_CHARS characters.
"""
from __future__ import annotations

import io
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import http

logging.getLogger("pypdf").setLevel(logging.CRITICAL)

MIN_CHARS = 80
_HAS = {k: bool(shutil.which(k)) for k in ("pdftotext", "pdftoppm", "tesseract")}
stats = {"ocr_pages": 0}


def _pdftotext(raw: bytes, first: int, last: int | None, layout: bool = True) -> list[str] | None:
    if not _HAS["pdftotext"]:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(raw)
        f.flush()
        cmd = ["pdftotext"] + (["-layout"] if layout else []) + ["-f", str(first)]
        if last:
            cmd += ["-l", str(last)]
        try:
            out = subprocess.run(cmd + [f.name, "-"], capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            return None
        if out.returncode != 0:
            return None
        return out.stdout.decode("utf-8", errors="replace").split("\f")


def _pypdf(raw: bytes, first: int, last: int | None) -> list[str] | None:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        pages = reader.pages[first - 1:last]
        return [(p.extract_text() or "") for p in pages]
    except Exception:
        return None


def _ocr(raw: bytes, page: int) -> str:
    if not (_HAS["pdftoppm"] and _HAS["tesseract"]):
        return ""
    with tempfile.TemporaryDirectory() as d:
        pdf = Path(d) / "in.pdf"
        pdf.write_bytes(raw)
        try:
            subprocess.run(["pdftoppm", "-r", "200", "-gray", "-png", "-f", str(page), "-l", str(page),
                            str(pdf), str(Path(d) / "pg")], capture_output=True, timeout=60)
            img = next(Path(d).glob("pg*.png"), None)
            if not img:
                return ""
            out = subprocess.run(["tesseract", str(img), "-", "--psm", "6"], capture_output=True, timeout=90)
        except subprocess.TimeoutExpired:
            return ""
        stats["ocr_pages"] += 1
        return out.stdout.decode("utf-8", errors="replace")


def pages(raw: bytes, first: int = 1, last: int | None = None, ocr_limit: int = 6, layout: bool = True) -> list[str]:
    """Text of pages [first, last] (1-based, inclusive).

    layout=True keeps columns aligned, which is what a table of numbers needs. It also
    interleaves the cells of a multi-column table line by line, which destroys prose
    inside cells (a director's profile in a three-column disclosure table). For prose,
    pass layout=False: the text is then read in reading order, cell by cell.
    """
    if not raw.lstrip()[:5].startswith(b"%PDF"):
        return []
    out = _pdftotext(raw, first, last, layout) or _pypdf(raw, first, last) or []
    out = [p for p in out]
    while out and not out[-1].strip():
        out.pop()
    budget = ocr_limit
    for i, p in enumerate(out):
        if len(p.strip()) < MIN_CHARS and budget > 0:
            budget -= 1
            out[i] = _ocr(raw, first + i) or p
    return out


def fetch_pages(url: str, first: int = 1, last: int | None = None, ocr_limit: int = 6, layout: bool = True) -> list[str]:
    try:
        raw = http.get(url, timeout=120)
    except http.FetchError:
        return []
    return pages(raw, first, last, ocr_limit, layout)


def clean(text: str) -> str:
    """Collapse whitespace so that quotes can be compared across layouts."""
    return re.sub(r"\s+", " ", text).strip()


_NORM = re.compile(r"[^a-z0-9]+")


def norm(text: str) -> str:
    """Letters and digits only, lower-case: the form used to verify a quote."""
    return _NORM.sub("", text.lower())


def contains_quote(haystack_norm: str, quote: str, min_len: int = 12) -> bool:
    """True when `quote` occurs verbatim (ignoring spacing/punctuation) in the source."""
    q = norm(quote)
    return len(q) >= min_len and q in haystack_norm
