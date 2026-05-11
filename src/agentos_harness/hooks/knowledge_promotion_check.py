#!/usr/bin/env python3
"""PostToolUse hook that records pending wiki semantic-maintenance work.

This hook fires on Edit/Write tool completions and queues maintenance backlog
entries when harness-relevant paths change. This enables the wiki to stay
synchronized with changes to hooks, skills, commands, and project artifacts.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _detect_workspace_root() -> Path:
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".harness").exists() or (parent / ".claude").exists():
            return parent
    return cwd


def _backlog_path(workspace: Path) -> Path:
    harness_dir = workspace / ".harness"
    if harness_dir.exists():
        return harness_dir / "state" / "wiki_maintenance_backlog.json"
    claude_dir = workspace / ".claude"
    if claude_dir.exists():
        return claude_dir / "state" / "curation" / "wiki_maintenance_backlog.json"
    return harness_dir / "state" / "wiki_maintenance_backlog.json"


def _ensure_backlog(workspace: Path) -> Path:
    path = _backlog_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps({"version": "1.0", "items": []}, indent=2) + "\n", encoding="utf-8")
    return path


def _load_backlog(workspace: Path) -> dict:
    path = _ensure_backlog(workspace)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {"version": "1.0", "items": []}
    if not isinstance(payload, dict):
        payload = {"version": "1.0", "items": []}
    payload.setdefault("version", "1.0")
    payload.setdefault("items", [])
    if not isinstance(payload["items"], list):
        payload["items"] = []
    return payload


def _save_backlog(workspace: Path, payload: dict) -> Path:
    path = _ensure_backlog(workspace)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def _normalize_relative_path(file_path: str, workspace: Path) -> str:
    cleaned = file_path.strip()
    if not cleaned:
        return ""
    path = Path(cleaned)
    if path.is_absolute():
        try:
            return path.relative_to(workspace).as_posix()
        except ValueError:
            return cleaned
    return cleaned.lstrip("./")


def _maintenance_entry_id(source_path: str) -> str:
    digest = hashlib.sha1(source_path.encode("utf-8")).hexdigest()[:12]
    stem = Path(source_path).stem
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "source"
    return f"wiki-maint-{slug}-{digest}"


def _infer_project_name(source_path: str) -> str | None:
    match = re.match(r"projects/([^/]+)/", source_path)
    return match.group(1) if match else None


def _family_hints(source_path: str) -> list[str]:
    if source_path.startswith(".harness/hooks/") or source_path.startswith(".claude/hooks/"):
        return ["systems", "workflows", "reference"]
    if (source_path.startswith(".harness/skills/") or source_path.startswith(".claude/skills/") or
        source_path.startswith(".harness/commands/") or source_path.startswith(".claude/commands/")):
        return ["systems", "workflows", "reference"]
    if source_path.startswith(".harness/state/config/") or source_path.startswith(".claude/state/config/"):
        return ["systems", "reference"]
    hints: list[str] = ["projects"]
    if "/external/notebooks/" in source_path:
        hints.extend(["research", "evidence"])
    elif "/research/" in source_path or source_path.endswith("RESEARCH_QUESTIONS.md"):
        hints.extend(["research", "methods"])
    elif "/artifacts/" in source_path:
        hints.extend(["reference", "contracts"])
    return list(dict.fromkeys(hints))


def _trigger_details(source_path: str) -> tuple[str, str]:
    if source_path.startswith(".harness/hooks/") or source_path.startswith(".claude/hooks/"):
        return (
            "workspace_hook_changed",
            "Workspace hook changed; review whether shared wiki automation synthesis needs to be updated.",
        )
    if (source_path.startswith(".harness/skills/") or source_path.startswith(".claude/skills/") or
        source_path.startswith(".harness/commands/") or source_path.startswith(".claude/commands/")):
        return (
            "workspace_workflow_changed",
            "Workspace command or skill changed; review whether shared workflow synthesis needs to be updated.",
        )
    if source_path.startswith(".harness/state/config/") or source_path.startswith(".claude/state/config/"):
        return (
            "workspace_config_changed",
            "Workspace configuration changed; review whether shared automation synthesis needs to be updated.",
        )
    if "/external/notebooks/" in source_path:
        return (
            "external_notebook_changed",
            "Promoted notebook changed; review research synthesis, evidence backbone, and any pages that cite this notebook.",
        )
    if "/research/" in source_path:
        return (
            "research_surface_changed",
            "Project research surface changed; review whether durable wiki synthesis needs to be updated.",
        )
    return (
        "artifact_changed",
        "Project artifact changed; review whether durable wiki synthesis needs to be updated.",
    )


def _suggested_page_refs(source_path: str, project_name: str | None) -> list[str]:
    if project_name:
        return [f"projects/{project_name}"]
    if (source_path.startswith(".harness/hooks/") or source_path.startswith(".claude/hooks/") or
        source_path in {".harness/settings.json", ".claude/settings.json"}):
        return ["systems/workspace-wiki-system"]
    if (source_path.startswith(".harness/skills/") or source_path.startswith(".claude/skills/") or
        source_path.startswith(".harness/commands/") or source_path.startswith(".claude/commands/")):
        return ["systems/workspace-skills-commands-system", "systems/workspace-wiki-system"]
    if source_path.startswith(".harness/state/config/") or source_path.startswith(".claude/state/config/"):
        return ["systems/workspace-wiki-system"]
    return []


TRIGGER_PATH_SUBSTRINGS = [
    ".harness/hooks/",
    ".harness/skills/",
    ".harness/commands/",
    ".harness/state/config/",
    ".claude/hooks/",
    ".claude/skills/",
    ".claude/commands/",
    ".claude/state/config/",
    "/external/",
    "/docs/",
    "/research/",
]

TRIGGER_FILENAMES = {"HANDOFF.md", "UPDATE.txt", "README.md"}
TRIGGER_FILENAME_SUFFIXES = {"-HANDOFF.md", "-UPDATE.txt"}


def _should_queue_source(relative_path: str) -> bool:
    if relative_path.startswith(".harness/wiki/") or relative_path.startswith(".claude/wiki/"):
        return False
    if relative_path.startswith(".harness/state/runtime/") or relative_path.startswith(".claude/state/runtime/"):
        return False
    if relative_path == ".harness/state/wiki_maintenance_backlog.json":
        return False
    if relative_path == ".claude/state/curation/wiki_maintenance_backlog.json":
        return False
    if any(trigger in relative_path for trigger in TRIGGER_PATH_SUBSTRINGS):
        return True
    filename = Path(relative_path).name
    if filename in TRIGGER_FILENAMES:
        return True
    if any(filename.endswith(suffix) for suffix in TRIGGER_FILENAME_SUFFIXES):
        return True
    return False


def _upsert_backlog_entry(workspace: Path, source_path: str, tool_name: str) -> tuple[dict, bool, Path]:
    payload = _load_backlog(workspace)
    items = payload["items"]
    now = _utc_now()
    project_name = _infer_project_name(source_path)
    trigger, summary = _trigger_details(source_path)
    entry_id = _maintenance_entry_id(source_path)
    suggested_page_refs = _suggested_page_refs(source_path, project_name)

    for entry in items:
        if entry.get("id") != entry_id:
            continue
        entry["status"] = "pending"
        entry["updated_at"] = now
        entry["event_count"] = int(entry.get("event_count", 0)) + 1
        entry["last_tool_name"] = tool_name
        entry["summary"] = summary
        entry["trigger"] = trigger
        entry["project"] = project_name
        entry["source_paths"] = [source_path]
        entry["family_hints"] = _family_hints(source_path)
        entry["suggested_page_refs"] = suggested_page_refs
        entry["resolution"] = None
        path = _save_backlog(workspace, payload)
        return entry, False, path

    entry = {
        "id": entry_id,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
        "resolved_at": None,
        "trigger": trigger,
        "summary": summary,
        "project": project_name,
        "source_paths": [source_path],
        "family_hints": _family_hints(source_path),
        "suggested_page_refs": suggested_page_refs,
        "event_count": 1,
        "last_tool_name": tool_name,
        "resolution": None,
    }
    items.append(entry)
    path = _save_backlog(workspace, payload)
    return entry, True, path


def main() -> None:
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True

    if not stdin_has_data:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    tool_name = input_data.get("tool_name", "")
    if tool_name not in ("Edit", "Write"):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    tool_input = input_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "") or tool_input.get("path", "")

    workspace = _detect_workspace_root()
    relative_path = _normalize_relative_path(file_path, workspace)

    if not relative_path:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    if not _should_queue_source(relative_path):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse"}}))
        return

    entry, created, backlog_path = _upsert_backlog_entry(workspace, relative_path, tool_name)

    output = {"hookSpecificOutput": {"hookEventName": "PostToolUse"}}
    project_name = entry.get("project")
    lines = [
        "WIKI PROMOTION CHECK:",
        f"  {'Queued' if created else 'Refreshed'} semantic-maintenance backlog entry `{entry['id']}` for `{relative_path}`.",
        f"  Summary: {entry['summary']}",
    ]
    if project_name:
        lines.append(f"  Suggested starting page: `projects/{project_name}`")
    if entry.get("family_hints"):
        lines.append("  Family hints: " + ", ".join(entry["family_hints"]))
    lines.append(f"  Backlog file: `{backlog_path.relative_to(workspace).as_posix()}`")
    output["hookSpecificOutput"]["additionalContext"] = "\n".join(lines)

    print(json.dumps(output))


if __name__ == "__main__":
    main()
