"""Process manager — harness dashboard start/stop/status.

Implements §15 item 5 alternative (no PM2 required):
- start()  → spawns Next.js (pnpm dev) + daemon (node scripts/daemon/index.js)
             writes PIDs to .harness/state/dashboard-pids.json
- stop()   → reads PIDs, sends SIGTERM (Windows: taskkill)
- status() → checks liveness via os.kill / Windows API
- wait_for_port() → polls port until process is accepting connections

Dashboard source lives in:
  <agentos_harness_package_root>/../../dashboard/   (relative to this file)
or can be overridden with the AGENTOS_DASHBOARD_DIR env var.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

PIDS_FILE = Path(".harness") / "state" / "dashboard-pids.json"
DASHBOARD_DEFAULT_PORT = 8768
DAEMON_SCRIPT_RELATIVE = "scripts/daemon/index.js"


# ── Resolve dashboard directory ───────────────────────────────────────────────


def _find_dashboard_dir() -> Path:
    """Locate the Next.js dashboard directory.

    Search order:
    1. AGENTOS_DASHBOARD_DIR environment variable
    2. <this_file>/../../../../dashboard  (agentos-harness/dashboard/)
    """
    env_override = os.environ.get("AGENTOS_DASHBOARD_DIR")
    if env_override:
        p = Path(env_override)
        if p.exists():
            return p.resolve()
        raise FileNotFoundError(f"AGENTOS_DASHBOARD_DIR={env_override!r} does not exist")

    # Navigate: src/agentos_harness/dashboard/process.py → agentos-harness/dashboard/
    this_file = Path(__file__).resolve()
    candidate = this_file.parent.parent.parent.parent / "dashboard"
    if candidate.exists():
        return candidate
    raise FileNotFoundError(
        f"Cannot find dashboard directory (expected {candidate}). "
        "Set AGENTOS_DASHBOARD_DIR to its location."
    )


# ── PID file helpers ──────────────────────────────────────────────────────────


def _pids_path(workspace: Path) -> Path:
    return workspace / PIDS_FILE


def _read_pids(workspace: Path) -> dict[str, Any]:
    path = _pids_path(workspace)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _write_pids(workspace: Path, data: dict[str, Any]) -> None:
    path = _pids_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _clear_pids(workspace: Path) -> None:
    path = _pids_path(workspace)
    if path.exists():
        path.unlink()


# ── Process liveness check ────────────────────────────────────────────────────


def _is_alive(pid: int) -> bool:
    """Return True if the process with the given PID is running."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if handle == 0:
            return False
        ret = ctypes.windll.kernel32.WaitForSingleObject(handle, 0)
        ctypes.windll.kernel32.CloseHandle(handle)
        return ret != 0  # WAIT_OBJECT_0 (0) means process exited
    else:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError):
            return False


def _terminate_pid(pid: int) -> bool:
    """Send SIGTERM (or taskkill on Windows). Returns True if sent."""
    if not _is_alive(pid):
        return False
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        else:
            os.kill(pid, signal.SIGTERM)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


# ── Port availability check ───────────────────────────────────────────────────


def _wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    """Poll until a TCP connection is accepted or timeout expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.5)
    return False


# ── Public API ────────────────────────────────────────────────────────────────


def start(
    workspace: Path,
    port: int = DASHBOARD_DEFAULT_PORT,
    host: str = "127.0.0.1",
    wait: bool = True,
) -> dict[str, Any]:
    """Start the Next.js web server and daemon.

    Returns dict with keys: web_pid, daemon_pid, port, status
    """
    pids = _read_pids(workspace)
    web_pid = pids.get("web_pid", 0)
    daemon_pid = pids.get("daemon_pid", 0)

    if _is_alive(web_pid):
        return {
            "status": "already_running",
            "web_pid": web_pid,
            "daemon_pid": daemon_pid,
            "port": port,
            "message": f"Dashboard already running (web PID {web_pid})",
        }

    dashboard_dir = _find_dashboard_dir()

    # Check pnpm is available
    pnpm = shutil.which("pnpm") or shutil.which("pnpm.cmd")
    if not pnpm:
        raise RuntimeError(
            "pnpm not found on PATH. Install with: npm install -g pnpm"
        )

    node = shutil.which("node") or shutil.which("node.exe")
    if not node:
        raise RuntimeError("node not found on PATH. Install Node.js >= 20.")

    env = {
        **os.environ,
        "CLAUDE_PROJECT_DIR": str(workspace),
        "AGENTOS_WORKSPACE": str(workspace),
        "PORT": str(port),
        "HOSTNAME": host,
    }

    # ── Spawn Next.js dev server ──────────────────────────────────────────────
    web_cmd = [pnpm, "dev", "--port", str(port)]
    web_log = workspace / ".harness" / "state" / "dashboard-web.log"
    web_log.parent.mkdir(parents=True, exist_ok=True)

    web_proc = subprocess.Popen(
        web_cmd,
        cwd=str(dashboard_dir),
        env=env,
        stdout=open(str(web_log), "a", encoding="utf-8"),  # noqa: SIM115
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    # ── Spawn daemon ──────────────────────────────────────────────────────────
    daemon_script = dashboard_dir / DAEMON_SCRIPT_RELATIVE
    daemon_pid_val = 0
    daemon_proc: subprocess.Popen[bytes] | None = None

    if daemon_script.exists():
        daemon_log = workspace / ".harness" / "state" / "dashboard-daemon.log"
        daemon_proc = subprocess.Popen(
            [node, str(daemon_script)],
            cwd=str(workspace),
            env=env,
            stdout=open(str(daemon_log), "a", encoding="utf-8"),  # noqa: SIM115
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
        )
        daemon_pid_val = daemon_proc.pid

    _write_pids(workspace, {
        "web_pid": web_proc.pid,
        "daemon_pid": daemon_pid_val,
        "port": port,
        "host": host,
        "dashboard_dir": str(dashboard_dir),
        "started_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })

    result: dict[str, Any] = {
        "status": "started",
        "web_pid": web_proc.pid,
        "daemon_pid": daemon_pid_val,
        "port": port,
        "host": host,
        "url": f"http://{host}:{port}",
        "log": str(web_log),
    }

    if wait:
        ready = _wait_for_port(host, port, timeout=60.0)
        result["ready"] = ready
        if not ready:
            result["status"] = "started_not_ready"
            result["message"] = (
                f"Process started (PID {web_proc.pid}) but port {port} "
                "is not accepting connections yet. Check the log."
            )
    return result


def stop(workspace: Path) -> dict[str, Any]:
    """Stop the web server and daemon."""
    pids = _read_pids(workspace)
    web_pid = pids.get("web_pid", 0)
    daemon_pid = pids.get("daemon_pid", 0)

    stopped: list[str] = []
    not_running: list[str] = []

    if web_pid and _terminate_pid(web_pid):
        stopped.append(f"web (PID {web_pid})")
    else:
        not_running.append("web")

    if daemon_pid and _terminate_pid(daemon_pid):
        stopped.append(f"daemon (PID {daemon_pid})")
    else:
        not_running.append("daemon")

    _clear_pids(workspace)
    return {
        "status": "stopped" if stopped else "not_running",
        "stopped": stopped,
        "not_running": not_running,
    }


def status(workspace: Path) -> dict[str, Any]:
    """Return liveness status of the web server and daemon."""
    pids = _read_pids(workspace)
    web_pid = pids.get("web_pid", 0)
    daemon_pid = pids.get("daemon_pid", 0)
    port = pids.get("port", DASHBOARD_DEFAULT_PORT)
    host = pids.get("host", "127.0.0.1")

    web_alive = _is_alive(web_pid) if web_pid else False
    daemon_alive = _is_alive(daemon_pid) if daemon_pid else False

    return {
        "running": web_alive,
        "web_pid": web_pid if web_alive else None,
        "daemon_pid": daemon_pid if daemon_alive else None,
        "port": port,
        "host": host,
        "url": f"http://{host}:{port}" if web_alive else None,
        "started_at": pids.get("started_at"),
    }
