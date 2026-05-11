"""
dashboard_cli.py — `harness dashboard` subcommand implementation.

Registered in the harness CLI as:
    harness dashboard install .
    harness dashboard start [--prod]
    harness dashboard stop
    harness dashboard status
    harness dashboard upgrade

All operations target the `dashboard/` directory inside the workspace's
agentos-harness module (located relative to this file).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional


DASHBOARD_DIR_NAME = "dashboard"


def _find_dashboard_dir(workspace: Path) -> Optional[Path]:
    """Return the dashboard/ dir, searching workspace then adjacent agentos-harness."""
    candidates = [
        workspace / DASHBOARD_DIR_NAME,
        workspace / "agentos-harness" / DASHBOARD_DIR_NAME,
        Path(__file__).parent.parent.parent / DASHBOARD_DIR_NAME,  # relative to this file
    ]
    for c in candidates:
        if (c / "package.json").exists():
            return c
    return None


def _read_pids(workspace: Path) -> dict:
    pids_file = workspace / ".harness" / "state" / "dashboard-pids.json"
    if not pids_file.exists():
        return {}
    try:
        return json.loads(pids_file.read_text())
    except Exception:
        return {}


def _write_pids(workspace: Path, data: dict) -> None:
    pids_file = workspace / ".harness" / "state" / "dashboard-pids.json"
    pids_file.parent.mkdir(parents=True, exist_ok=True)
    pids_file.write_text(json.dumps(data, indent=2))


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError, OSError):
        return False


def cmd_install(workspace: Path) -> int:
    """Install (or reinstall) dashboard dependencies."""
    dashboard = _find_dashboard_dir(workspace)
    if not dashboard:
        print(f"ERROR: dashboard/ not found under {workspace}", file=sys.stderr)
        return 1

    print(f"Installing dashboard dependencies in {dashboard}…")
    r = subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=dashboard)
    if r.returncode != 0:
        print("ERROR: pnpm install failed", file=sys.stderr)
        return 1

    print("Building dashboard for production…")
    r = subprocess.run(["pnpm", "run", "build"], cwd=dashboard,
                       env={**os.environ, "CLAUDE_PROJECT_DIR": str(workspace), "AGENTOS_WORKSPACE": str(workspace)})
    if r.returncode != 0:
        print("ERROR: pnpm build failed", file=sys.stderr)
        return 1

    print("✓ Dashboard installed successfully.")
    print(f"  Run: harness dashboard start")
    return 0


def cmd_start(workspace: Path, prod: bool = False) -> int:
    """Start the dashboard web server and daemon."""
    dashboard = _find_dashboard_dir(workspace)
    if not dashboard:
        print(f"ERROR: dashboard/ not found", file=sys.stderr)
        return 1

    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(workspace), "AGENTOS_WORKSPACE": str(workspace)}
    port = os.environ.get("AGENTOS_PORT", "8768")

    pids: dict = {}

    if prod:
        # Production: try PM2 first, fall back to direct subprocess
        if shutil.which("pm2"):
            r = subprocess.run(["pm2", "start", "ecosystem.config.js", "--env", "production"], cwd=dashboard, env=env)
            if r.returncode == 0:
                print(f"✓ Dashboard started via PM2 at http://localhost:{port}")
                return 0
        # Fall back to direct subprocesses
        script = "start"
    else:
        script = "dev"

    # Start web server
    web_log = workspace / ".harness" / "state" / "dashboard-web.log"
    web_log.parent.mkdir(parents=True, exist_ok=True)
    with open(web_log, "a") as fout:
        web_proc = subprocess.Popen(
            ["pnpm", "run", script],
            cwd=dashboard, env=env,
            stdout=fout, stderr=fout,
        )
    pids["web"] = web_proc.pid
    print(f"✓ Web server started (PID {web_proc.pid}) at http://localhost:{port}")

    # Compile and start daemon
    daemon_ts = dashboard / "scripts" / "daemon" / "index.ts"
    daemon_js = dashboard / "scripts" / "daemon" / "index.js"

    if daemon_ts.exists() and (not daemon_js.exists() or daemon_ts.stat().st_mtime > daemon_js.stat().st_mtime):
        print("  Compiling daemon…")
        subprocess.run(["pnpm", "exec", "tsc", str(daemon_ts), "--module", "commonjs", "--outDir",
                        str(daemon_js.parent), "--esModuleInterop", "--skipLibCheck"], cwd=dashboard, env=env)

    if daemon_js.exists():
        daemon_log = workspace / ".harness" / "state" / "dashboard-daemon.log"
        with open(daemon_log, "a") as fout:
            daemon_proc = subprocess.Popen(["node", str(daemon_js)], cwd=dashboard, env=env, stdout=fout, stderr=fout)
        pids["daemon"] = daemon_proc.pid
        print(f"✓ Daemon started (PID {daemon_proc.pid})")
    else:
        print("  Daemon JS not found, skipping.")

    _write_pids(workspace, {"pids": pids, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    return 0


def cmd_stop(workspace: Path) -> int:
    """Stop the dashboard processes."""
    data = _read_pids(workspace)
    pids = data.get("pids", {})
    if not pids:
        print("No dashboard processes found in state file.")
        # Try PM2 anyway
        if shutil.which("pm2"):
            subprocess.run(["pm2", "stop", "agentos-dashboard-web", "agentos-dashboard-daemon"])
        return 0

    for name, pid in pids.items():
        try:
            import signal
            os.kill(pid, signal.SIGTERM)
            print(f"✓ Stopped {name} (PID {pid})")
        except Exception as e:
            print(f"  Could not stop {name} (PID {pid}): {e}")

    _write_pids(workspace, {})
    return 0


def cmd_status(workspace: Path) -> int:
    """Show dashboard process status."""
    port = os.environ.get("AGENTOS_PORT", "8768")
    data = _read_pids(workspace)
    pids = data.get("pids", {})

    if not pids:
        print("Dashboard: not running")
        return 0

    print(f"Dashboard status (started {data.get('startedAt', 'unknown')}):")
    for name, pid in pids.items():
        alive = _is_pid_alive(pid)
        status = "running" if alive else "dead"
        print(f"  {name:12s} PID={pid}  [{status}]")
    print(f"\n  URL: http://localhost:{port}")
    return 0


def cmd_upgrade(workspace: Path) -> int:
    """Stop, pull latest, rebuild, restart."""
    print("Stopping dashboard…")
    cmd_stop(workspace)
    print("Rebuilding…")
    ret = cmd_install(workspace)
    if ret != 0:
        return ret
    print("Restarting…")
    return cmd_start(workspace, prod=True)


def dashboard_main(args: list[str], workspace: Path) -> int:
    """Entry point called by harness CLI dispatch."""
    if not args:
        print("Usage: harness dashboard <install|start|stop|status|upgrade> [options]")
        return 0

    subcmd = args[0]
    rest = args[1:]

    if subcmd == "install":
        return cmd_install(workspace)
    elif subcmd == "start":
        prod = "--prod" in rest
        return cmd_start(workspace, prod=prod)
    elif subcmd == "stop":
        return cmd_stop(workspace)
    elif subcmd == "status":
        return cmd_status(workspace)
    elif subcmd == "upgrade":
        return cmd_upgrade(workspace)
    else:
        print(f"Unknown subcommand: {subcmd}", file=sys.stderr)
        return 1
