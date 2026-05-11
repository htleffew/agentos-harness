"""Session dispatch — §11.2 of AGENTIC-OS-DASHBOARD-SPEC.md.

Spawns claude / codex / gemini with the preflight preamble and writes
DashboardDispatch / DashboardComplete entries to activity.jsonl.

Uses subprocess.Popen (not PM2 — see §15 item 5 resolution in implementation plan).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .preflight import Agent, build_preamble

ACTIVITY_JSONL = Path(".harness") / "state" / "activity.jsonl"


# ── Activity log helpers ──────────────────────────────────────────────────────


def _write_activity(workspace: Path, entry: dict[str, Any]) -> None:
    """Append a single JSON entry to activity.jsonl.  Silent on I/O errors."""
    path = workspace / ACTIVITY_JSONL
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    try:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def _now_ts() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── CLI argument builders ─────────────────────────────────────────────────────


def _build_command(agent: Agent, prompt: str) -> list[str]:
    """Return the argv list for the given agent and prompt."""
    if agent == "claude":
        return ["claude", "-p", prompt, "--output-format", "stream-json"]
    if agent == "codex":
        return ["codex", "-p", prompt]
    if agent == "gemini":
        return ["gemini", "--prompt", prompt]
    raise ValueError(f"Unknown agent: {agent!r}")


# ── Public API ────────────────────────────────────────────────────────────────


def dispatch_session(
    *,
    agent: Agent,
    skill_name: str,
    skill_prompt: str,
    workspace: Path,
    project: str | None = None,
) -> subprocess.Popen[bytes]:
    """Spawn an agent session with the preflight preamble.

    Writes a DashboardDispatch entry to activity.jsonl on start.
    The caller is responsible for waiting on the process and writing
    a DashboardComplete / DashboardError entry via complete_session().

    Args:
        agent:        "claude", "codex", or "gemini"
        skill_name:   Skill directory name (e.g. "planning-work")
        skill_prompt: The skill's task content
        workspace:    Absolute path to the repository root
        project:      Optional project name for project-scoped preamble

    Returns:
        A running subprocess.Popen instance.
    """
    prompt = build_preamble(
        agent=agent,
        skill_prompt=skill_prompt,
        project=project,
        workspace=workspace,
    )
    cmd = _build_command(agent, prompt)

    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(workspace)}

    proc = subprocess.Popen(
        cmd,
        cwd=str(workspace),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    _write_activity(workspace, {
        "ts": _now_ts(),
        "tool": "DashboardDispatch",
        "ok": True,
        "desc": f"skill:{skill_name}",
        "agent": agent,
        "pid": proc.pid,
    })

    return proc


def complete_session(
    *,
    workspace: Path,
    skill_name: str,
    agent: Agent,
    ok: bool,
    error: str | None = None,
) -> None:
    """Write a DashboardComplete or DashboardError entry to activity.jsonl."""
    tool = "DashboardComplete" if ok else "DashboardError"
    entry: dict[str, Any] = {
        "ts": _now_ts(),
        "tool": tool,
        "ok": ok,
        "desc": f"skill:{skill_name}",
        "agent": agent,
    }
    if error:
        entry["error"] = error
    _write_activity(workspace, entry)


def dispatch_and_wait(
    *,
    agent: Agent,
    skill_name: str,
    skill_prompt: str,
    workspace: Path,
    project: str | None = None,
    timeout: int | None = None,
) -> tuple[int, str, str]:
    """Dispatch a session and block until it completes.

    Returns (returncode, stdout, stderr).
    Writes DashboardComplete / DashboardError to activity.jsonl automatically.

    Raises subprocess.TimeoutExpired if timeout is set and exceeded.
    """
    proc = dispatch_session(
        agent=agent,
        skill_name=skill_name,
        skill_prompt=skill_prompt,
        workspace=workspace,
        project=project,
    )

    try:
        stdout_bytes, stderr_bytes = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout_bytes, stderr_bytes = proc.communicate()
        complete_session(
            workspace=workspace,
            skill_name=skill_name,
            agent=agent,
            ok=False,
            error="timeout",
        )
        raise

    ok = proc.returncode == 0
    complete_session(
        workspace=workspace,
        skill_name=skill_name,
        agent=agent,
        ok=ok,
        error=None if ok else f"exit code {proc.returncode}",
    )

    stdout = stdout_bytes.decode("utf-8", errors="replace") if stdout_bytes else ""
    stderr = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
    return proc.returncode, stdout, stderr
