#!/usr/bin/env python3
"""PreToolUse hook validating notebook structure for conformance checks.

This hook fires on Write tool with .ipynb files and validates:
- Required opening sections
- Code cell consecutive limits (Intent-Execute-Interpret pattern)
- Decision code presence
- Forbidden imports and absolute paths
- LLM prose markers
"""

from __future__ import annotations

import io
import json
import re
import select
import sys
from pathlib import Path
from typing import NamedTuple


TOTAL_CHECKS = 10


class Violation(NamedTuple):
    check_num: int
    rule_name: str
    detail: str
    cell_index: int | None
    level: str

    def format_line(self) -> str:
        loc = f" (cell index: {self.cell_index})" if self.cell_index is not None else ""
        return f"[check {self.check_num}/{TOTAL_CHECKS}] {self.rule_name}: {self.detail}{loc}"


def _detect_workspace_root() -> Path:
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".harness").exists() or (parent / ".claude").exists():
            return parent
    return cwd


def _load_policy(workspace: Path) -> dict:
    policy_paths = [
        workspace / ".harness" / "hooks" / "config" / "notebook_conformance_policy.json",
        workspace / ".claude" / "hooks" / "config" / "notebook_conformance_policy.json",
    ]
    for path in policy_paths:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
    return {
        "research_program_projects": [],
        "required_opening_sections": [
            "title", "research questions", "pipeline position",
            "surfaces under examination", "scope constraints", "methodology references",
        ],
        "valid_shape_values": [],
        "forbidden_llm_markers": [
            r"\*\*Finding:\*\*",
            r"\*\*Look at:\*\*",
            r"\*\*Why:\*\*",
            r"\*\*Note:\*\*",
            r"\*\*Observation:\*\*",
        ],
        "forbidden_import_patterns": [r"sys\.path\.insert"],
        "forbidden_absolute_paths": ["/home/", "/Users/"],
        "grace_period_allowlist": {"paths": []},
    }


def _classify_path(file_path: str, workspace: Path, policy: dict) -> str:
    rel = file_path.replace("\\", "/")
    workspace_str = str(workspace).replace("\\", "/")
    if rel.startswith(workspace_str):
        rel = rel[len(workspace_str):].lstrip("/")

    if re.search(r"projects/[^/]+/external/notebooks/", rel):
        return "external"

    rp_projects = policy.get("research_program_projects", [])
    for proj in rp_projects:
        if re.search(rf"projects/{re.escape(proj)}/internal/(research|notebooks_pending_validation|investigations)/", rel):
            return "internal_research"

    if re.search(r"projects/[^/]+/", rel):
        return "infrastructure"

    return "skip"


def _tier_level(tier: str, structural: bool, in_grace_period: bool = False) -> str:
    if in_grace_period:
        return "WARN"
    if tier == "external":
        return "BLOCK"
    if tier == "internal_research":
        return "BLOCK" if not structural else "WARN"
    return "WARN"


def _is_in_grace_period(file_path: str, workspace: Path, policy: dict) -> bool:
    allowlist = policy.get("grace_period_allowlist", {})
    if not isinstance(allowlist, dict):
        return False
    paths = allowlist.get("paths", [])
    try:
        rel = Path(file_path).relative_to(workspace).as_posix()
    except ValueError:
        rel = file_path
    return rel in paths


def _cell_source(cell: dict) -> str:
    src = cell.get("source", [])
    if isinstance(src, list):
        return "".join(src)
    return str(src)


def _is_markdown(cell: dict) -> bool:
    return cell.get("cell_type") == "markdown"


def _is_code(cell: dict) -> bool:
    return cell.get("cell_type") == "code"


def check_1_opening_cell(cells: list[dict], policy: dict, tier: str, grace: bool) -> list[Violation]:
    required = policy.get("required_opening_sections", [])
    first_md = None
    first_idx = 0
    for i, cell in enumerate(cells):
        if _is_markdown(cell):
            first_md = _cell_source(cell).lower()
            first_idx = i
            break

    if first_md is None:
        return [Violation(1, "opening-cell-structure", "no markdown cell found", None, _tier_level(tier, True, grace))]

    has_title = bool(re.search(r"^#\s+\S", _cell_source(cells[first_idx]), re.MULTILINE))

    missing = []
    if not has_title:
        missing.append("title")

    keyword_map = {
        "research questions": ["research question", "research questions"],
        "pipeline position": ["pipeline position", "pipeline"],
        "surfaces under examination": ["surfaces under examination", "inputs", "data surface"],
        "scope constraints": ["scope constraint", "scope limitation", "scope"],
        "methodology references": ["methodology reference", "methodology references", "references"],
    }
    for section in required:
        if section == "title":
            continue
        candidates = keyword_map.get(section, [section])
        if not any(kw in first_md for kw in candidates):
            missing.append(section)

    if missing:
        return [Violation(1, "opening-cell-structure", f"missing sections: {', '.join(missing)}", first_idx, _tier_level(tier, True, grace))]
    return []


def check_2_consecutive_code_cells(cells: list[dict], tier: str, grace: bool) -> list[Violation]:
    violations = []
    run_start = None
    run_len = 0
    for i, cell in enumerate(cells):
        if _is_code(cell):
            if run_len == 0:
                run_start = i
            run_len += 1
        else:
            if run_len > 2:
                violations.append(Violation(2, "intent-execute-interpret", f"{run_len} consecutive code cells", run_start, _tier_level(tier, True, grace)))
            run_len = 0
            run_start = None
    if run_len > 2:
        violations.append(Violation(2, "intent-execute-interpret", f"{run_len} consecutive code cells", run_start, _tier_level(tier, True, grace)))
    return violations


def check_3_decision_code(cells: list[dict], tier: str, grace: bool) -> list[Violation]:
    decision_re = re.compile(r"<!--\s*decision:\s*\S[^>]*-->", re.IGNORECASE)
    for cell in cells[-3:]:
        if decision_re.search(_cell_source(cell)):
            return []
    return [Violation(3, "decision-code", "no <!-- decision: CODE --> found in last cells", len(cells) - 1, _tier_level(tier, False, grace))]


def check_4_forbidden_imports(cells: list[dict], policy: dict, tier: str, grace: bool) -> list[Violation]:
    patterns = [re.compile(p) for p in policy.get("forbidden_import_patterns", [])]
    violations = []
    for i, cell in enumerate(cells):
        if not _is_code(cell):
            continue
        src = _cell_source(cell)
        for pat in patterns:
            if pat.search(src):
                violations.append(Violation(4, "forbidden-import", f"forbidden pattern {pat.pattern!r}", i, _tier_level(tier, False, grace)))
    return violations


def check_5_absolute_paths(cells: list[dict], policy: dict, tier: str, grace: bool) -> list[Violation]:
    patterns = policy.get("forbidden_absolute_paths", [])
    violations = []
    for i, cell in enumerate(cells):
        if not _is_code(cell):
            continue
        src = _cell_source(cell)
        for pattern in patterns:
            if pattern in src and "/tmp/" not in src:
                violations.append(Violation(5, "absolute-path", f"absolute path {pattern!r} in code", i, _tier_level(tier, False, grace)))
                break
    return violations


def check_6_llm_markers(cells: list[dict], policy: dict, tier: str, grace: bool) -> list[Violation]:
    raw_markers = policy.get("forbidden_llm_markers", [])
    compiled = []
    for m in raw_markers:
        try:
            compiled.append(re.compile(m))
        except re.error:
            pass

    violations = []
    for i, cell in enumerate(cells):
        if not _is_markdown(cell):
            continue
        src = _cell_source(cell)
        for pat in compiled:
            if pat.search(src):
                violations.append(Violation(6, "llm-prose-marker", f"forbidden marker {pat.pattern!r}", i, _tier_level(tier, False, grace)))
    return violations


def validate_notebook(nb: dict, file_path: str, workspace: Path, policy: dict) -> tuple[list[Violation], str]:
    tier = _classify_path(file_path, workspace, policy)
    if tier == "skip":
        return [], tier

    cells = nb.get("cells", [])
    if len(cells) < 3:
        return [], tier

    grace = _is_in_grace_period(file_path, workspace, policy)

    violations: list[Violation] = []
    violations.extend(check_1_opening_cell(cells, policy, tier, grace))
    violations.extend(check_2_consecutive_code_cells(cells, tier, grace))
    violations.extend(check_3_decision_code(cells, tier, grace))
    violations.extend(check_4_forbidden_imports(cells, policy, tier, grace))
    violations.extend(check_5_absolute_paths(cells, policy, tier, grace))
    violations.extend(check_6_llm_markers(cells, policy, tier, grace))

    return violations, tier


def _emit_hook_block(violations: list[Violation]) -> None:
    lines = [v.format_line() for v in violations if v.level == "BLOCK"]
    reason = "NOTEBOOK CONFORMANCE BLOCK:\n" + "\n".join(f"  {l}" for l in lines)
    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(output))


def _emit_hook_warn(violations: list[Violation]) -> None:
    lines = [v.format_line() for v in violations if v.level == "WARN"]
    if lines:
        print("NOTEBOOK CONFORMANCE WARNINGS:", file=sys.stderr)
        for l in lines:
            print(f"  {l}", file=sys.stderr)


def main() -> None:
    try:
        stdin_has_data = select.select([sys.stdin], [], [], 0.0)[0]
    except (OSError, io.UnsupportedOperation):
        stdin_has_data = True

    if not stdin_has_data:
        sys.exit(0)

    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_name = event.get("tool_name", "")
    if tool_name != "Write":
        sys.exit(0)

    tool_input = event.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    if not file_path.endswith(".ipynb"):
        sys.exit(0)

    workspace = _detect_workspace_root()
    policy = _load_policy(workspace)

    tier = _classify_path(file_path, workspace, policy)
    if tier == "skip":
        sys.exit(0)

    content = tool_input.get("content", "")
    try:
        nb = json.loads(content)
        if not isinstance(nb, dict) or "cells" not in nb:
            sys.exit(0)
    except (json.JSONDecodeError, TypeError):
        sys.exit(0)

    violations, tier = validate_notebook(nb, file_path, workspace, policy)
    block = [v for v in violations if v.level == "BLOCK"]
    warn = [v for v in violations if v.level == "WARN"]

    if block:
        _emit_hook_block(block)
        sys.exit(0)

    if warn:
        _emit_hook_warn(warn)

    sys.exit(0)


if __name__ == "__main__":
    main()
