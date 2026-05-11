"""Adaptive setup modules selected from deterministic repository signals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


Predicate = Callable[[dict[str, Any]], bool]
Reason = Callable[[dict[str, Any]], str]
Targets = Callable[[dict[str, Any]], dict[str, str]]


@dataclass(frozen=True)
class SetupModule:
    id: str
    name: str
    command: str
    skill: str
    selected_reason: Reason
    rejection_reason: Reason
    predicate: Predicate
    targets: Targets


def selected_modules(analysis: dict[str, Any]) -> list[dict[str, str]]:
    return [
        _module_metadata(module, analysis, selected=True)
        for module in SETUP_MODULES
        if module.predicate(analysis)
    ]


def unselected_modules(analysis: dict[str, Any]) -> list[dict[str, str]]:
    return [
        _module_metadata(module, analysis, selected=False)
        for module in SETUP_MODULES
        if not module.predicate(analysis)
    ]


def selected_module_ids(analysis: dict[str, Any]) -> list[str]:
    return [module["id"] for module in selected_modules(analysis)]


def render_module_targets(analysis: dict[str, Any]) -> dict[str, str]:
    targets: dict[str, str] = {}
    for module in SETUP_MODULES:
        if module.predicate(analysis):
            for path, content in module.targets(analysis).items():
                if path in targets:
                    raise ValueError(f"duplicate adaptive module target: {path}")
                targets[path] = content
    if selected_module_ids(analysis):
        targets[".claude/hooks/post/setup_rescan_reminder.py"] = setup_rescan_hook()
    return dict(sorted(targets.items()))


def module_source_for_hash() -> list[dict[str, str]]:
    return [
        {
            "id": module.id,
            "name": module.name,
            "command": module.command,
            "skill": module.skill,
        }
        for module in SETUP_MODULES
    ]


def _module_metadata(module: SetupModule, analysis: dict[str, Any], *, selected: bool) -> dict[str, str]:
    return {
        "id": module.id,
        "name": module.name,
        "command": module.command,
        "skill": module.skill,
        "status": "selected" if selected else "unselected",
        "reason": module.selected_reason(analysis) if selected else module.rejection_reason(analysis),
    }


def _inventory(analysis: dict[str, Any]) -> dict[str, Any]:
    return analysis.get("inventory", {})


def _languages(analysis: dict[str, Any]) -> set[str]:
    return set(_inventory(analysis).get("languages", []))


def _package_managers(analysis: dict[str, Any]) -> set[str]:
    return set(_inventory(analysis).get("package_managers", []))


def _files(analysis: dict[str, Any]) -> list[str]:
    return list(analysis.get("files", []))


def _join(values: list[str], empty: str) -> str:
    return ", ".join(values) if values else empty


def _detected_test_commands(analysis: dict[str, Any], fallback: str) -> str:
    return _join(_inventory(analysis).get("test_commands", []), fallback)


def _detected_build_commands(analysis: dict[str, Any], fallback: str) -> str:
    return _join(_inventory(analysis).get("build_commands", []), fallback)


def _wiki_document(
    title: str,
    summary: str,
    body: str,
    *,
    source_artifacts: list[str] | None = None,
    related_pages: list[str] | None = None,
) -> str:
    sources = source_artifacts or [".harness/state/analysis.json"]
    related = related_pages or [
        "[Repository Overview](../repository-overview.md)",
        "[Local Development Workflow](local-development.md)",
    ]
    source_lines = "\n".join(f"- `{source}`" for source in sources)
    related_lines = "\n".join(f"- {page}" for page in related)
    return f"""# {title}

## Summary

{summary.strip()}

{body.strip()}

## Authority And Recency

- Current authority: `{sources[0]}` for detected repository signals.
- Recency rule: rerun `harness setup . --dry-run` after repository structure or validation signals change.

## Source Artifacts

{source_lines}

## Related Pages

{related_lines}
"""


def _skill(name: str, trigger: str, instructions: str, verification: str) -> str:
    return f"""---\nname: {name}\ndescription: {trigger}\n---\n\n# {name}\n\n## When To Use\n\n{trigger}\n\n## Instructions\n\n{instructions}\n\n## Verification\n\n{verification}\n"""


def _command(command: str, skill: str, description: str) -> str:
    return f"""---\nname: {command}\ndescription: {description}\n---\n\n# /{command}\n\nUse `.claude/skills/{skill}/SKILL.md` for workflow instructions.\n\nRequired first reads:\n\n1. `AGENTS.md`\n2. `.claude/wiki/index.md`\n3. `.claude/skills/{skill}/SKILL.md`\n\nExpected result: {description}\n"""


def _python_selected(analysis: dict[str, Any]) -> bool:
    return "Python" in _languages(analysis) or "python" in _package_managers(analysis) or any(path.endswith("pyproject.toml") for path in _files(analysis))


def _typescript_selected(analysis: dict[str, Any]) -> bool:
    languages = _languages(analysis)
    managers = _package_managers(analysis)
    return bool({"TypeScript", "JavaScript"} & languages) or bool({"npm", "pnpm", "yarn"} & managers)


def _notebook_selected(analysis: dict[str, Any]) -> bool:
    return bool(_inventory(analysis).get("notebooks", []))


def _docs_selected(analysis: dict[str, Any]) -> bool:
    inventory = _inventory(analysis)
    return bool(inventory.get("docs", [])) or bool(inventory.get("publication_dirs", []))


def _ci_selected(analysis: dict[str, Any]) -> bool:
    return bool(_inventory(analysis).get("ci_files", []))


def _monorepo_selected(analysis: dict[str, Any]) -> bool:
    return len(_inventory(analysis).get("project_boundaries", [])) > 1


def _python_targets(analysis: dict[str, Any]) -> dict[str, str]:
    tests = _detected_test_commands(analysis, "python -m pytest")
    return {
        ".claude/wiki/wiki/workflows/python-package.md": _wiki_document(
            "Python Package Workflow",
            "The repository has Python package signals.",
            f"""
## Commands

- Tests: {tests}

## Operating Rules

- Run the detected test command after Python source changes.
- Keep generated harness state under `.harness/state/`.
- Update `.claude/wiki/` when package structure or validation commands change.
""",
            source_artifacts=[".harness/state/analysis.json", "pyproject.toml", "requirements.txt"],
        ),
        ".claude/skills/python-package/SKILL.md": _skill(
            "python-package",
            "Use when Python source, packaging, or tests change.",
            f"Run `{tests}` after relevant code changes. Check `pyproject.toml`, `requirements.txt`, and `src/` before changing package behavior.",
            "Record the command, result, and changed files.",
        ),
        ".claude/commands/python-test.md": _command("python-test", "python-package", "Run the detected Python validation command and report failures."),
    }


def _typescript_targets(analysis: dict[str, Any]) -> dict[str, str]:
    tests = _detected_test_commands(analysis, "npm test")
    builds = _detected_build_commands(analysis, "npm run build")
    return {
        ".claude/wiki/wiki/workflows/typescript-app.md": _wiki_document(
            "TypeScript Application Workflow",
            "The repository has JavaScript or TypeScript package signals.",
            f"""
## Commands

- Tests: {tests}
- Builds: {builds}

## Operating Rules

- Run detected package-script validation after source changes.
- Keep dependency and lockfile edits explicit in change summaries.
""",
            source_artifacts=[".harness/state/analysis.json", "package.json"],
        ),
        ".claude/skills/typescript-app/SKILL.md": _skill(
            "typescript-app",
            "Use when JavaScript or TypeScript source, package scripts, or build files change.",
            f"Run `{tests}` and `{builds}` when relevant. Inspect `package.json` before changing scripts or generated commands.",
            "Record command results and any skipped command with the reason.",
        ),
        ".claude/commands/typescript-check.md": _command("typescript-check", "typescript-app", "Run detected JavaScript or TypeScript checks and report failures."),
    }


def _notebook_targets(analysis: dict[str, Any]) -> dict[str, str]:
    notebooks = _inventory(analysis).get("notebooks", [])
    notebook_list = _join(notebooks, "No notebooks listed")
    return {
        ".claude/wiki/wiki/workflows/notebook-workspace.md": _wiki_document(
            "Notebook Workspace Workflow",
            "The repository contains notebooks.",
            f"""
## Detected Notebooks

{notebook_list}

## Operating Rules

- Keep notebook outputs appropriate for the repository audience.
- Record assumptions and validation commands near the notebook that uses them.
""",
            source_artifacts=[".harness/state/analysis.json"],
        ),
        ".claude/skills/notebook-workspace/SKILL.md": _skill(
            "notebook-workspace",
            "Use when notebooks are created, executed, reviewed, or prepared for handoff.",
            "Inspect the notebook path, supporting data files, and README guidance before editing. Keep generated support state under `.harness/state/`.",
            "Confirm the notebook opens, has clear markdown context, and does not add sensitive flat-file outputs.",
        ),
        ".claude/commands/notebook-workflow.md": _command("notebook-workflow", "notebook-workspace", "Review notebook structure, execution status, and handoff readiness."),
    }


def _docs_targets(analysis: dict[str, Any]) -> dict[str, str]:
    docs = _join(_inventory(analysis).get("docs", []), "No docs listed")
    return {
        ".claude/wiki/wiki/workflows/docs-site.md": _wiki_document(
            "Documentation Workflow",
            "The repository has documentation or publication directories.",
            f"""
## Detected Documentation

{docs}

## Operating Rules

- Keep docs aligned with source behavior.
- Run local preview or build commands when available before handoff.
""",
            source_artifacts=[".harness/state/analysis.json"],
        ),
        ".claude/skills/docs-site/SKILL.md": _skill(
            "docs-site",
            "Use when README, docs, site, or external documentation changes.",
            "Read nearby source files before changing documentation claims. Keep setup, rollback, and preview commands exact.",
            "Confirm changed documentation has no broken local links and names the command a reader should run next.",
        ),
        ".claude/commands/docs-maintain.md": _command("docs-maintain", "docs-site", "Review documentation changes for accuracy, links, and next commands."),
    }


def _ci_targets(analysis: dict[str, Any]) -> dict[str, str]:
    ci_files = _join(_inventory(analysis).get("ci_files", []), "No CI files listed")
    return {
        ".claude/wiki/wiki/workflows/ci-release.md": _wiki_document(
            "CI Release Workflow",
            "The repository has CI configuration.",
            f"""
## Detected CI Files

{ci_files}

## Operating Rules

- Check CI configuration before changing release-sensitive files.
- Do not publish, tag, or push without explicit human approval.
""",
            source_artifacts=[".harness/state/analysis.json"],
        ),
        ".claude/skills/ci-release/SKILL.md": _skill(
            "ci-release",
            "Use when CI, release, packaging, or deployment files change.",
            f"Inspect these CI files before release-sensitive changes: {ci_files}. Do not publish irreversible changes without approval.",
            "Record local validation and identify any CI-only check that could not run locally.",
        ),
        ".claude/commands/ci-release.md": _command("ci-release", "ci-release", "Review CI and release readiness without publishing changes."),
    }


def _monorepo_targets(analysis: dict[str, Any]) -> dict[str, str]:
    boundaries = _join(_inventory(analysis).get("project_boundaries", []), "Repository root")
    return {
        ".claude/wiki/wiki/workflows/monorepo-boundaries.md": _wiki_document(
            "Monorepo Boundary Workflow",
            "The repository has multiple project boundaries.",
            f"""
## Detected Boundaries

{boundaries}

## Operating Rules

- Identify the owning boundary before editing.
- Run validation for every affected boundary.
- Keep generated harness state at the repository root unless a human chooses a different target.
""",
            source_artifacts=[".harness/state/analysis.json"],
        ),
        ".claude/skills/monorepo/SKILL.md": _skill(
            "monorepo",
            "Use when work touches more than one detected package or project boundary.",
            f"Identify impacted boundaries before editing. Detected boundaries: {boundaries}. Keep change summaries grouped by boundary.",
            "Record the boundaries changed and the validation command run for each boundary.",
        ),
        ".claude/commands/monorepo-status.md": _command("monorepo-status", "monorepo", "Summarize detected project boundaries and validation needs."),
    }


def _selected_reason(label: str) -> Reason:
    return lambda _analysis: label


def _rejection_reason(label: str) -> Reason:
    return lambda _analysis: label


SETUP_MODULES: tuple[SetupModule, ...] = (
    SetupModule(
        id="ci-release",
        name="CI Release",
        command="ci-release",
        skill="ci-release",
        selected_reason=_selected_reason("CI files were detected."),
        rejection_reason=_rejection_reason("No CI configuration files were detected."),
        predicate=_ci_selected,
        targets=_ci_targets,
    ),
    SetupModule(
        id="docs-site",
        name="Documentation",
        command="docs-maintain",
        skill="docs-site",
        selected_reason=_selected_reason("Documentation or publication directories were detected."),
        rejection_reason=_rejection_reason("No documentation or publication directories were detected."),
        predicate=_docs_selected,
        targets=_docs_targets,
    ),
    SetupModule(
        id="monorepo",
        name="Monorepo Boundaries",
        command="monorepo-status",
        skill="monorepo",
        selected_reason=_selected_reason("More than one project boundary was detected."),
        rejection_reason=_rejection_reason("Only one project boundary was detected."),
        predicate=_monorepo_selected,
        targets=_monorepo_targets,
    ),
    SetupModule(
        id="notebook-workspace",
        name="Notebook Workspace",
        command="notebook-workflow",
        skill="notebook-workspace",
        selected_reason=_selected_reason("Notebook files were detected."),
        rejection_reason=_rejection_reason("No notebook files were detected."),
        predicate=_notebook_selected,
        targets=_notebook_targets,
    ),
    SetupModule(
        id="python-package",
        name="Python Package",
        command="python-test",
        skill="python-package",
        selected_reason=_selected_reason("Python package signals were detected."),
        rejection_reason=_rejection_reason("No Python package signals were detected."),
        predicate=_python_selected,
        targets=_python_targets,
    ),
    SetupModule(
        id="typescript-app",
        name="TypeScript Application",
        command="typescript-check",
        skill="typescript-app",
        selected_reason=_selected_reason("JavaScript or TypeScript package signals were detected."),
        rejection_reason=_rejection_reason("No JavaScript or TypeScript package signals were detected."),
        predicate=_typescript_selected,
        targets=_typescript_targets,
    ),
)


def setup_rescan_hook() -> str:
    return """#!/usr/bin/env python3
\"\"\"Record setup rescan reminders after repository boundary changes.\"\"\"

from __future__ import annotations

import json
import os
import select
import sys
from datetime import datetime, timezone
from pathlib import Path


def read_event() -> dict:
    if not select.select([sys.stdin], [], [], 0.0)[0]:
        return {}
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


event = read_event()
if not event:
    raise SystemExit(0)

if event.get("tool_name") not in {"Edit", "Write", "Bash"}:
    raise SystemExit(0)

payload = json.dumps(event.get("tool_input", {}), sort_keys=True)
markers = (
    "pyproject.toml",
    "package.json",
    "requirements.txt",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".github/workflows/",
    "docs/",
    "external/",
    "src/",
    ".ipynb",
)
if not any(marker in payload for marker in markers):
    raise SystemExit(0)

root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()
state_dir = root / ".harness" / "state"
state_dir.mkdir(parents=True, exist_ok=True)
record = {
    "at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "suggested_action": "Run harness setup . --dry-run because repository structure or validation signals may have changed.",
}
with (state_dir / "setup_rescan_reminders.jsonl").open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, sort_keys=True) + "\\n")
"""
