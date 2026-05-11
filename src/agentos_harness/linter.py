"""Harness integrity linter."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .wiki_validator import ValidationResult, validate_wiki_structure


@dataclass
class LintResult:
    check: str
    status: Literal["pass", "fail", "warn"]
    message: str
    details: list[str] = field(default_factory=list)


def _is_distributable_harness_package_source(root: Path) -> bool:
    """Return True for this package source tree before setup is applied."""
    pyproject = root / "pyproject.toml"
    package_dir = root / "src" / "agentos_harness"
    if not pyproject.exists() or not package_dir.is_dir():
        return False
    try:
        content = pyproject.read_text(encoding="utf-8")
    except OSError:
        return False
    return 'name = "agentos-harness"' in content or 'name = "distributable-harness"' in content


def _not_applicable(check: str, message: str) -> LintResult:
    return LintResult(check, "pass", f"Not applicable: {message}")


def check_wiki_index(root: Path) -> LintResult:
    """Check wiki structure using the wiki_validator module.

    Returns warn if no wiki found, fail if structural errors, pass if valid.
    """
    if _is_distributable_harness_package_source(root):
        return _not_applicable(
            "Wiki Index",
            "package source tree has no applied generated wiki contract",
        )

    wiki_root = root / ".claude" / "wiki"
    if not wiki_root.exists():
        return LintResult(
            "Wiki Index", "warn",
            "No wiki found. Run: harness wiki init .",
        )

    settings_path = root / ".claude" / "state" / "config" / "wiki_settings.json"
    if not settings_path.exists():
        validation_results = validate_wiki_structure(root)
    else:
        from .wiki import load_wiki_settings

        settings = load_wiki_settings(root)
        validation_results = validate_wiki_structure(
            root,
            wiki_subpath=settings.get("wiki_root", ".claude/wiki"),
            families=settings.get("wiki_families"),
            required_sections=settings.get("page_required_sections"),
            max_source_artifacts=settings.get("max_source_artifacts_per_page", 9),
        )

    errors = [r for r in validation_results if r.status == "error"]
    if errors:
        details = [f"{r.check}: {r.message}" for r in errors]
        return LintResult(
            "Wiki Index", "fail",
            f"{len(errors)} wiki error(s): {errors[0].message}",
            details=details,
        )

    warnings = [r for r in validation_results if r.status == "warn"]
    if warnings:
        details = [f"{r.check}: {r.message}" for r in warnings]
        return LintResult(
            "Wiki Index", "warn",
            f"{len(warnings)} wiki warning(s)",
            details=details,
        )

    pass_count = len([r for r in validation_results if r.status == "pass"])
    return LintResult(
        "Wiki Index", "pass",
        f"Wiki structure valid ({pass_count} check(s) passed)",
    )


def check_skill_compliance(root: Path) -> LintResult:
    from .audit import audit_skills_dir, audit_has_errors

    if _is_distributable_harness_package_source(root):
        return _not_applicable(
            "Skill Compliance",
            "package source tree has no applied generated skill directory",
        )

    skills_dir = root / ".claude" / "skills"
    if not skills_dir.exists():
        return LintResult(
            "Skill Compliance", "warn",
            "No .claude/skills/ found -- run harness setup . --apply first",
        )

    findings = audit_skills_dir(skills_dir)
    errors = [f for f in findings if f["severity"] == "error"]
    skill_dirs = {f["file"] for f in findings}
    skill_count = len(list(skills_dir.glob("*/SKILL.md")))

    if errors:
        details = [
            f"[ERROR] {e['rule']}: {e['message']} in {Path(e['file']).name}"
            for e in errors
        ]
        return LintResult(
            "Skill Compliance", "fail",
            f"{skill_count} skill(s), {len(errors)} error(s)",
            details=details,
        )
    return LintResult(
        "Skill Compliance", "pass",
        f"{skill_count} skill(s), 0 errors",
    )


def check_hook_registration(root: Path) -> LintResult:
    if _is_distributable_harness_package_source(root):
        return _not_applicable(
            "Hook Registration",
            "package source tree has no applied generated hook settings",
        )

    settings_path = root / ".claude" / "settings.json"
    if not settings_path.exists():
        return LintResult(
            "Hook Registration", "warn",
            "No .claude/settings.json found -- run harness setup . --apply first",
        )

    try:
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return LintResult(
            "Hook Registration", "warn",
            "Could not parse .claude/settings.json",
        )

    py_path_re = re.compile(r'\.claude/hooks/[^\s"\']+\.py')
    expected_paths: list[Path] = []

    def _walk_hooks(obj: object) -> None:
        if isinstance(obj, dict):
            cmd = obj.get("command", "")
            if isinstance(cmd, str):
                for match in py_path_re.findall(cmd):
                    expected_paths.append(root / match)
            for v in obj.values():
                _walk_hooks(v)
        elif isinstance(obj, list):
            for item in obj:
                _walk_hooks(item)

    _walk_hooks(settings.get("hooks", {}))

    missing = [p for p in expected_paths if not p.exists()]
    if missing:
        details = [f"Missing hook file: {p.relative_to(root)}" for p in missing]
        return LintResult(
            "Hook Registration", "fail",
            f"{len(expected_paths)} hook file(s) registered, {len(missing)} missing",
            details=details,
        )
    return LintResult(
        "Hook Registration", "pass",
        f"{len(expected_paths)} hook file(s) registered, all present",
    )


def check_wiki_reminders(root: Path) -> LintResult:
    THRESHOLD = 5
    reminders_path = root / ".harness" / "state" / "wiki_reminders.jsonl"
    if not reminders_path.exists():
        return LintResult("Wiki Reminders", "pass", "0 pending reminders")

    unique_paths: set[str] = set()
    for line in reminders_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            unique_paths.add(entry.get("source_path", ""))
        except Exception:
            pass

    count = len(unique_paths)
    if count > THRESHOLD:
        return LintResult(
            "Wiki Reminders", "warn",
            f"{count} pending reminders (threshold {THRESHOLD}) -- run /wiki to address",
            details=sorted(unique_paths),
        )
    return LintResult("Wiki Reminders", "pass", f"{count} pending reminder(s)")


def check_dashboard_config(root: Path) -> LintResult:
    """§12.3: Verify .harness/config/dashboard.json exists, is valid, and skill paths resolve.

    - warn  if dashboard.json absent (dashboard module not yet installed)
    - fail  if present but not valid JSON
    - fail  if present but fails field-level constraints
    - fail  if any referenced pinnedSkill path cannot be found
    - pass  otherwise
    """
    import json as _json

    config_path = root / ".harness" / "config" / "dashboard.json"
    if not config_path.exists():
        return LintResult(
            "Dashboard Config",
            "warn",
            "dashboard.json not found — run: harness dashboard install .",
        )

    try:
        raw = config_path.read_text(encoding="utf-8")
        cfg = _json.loads(raw)
    except _json.JSONDecodeError as exc:
        return LintResult(
            "Dashboard Config",
            "fail",
            f"dashboard.json is not valid JSON: {exc}",
        )
    if not isinstance(cfg, dict):
        return LintResult(
            "Dashboard Config", "fail", "dashboard.json must be a JSON object"
        )

    errors: list[str] = []

    # Port
    port = cfg.get("port", 8768)
    if not isinstance(port, int) or not (1024 <= port <= 65535):
        errors.append(f"port must be integer 1024–65535, got {port!r}")

    # Theme
    theme = cfg.get("theme", "dark")
    if theme != "dark":
        errors.append(f"theme must be 'dark', got {theme!r}")

    # domainOrder
    domain_order = cfg.get("domainOrder", [])
    if not isinstance(domain_order, list) or not domain_order:
        errors.append("domainOrder must be a non-empty list")

    # concurrencyLimit
    cl = cfg.get("concurrencyLimit", 2)
    if not isinstance(cl, int) or not (1 <= cl <= 16):
        errors.append(f"concurrencyLimit must be integer 1–16, got {cl!r}")

    # maxContinuations
    mc = cfg.get("maxContinuations", 3)
    if not isinstance(mc, int) or not (1 <= mc <= 10):
        errors.append(f"maxContinuations must be integer 1–10, got {mc!r}")

    # weights
    rw = cfg.get("recencyWeight", 0.6)
    fw = cfg.get("frequencyWeight", 0.4)
    if not isinstance(rw, (int, float)) or not (0.0 <= rw <= 1.0):
        errors.append(f"recencyWeight must be 0.0–1.0, got {rw!r}")
    if not isinstance(fw, (int, float)) or not (0.0 <= fw <= 1.0):
        errors.append(f"frequencyWeight must be 0.0–1.0, got {fw!r}")

    # pinnedSkill path resolution
    pinned = cfg.get("pinnedSkill")
    if pinned is not None:
        skills_root = root / ".claude" / "skills"
        # Accept either <skill-name> or <domain>/<skill-name>
        skill_name = pinned.split("/")[-1] if "/" in pinned else pinned
        if skills_root.exists():
            # Search any domain subdirectory for the skill
            found = any(
                (skills_root / domain / skill_name).is_dir()
                for domain in ([p.name for p in skills_root.iterdir() if p.is_dir()])
            )
            if not found:
                errors.append(
                    f"pinnedSkill {pinned!r} not found in .claude/skills/ — "
                    "remove or correct the skill name"
                )

    if errors:
        return LintResult(
            "Dashboard Config", "fail",
            f"{len(errors)} dashboard config error(s)",
            details=errors,
        )

    return LintResult(
        "Dashboard Config", "pass",
        f"dashboard.json valid (port {port}, {len(domain_order)} domain(s))",
    )


def check_engineering_quality_surfaces(root: Path) -> LintResult:
    if _is_distributable_harness_package_source(root):
        return _not_applicable(
            "Engineering Quality",
            "package source tree does not own generated engineering-quality surfaces",
        )

    claude_root = root / ".claude"
    if not claude_root.exists():
        return LintResult(
            "Engineering Quality",
            "warn",
            "No generated harness surfaces found -- run harness setup . --apply first",
        )

    required = [
        claude_root / "skills" / "agent-engineering-quality" / "SKILL.md",
        claude_root / "skills" / "agent-engineering-quality" / "references" / "comprehensive_100pct_execution_default.md",
        claude_root / "wiki" / "wiki" / "reference" / "agent-engineering-quality-standard.md",
        claude_root / "hooks" / "pre" / "plan_quality_gate.py",
        claude_root / "hooks" / "pre" / "engineering_quality_guard.py",
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.exists()]
    if missing:
        return LintResult(
            "Engineering Quality",
            "fail",
            f"{len(missing)} required surface(s) missing",
            details=missing,
        )
    return LintResult(
        "Engineering Quality",
        "pass",
        "Default engineering-quality surfaces present",
    )


def run_lint(root: Path) -> list[LintResult]:
    return [
        check_wiki_index(root),
        check_skill_compliance(root),
        check_hook_registration(root),
        check_wiki_reminders(root),
        check_engineering_quality_surfaces(root),
        check_dashboard_config(root),
    ]


def lint_has_errors(results: list[LintResult]) -> bool:
    return any(r.status == "fail" for r in results)


def format_lint_report(results: list[LintResult], root: Path | None = None) -> str:
    header = f"harness lint -- {root}" if root else "harness lint"
    lines = [header, ""]
    for r in results:
        icon = "✓" if r.status == "pass" else ("✗" if r.status == "fail" else "⚠")
        lines.append(f"{icon} {r.check}: {r.message}")
        for detail in r.details:
            lines.append(f"  {detail}")

    error_count = sum(1 for r in results if r.status == "fail")
    warn_count = sum(1 for r in results if r.status == "warn")
    lines.append("")
    if error_count == 0 and warn_count == 0:
        lines.append("All checks passed.")
    else:
        lines.append(f"{error_count} error(s). {warn_count} warning(s).")
    return "\n".join(lines)
