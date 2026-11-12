"""Gemini, used sparingly: two tiers, schema-constrained output, content-hash cache.

  lite   bulk extraction: read a document, return facts with verbatim quotes
  flash  the one reasoning step: synthesis over already-extracted facts

Model names are discovered at run time (the newest stable model of each tier), so a
retired model does not break the pipeline. Every answer is cached under the hash of
(tier, prompt, schema); the cache is committed, so a re-run pays only for new input.
Without a key every call raises Unavailable and callers fall back to rules.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

import requests

API = "https://generativelanguage.googleapis.com/v1beta"
CACHE = Path(os.environ.get("FINN_LLM_CACHE", Path(__file__).resolve().parent.parent / "data" / "cache" / "llm"))
usage = {"calls": 0, "cache_hits": 0, "input_tokens": 0, "output_tokens": 0, "by_tier": {}}
_models: dict[str, list[str]] = {}
_resting: dict[str, float] = {}


class Unavailable(RuntimeError):
    pass


def key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def available() -> bool:
    return bool(key())


def _version(name: str) -> tuple:
    m = re.search(r"gemini-(\d+)(?:\.(\d+))?", name)
    return (int(m.group(1)), int(m.group(2) or 0)) if m else (0, 0)


def _discover() -> None:
    override = {"lite": os.environ.get("FINN_MODEL_LITE"), "flash": os.environ.get("FINN_MODEL_FLASH")}
    names: list[str] = []
    try:
        r = requests.get(f"{API}/models", params={"key": key(), "pageSize": 200}, timeout=20)
        r.raise_for_status()
        for m in r.json().get("models", []):
            if "generateContent" in m.get("supportedGenerationMethods", []):
                names.append(m["name"].split("/")[-1])
    except requests.RequestException:
        pass
    plain = [n for n in names if re.fullmatch(r"gemini-[\d.]+-flash(-lite)?", n)]
    lite = sorted((n for n in plain if n.endswith("-lite")), key=_version, reverse=True)
    flash = sorted((n for n in plain if not n.endswith("-lite")), key=_version, reverse=True)
    _models["lite"] = ([override["lite"]] if override["lite"] else []) + (lite or ["gemini-2.5-flash-lite"])
    _models["flash"] = ([override["flash"]] if override["flash"] else []) + (flash or ["gemini-2.5-flash"])


def _call(model: str, prompt: str, schema: dict | None, max_tokens: int) -> tuple[str, dict]:
    cfg: dict = {"temperature": 0, "maxOutputTokens": max_tokens}
    if schema:
        cfg.update(responseMimeType="application/json", responseSchema=schema)
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": cfg}
    r = requests.post(f"{API}/models/{model}:generateContent", params={"key": key()}, json=body, timeout=180)
    if r.status_code != 200:
        raise requests.HTTPError(f"{r.status_code}: {r.text[:200]}", response=r)
    data = r.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts), data.get("usageMetadata", {})


def ask(tier: str, prompt: str, schema: dict | None = None, max_tokens: int = 4096):
    """Return parsed JSON (when a schema is given) or text. Cached by content."""
    h = hashlib.sha256(json.dumps([tier, prompt, schema], sort_keys=True).encode()).hexdigest()
    path = CACHE / h[:2] / f"{h[2:]}.json"
    if path.exists():
        usage["cache_hits"] += 1
        return json.loads(path.read_text())["answer"]
    if not available():
        raise Unavailable("no GEMINI_API_KEY")
    if not _models:
        _discover()
    # a flash request may degrade to lite, but a degraded answer is never cached
    chain = [(m, True) for m in _models[tier]] + ([(m, False) for m in _models["lite"]] if tier == "flash" else [])
    last: Exception | None = None
    for model, cacheable in chain:
        if _resting.get(model, 0) > time.time():
            continue
        for attempt in range(3):
            try:
                text, meta = _call(model, prompt, schema, max_tokens)
                answer = json.loads(text) if schema else text
            except requests.HTTPError as e:
                code = e.response.status_code if e.response is not None else 0
                last = e
                if code == 404:
                    _resting[model] = float("inf")
                    break
                if code in (429, 500, 503):
                    if attempt == 2:
                        _resting[model] = time.time() + 300
                    time.sleep(4 * 2 ** attempt)
                    continue
                break
            except (requests.RequestException, json.JSONDecodeError) as e:
                last = e
                time.sleep(2)
                continue
            usage["calls"] += 1
            usage["input_tokens"] += meta.get("promptTokenCount", 0)
            usage["output_tokens"] += meta.get("candidatesTokenCount", 0)
            t = usage["by_tier"].setdefault(tier, {"calls": 0, "model": model})
            t["calls"] += 1
            if cacheable:
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps({"model": model, "answer": answer}, ensure_ascii=False))
                except OSError:
                    pass
            return answer
    raise Unavailable(f"all {tier} models failed: {last}")
