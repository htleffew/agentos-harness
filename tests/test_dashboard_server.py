from __future__ import annotations

import json
from urllib.request import Request, urlopen

from agentos_harness.dashboard_server import create_server, run_server_in_thread


def test_create_server_binds_localhost(tmp_path) -> None:
    server = create_server(tmp_path, port=0)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_create_server_allows_explicit_wildcard_host(tmp_path) -> None:
    server = create_server(tmp_path, host="0.0.0.0", port=0)
    try:
        assert server.server_address[0] == "0.0.0.0"
    finally:
        server.server_close()


def test_dashboard_server_endpoints(tmp_path) -> None:
    server, thread = run_server_in_thread(tmp_path)
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        html = urlopen(f"{base}/").read().decode("utf-8")
        assert "Workspace Control Dashboard" in html
        payload = json.loads(urlopen(f"{base}/api/state").read().decode("utf-8"))
        assert payload["schema_version"] == "1.0"
        request = Request(f"{base}/api/refresh", method="POST")
        refreshed = json.loads(urlopen(request).read().decode("utf-8"))
        assert refreshed["schema_version"] == "1.0"
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def test_dashboard_server_accepts_codeeditor_ports_prefix(tmp_path) -> None:
    server, thread = run_server_in_thread(tmp_path)
    base = f"http://127.0.0.1:{server.server_port}/codeeditor/default/ports/{server.server_port}"
    try:
        html = urlopen(f"{base}/").read().decode("utf-8")
        assert 'href="dashboard.css"' in html
        payload = json.loads(urlopen(f"{base}/api/state").read().decode("utf-8"))
        assert payload["schema_version"] == "1.0"
        request = Request(f"{base}/api/refresh", method="POST")
        refreshed = json.loads(urlopen(request).read().decode("utf-8"))
        assert refreshed["schema_version"] == "1.0"
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


def test_dashboard_server_accepts_legacy_codeeditor_proxy_prefix(tmp_path) -> None:
    server, thread = run_server_in_thread(tmp_path)
    base = f"http://127.0.0.1:{server.server_port}/codeeditor/default/proxy/{server.server_port}"
    try:
        payload = json.loads(urlopen(f"{base}/api/state").read().decode("utf-8"))
        assert payload["schema_version"] == "1.0"
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()
