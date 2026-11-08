#!/usr/bin/env python3
"""Serve the app's page in demo mode on this PC: python tools/demo.py [port]

Then open http://localhost:8124/ (add ?state=blocked and so on; see app/demo.js). The page is served
from app/, and the card from card/ at card/, laid out as the package lays them out on the TV.
"""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path == "/card/level.js":
            return str(ROOT / "app/level.js")
        if path.startswith("/card/orb/"):
            return str(ROOT / "orb" / path[len("/card/orb/"):])
        if path.startswith("/card/"):
            return str(ROOT / "card" / path[len("/card/"):])
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT / "app")))
    print("Local Voice demo: http://localhost:%d/" % port)
    server.serve_forever()
