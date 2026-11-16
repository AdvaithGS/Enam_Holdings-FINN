"""Screenshots of every tab at phone and laptop width, with only Firefox installed.

    npm run dev -- -p 3210 &          (or any running copy of the app)
    python scripts/shots.py [out_dir] [base_url]

Headless Firefox takes its screenshot at the load event, before the app has fetched its
data. So each page is shown inside a wrapper whose own load event is held back a few
seconds by a slow image; by then the app inside has rendered. CI does the same job with
Playwright (tests/visual.spec.ts); this is for looking at a change before committing it.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PAGES = [("brief", "/?w=30d", 1500), ("brief-week", "/?w=7d", 1400), ("book", "/book", 1200), ("ask", "/ask?q=adhesives", 1000),
         ("people", "/network", 1500), ("research", "/research/KAYNES?tab=management", 1500)]
WIDTHS = {"phone": 390, "laptop": 1440}
GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")


class Wrapper(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/slow.gif":
            time.sleep(float(q.get("s", ["8"])[0]))
            body, kind = GIF, "image/gif"
        else:
            body = (f'<body style="margin:0"><iframe src="{q["u"][0]}" style="width:{q["w"][0]}px;height:{q["h"][0]}px;border:0;display:block"></iframe>'
                    f'<img src="/slow.gif?s={q.get("s", ["8"])[0]}" width=1 height=1></body>').encode()
            kind = "text/html"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "shots").resolve()   # Firefox needs an absolute path
    base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3210"
    only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
    out.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Wrapper)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    with tempfile.TemporaryDirectory() as profile:
        for name, path, height in PAGES:
            if only and name not in only:
                continue
            for label, width in WIDTHS.items():
                h = height if label == "laptop" else int(height * 1.8)
                target = out / f"{name}-{label}.png"
                q = urllib.parse.urlencode({"u": base + path, "w": width, "h": h, "s": 9})
                subprocess.run(["firefox", "--headless", "--no-remote", "--profile", profile, f"--window-size={width},{h}",
                                "--screenshot", str(target), f"http://127.0.0.1:{port}/?{q}"], capture_output=True, timeout=120)
                print(target, target.stat().st_size if target.exists() else "MISSING")


if __name__ == "__main__":
    main()
