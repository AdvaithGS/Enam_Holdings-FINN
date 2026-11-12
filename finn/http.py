"""Polite HTTP client with an on-disk cache.

Every request identifies itself honestly, waits its turn per host, and is cached by
URL. Immutable documents (filings, XBRL, PDFs) are cached forever; listings get a TTL.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.parse
from pathlib import Path

import requests

USER_AGENT = "finn-prototype/0.1 (research prototype; end-of-day reads only)"
ROOT = Path(__file__).resolve().parent.parent
# Serverless filesystems are read-only outside /tmp.
CACHE_DIR = Path(os.environ.get("FINN_CACHE", ROOT / "data" / "cache" / "http"))
MIN_INTERVAL = {"www.nseindia.com": 0.6, "nsearchives.nseindia.com": 0.25,
                "www.screener.in": 1.0, "query1.finance.yahoo.com": 0.5,
                "www.bseindia.com": 0.5}
FOREVER = float("inf")

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
_last_hit: dict[str, float] = {}
stats = {"fetched": 0, "cached": 0, "bytes": 0}


class FetchError(RuntimeError):
    pass


def _path(url: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()
    return CACHE_DIR / h[:2] / h[2:]


def get(url: str, ttl: float = FOREVER, timeout: float = 60, retries: int = 3) -> bytes:
    """Return the body of `url`. `ttl` is the cache lifetime in seconds."""
    p = _path(url)
    if p.exists() and (time.time() - p.stat().st_mtime) < ttl:
        stats["cached"] += 1
        return p.read_bytes()
    host = urllib.parse.urlsplit(url).netloc
    err: Exception | None = None
    for attempt in range(retries):
        wait = MIN_INTERVAL.get(host, 0.3) - (time.time() - _last_hit.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        try:
            r = _session.get(url, timeout=timeout)
            _last_hit[host] = time.time()
            if r.status_code == 200:
                try:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_bytes(r.content)
                except OSError:
                    pass  # cache is an optimisation, never a requirement
                stats["fetched"] += 1
                stats["bytes"] += len(r.content)
                return r.content
            if r.status_code in (401, 403, 404):
                raise FetchError(f"{r.status_code} for {url}")
            err = FetchError(f"{r.status_code} for {url}")
        except requests.RequestException as e:
            _last_hit[host] = time.time()
            err = e
        time.sleep(1.5 * 2 ** attempt)
    if p.exists():  # a stale copy beats no copy
        return p.read_bytes()
    raise FetchError(str(err))


def get_json(url: str, ttl: float = FOREVER, **kw):
    body = get(url, ttl=ttl, **kw)
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        _path(url).unlink(missing_ok=True)
        raise FetchError(f"not JSON: {url}") from e


def get_text(url: str, ttl: float = FOREVER, **kw) -> str:
    return get(url, ttl=ttl, **kw).decode("utf-8", errors="replace")
