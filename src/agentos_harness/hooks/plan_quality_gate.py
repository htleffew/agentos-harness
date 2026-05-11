#!/usr/bin/env python3
"""Block incomplete engineering plans before they are written."""

from __future__ import annotations

import json
import os
import re
import select
import sys
from pathlib import Path


REQUIRED_SECTIONS = (
    (r"##\s*Overview", "Overview"),
    (r"##\s*Current State", "Current State"),
    (r"##\s*Target State", "Target State"),
    (r"##\s*Engineering Quality Contract", "Engineering Quality Contract"),
    (r"##\s*Work Chunks", "Work Chunks"),
    (r"##\s*Dependency Graph", "Dependency Graph"),
    (r"##\s*Plan Review Record", "Plan Review Record"),
)

REQUIRED_CONTRACT_SUBSECTIONS = (
    "Assumptions And Ambiguity",
    "Simplicity Rationale",
    "Surgical Scope",
    "Verification Contract",
    "Final Output Requirements",
    "Narrative, Prose, And Visual Requirements",
    "Behavior, Function, Interactivity, Display, Style, Look, Feel, And Tone",
    "Context Receipt Requirements For All Agents",
)


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return {}


def _check_plan_quality(content: str) -> list[str]:
    """Check plan content for cold-reader quality. Returns list of issues."""
    issues: list[str] = []

    for pattern, name in REQUIRED_SECTIONS:
        if not re.search(pattern, content, re.IGNORECASE):
            issues.append(f"Missing {name} section")

    for name in REQUIRED_CONTRACT_SUBSECTIONS:
        if not re.search(rf"###\s*{re.escape(name)}\b", content):
            issues.append(f"Missing Engineering Quality subsection: {name}")

    if not re.search(r"###\s*(?:Multi-model|MoE) Plan Consensus Requirement\b", content):
        issues.append("Missing Engineering Quality subsection: Multi-model Plan Consensus Requirement")

    lowered = content.lower()
    if "proceed with /plan" not in lowered and "/plan ->" not in lowered:
        issues.append("Missing explicit default /plan execution chain")

    if "multi-model plan consensus" not in content and "MoE plan consensus" not in content:
        issues.append("Missing multi-model plan consensus requirement")

    if "pass if:" not in content.lower() and "verification:" not in content.lower():
        issues.append("Missing explicit pass/fail verification language")

    chunk_matches = list(re.finditer(r"###\s+(WC-\d+)[^\n]*", content))
    for match in chunk_matches:
        chunk_start = match.start()
        next_match = re.search(r"\n###\s+WC-\d+[^\n]*", content[match.end():])
        chunk_end = match.end() + next_match.start() if next_match else len(content)
        chunk_text = content[chunk_start:chunk_end]
        if not re.search(r"creates/modifies:\s*\[.+\]", chunk_text):
            issues.append(f"{match.group(1)} missing creates/modifies paths")
        if not re.search(r"verification:\s*\|", chunk_text):
            issues.append(f"{match.group(1)} missing verification block")
        if not re.search(r"status:\s*\w+", chunk_text):
            issues.append(f"{match.group(1)} missing status field")

    return issues


def main() -> int:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return 0

    try:
        event = json.load(sys.stdin)
    except Exception:
        return 0

    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})

    # Only fire on Write operations
    if tool != "Write":
        return 0

    file_path = tool_input.get("file_path", "")
    if not file_path:
        return 0

    # Only check plan files
    if "/plans/active/" not in file_path or not file_path.endswith(".md"):
        return 0

    project_dir = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()

    discipline = _load_json(project_dir / ".harness" / "config" / "discipline.json")
    if discipline.get("plan_cold_reader_gate") is False:
        return 0

    content = tool_input.get("content", "")
    if not content:
        return 0

    # Run quality checks
    issues = _check_plan_quality(content)

    if issues:
        sys.stderr.write("PLAN QUALITY GATE BLOCKED:\n")
        for issue in issues:
            sys.stderr.write(f"  - {issue}\n")
        sys.stderr.write(
            "\n"
            "A non-trivial plan must be cold-readable, define the engineering\n"
            "quality contract, and include verifiable work chunks before write.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
