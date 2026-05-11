"""Read-only local dashboard server."""

from __future__ import annotations

import json
import re
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .dashboard_data import build_dashboard_state
from .models import stable_json


ALLOWED_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0"}
CODEEDITOR_PORT_PREFIX = re.compile(r"^/codeeditor/default/(?:proxy|ports)/\d+(?=/|$)")


class DashboardRequestHandler(BaseHTTPRequestHandler):
    workspace: Path

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def _static(self, name: str, content_type: str) -> None:
        content = resources.files("distributable_harness.static").joinpath(name).read_bytes()
        self._send(HTTPStatus.OK, content, content_type)

    def _route_path(self) -> str:
        path = urlparse(self.path).path
        match = CODEEDITOR_PORT_PREFIX.match(path)
        if match:
            return path[match.end() :] or "/"
        return path

    def do_GET(self) -> None:
        path = self._route_path()
        if path in {"/", "/dashboard.html"}:
            self._static("dashboard.html", "text/html; charset=utf-8")
        elif path == "/dashboard.css":
            self._static("dashboard.css", "text/css; charset=utf-8")
        elif path == "/dashboard.js":
            self._static("dashboard.js", "application/javascript; charset=utf-8")
        elif path == "/api/state":
            payload = build_dashboard_state(self.workspace)
            self._send(HTTPStatus.OK, stable_json(payload).encode("utf-8"), "application/json; charset=utf-8")
        elif path == "/api/export":
            payload = build_dashboard_state(self.workspace)
            self._send(HTTPStatus.OK, stable_json(payload).encode("utf-8"), "application/json; charset=utf-8")
        else:
            self._send(HTTPStatus.NOT_FOUND, b"not found\n", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = self._route_path()
        if path == "/api/refresh":
            payload = build_dashboard_state(self.workspace)
            self._send(HTTPStatus.OK, stable_json(payload).encode("utf-8"), "application/json; charset=utf-8")
        else:
            self._send(HTTPStatus.NOT_FOUND, b"not found\n", "text/plain; charset=utf-8")


def create_server(workspace: str | Path, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    if host not in ALLOWED_HOSTS:
        allowed = ", ".join(sorted(ALLOWED_HOSTS))
        raise ValueError(f"dashboard host must be one of: {allowed}")
    root = Path(workspace).resolve()

    class Handler(DashboardRequestHandler):
        pass

    Handler.workspace = root
    return ThreadingHTTPServer((host, port), Handler)


def run_server(workspace: str | Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    server = create_server(workspace, host, port)
    try:
        print(f"serving dashboard at http://{host}:{server.server_port}")
        server.serve_forever()
    finally:
        server.server_close()


def run_server_in_thread(workspace: str | Path) -> tuple[ThreadingHTTPServer, threading.Thread]:
    server = create_server(workspace, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread
