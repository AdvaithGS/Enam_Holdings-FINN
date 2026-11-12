"""Local stand-in for the serverless function: python -m finn.server"""
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))
from research import handler  # noqa: E402

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"FINN research API on http://127.0.0.1:{port}/api/research")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
