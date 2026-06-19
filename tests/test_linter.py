"""Tests for the harness integrity linter."""

from __future__ import annotations

import json
from pathlib import Path

from agentos_harness.linter import (
    LintResult,
    check_engineering_quality_surfaces,
    check_hook_registration,
    check_skill_compliance,
    check_wiki_index,
    check_wiki_reminders,
    format_lint_report,
    lint_has_errors,
    run_lint,
)


def _make_settings(root: Path, hooks: list[str]) -> None:
    entries = [
        {"matcher": "**", "hooks": [{"type": "command", "command": f'python "{rel}"'}]}
        for rel in hooks
    ]
    settings = {"hooks": {"PreToolUse": entries}}
    (root / ".claude").mkdir(parents=True, exist_ok=True)
    (root / ".claude" / "settings.json").write_text(json.dumps(settings), encoding="utf-8")


def _make_package_source(root: Path) -> None:
    (root / "src" / "agentos_harness").mkdir(parents=True)
    (root / "pyproject.toml").write_text('[project]\nname = "agentos-harness"\n', encoding="utf-8")


def test_check_wiki_index_warns_when_no_wiki(tmp_path: Path) -> None:
    """Linter reports warn when wiki missing (empty workspace)."""
    result = check_wiki_index(tmp_path)
    assert result.status == "warn"
    assert "No wiki found" in result.message


def test_run_lint_passes_for_package_source_without_generated_harness(tmp_path: Path) -> None:
    """Package source lint skips generated harness checks before setup is applied."""
    _make_package_source(tmp_path)
    (tmp_path / ".claude" / "wiki" / "wiki").mkdir(parents=True)

    results = run_lint(tmp_path)

    assert lint_has_errors(results) is False
    assert {result.status for result in results} == {"pass"}
    assert all("Not applicable" in result.message or result.check == "Wiki Reminders" for result in results)


def test_check_wiki_index_fails_when_missing_index_content(tmp_path: Path) -> None:
    """Linter reports fail when wiki has structural errors (missing index.md)."""
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    # Create wiki dir but no index.md - structural error
    result = check_wiki_index(tmp_path)
    assert result.status == "fail"
    assert "error" in result.message.lower() or len(result.details) > 0


def test_check_wiki_index_passes_when_valid(tmp_path: Path) -> None:
    """Linter reports pass when wiki is valid."""
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    # Create minimal valid wiki: index.md and log.md
    (wiki_root / "index.md").write_text("# Wiki Index\n\n## projects\n## systems\n## changes\n## concepts\n## workflows\n", encoding="utf-8")
    (wiki_root / "log.md").write_text("# Wiki Log\n", encoding="utf-8")
    result = check_wiki_index(tmp_path)
    assert result.status == "pass"
    assert "valid" in result.message.lower()


def test_check_wiki_index_fails_on_missing_log(tmp_path: Path) -> None:
    """Linter reports fail when log.md is missing."""
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    # index.md but no log.md
    (wiki_root / "index.md").write_text("# Wiki Index\n", encoding="utf-8")
    result = check_wiki_index(tmp_path)
    assert result.status == "fail"
    assert any("log" in d.lower() for d in result.details)


def test_check_wiki_index_warns_on_missing_family_section(tmp_path: Path) -> None:
    """Linter reports warn when index.md missing family sections."""
    wiki_root = tmp_path / ".claude" / "wiki"
    wiki_root.mkdir(parents=True)
    # Valid structure but index missing family sections
    (wiki_root / "index.md").write_text("# Wiki Index\n", encoding="utf-8")
    (wiki_root / "log.md").write_text("# Wiki Log\n", encoding="utf-8")
    result = check_wiki_index(tmp_path)
    # Should have warnings about missing family sections
    assert result.status == "warn"
    assert any("family" in d.lower() for d in result.details)


def test_check_skill_compliance_warns_when_no_skills_dir(tmp_path: Path) -> None:
    result = check_skill_compliance(tmp_path)
    assert result.status == "warn"


def test_check_skill_compliance_passes_on_valid_skills(tmp_path: Path) -> None:
    skill_dir = tmp_path / ".claude" / "skills" / "good-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: good-skill\ndescription: Use when the user asks.\n---\n# Body\n",
        encoding="utf-8",
    )
    result = check_skill_compliance(tmp_path)
    assert result.status == "pass"


def test_check_skill_compliance_fails_on_bad_skill(tmp_path: Path) -> None:
    skill_dir = tmp_path / ".claude" / "skills" / "bad-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: claude-helper\ndescription: Use when the user asks.\n---\n",
        encoding="utf-8",
    )
    result = check_skill_compliance(tmp_path)
    assert result.status == "fail"


def test_check_hook_registration_warns_when_no_settings(tmp_path: Path) -> None:
    result = check_hook_registration(tmp_path)
    assert result.status == "warn"


def test_check_hook_registration_passes_when_hooks_exist(tmp_path: Path) -> None:
    hook_path = tmp_path / ".claude" / "hooks" / "pre" / "my_guard.py"
    hook_path.parent.mkdir(parents=True)
    hook_path.write_text("# hook\n", encoding="utf-8")
    _make_settings(tmp_path, [".claude/hooks/pre/my_guard.py"])
    result = check_hook_registration(tmp_path)
    assert result.status == "pass"


def test_check_hook_registration_fails_when_hook_missing(tmp_path: Path) -> None:
    _make_settings(tmp_path, [".claude/hooks/pre/ghost.py"])
    result = check_hook_registration(tmp_path)
    assert result.status == "fail"
    assert any("ghost.py" in d for d in result.details)


def test_check_wiki_reminders_passes_when_no_file(tmp_path: Path) -> None:
    result = check_wiki_reminders(tmp_path)
    assert result.status == "pass"


def test_check_wiki_reminders_passes_below_threshold(tmp_path: Path) -> None:
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)
    reminders = state_dir / "wiki_reminders.jsonl"
    lines = [json.dumps({"source_path": f"src/file{i}.py"}) for i in range(3)]
    reminders.write_text("\n".join(lines), encoding="utf-8")
    result = check_wiki_reminders(tmp_path)
    assert result.status == "pass"


def test_check_wiki_reminders_warns_above_threshold(tmp_path: Path) -> None:
    state_dir = tmp_path / ".harness" / "state"
    state_dir.mkdir(parents=True)
    reminders = state_dir / "wiki_reminders.jsonl"
    lines = [json.dumps({"source_path": f"src/file{i}.py"}) for i in range(8)]
    reminders.write_text("\n".join(lines), encoding="utf-8")
    result = check_wiki_reminders(tmp_path)
    assert result.status == "warn"


def test_check_engineering_quality_surfaces_fails_when_missing(tmp_path: Path) -> None:
    (tmp_path / ".claude").mkdir()
    result = check_engineering_quality_surfaces(tmp_path)
    assert result.status == "fail"


def test_check_engineering_quality_surfaces_passes_when_present(tmp_path: Path) -> None:
    skill_dir = tmp_path / ".claude" / "skills" / "agent-engineering-quality" / "references"
    skill_dir.mkdir(parents=True)
    (skill_dir.parent / "SKILL.md").write_text("# skill\n", encoding="utf-8")
    (skill_dir / "comprehensive_100pct_execution_default.md").write_text("# ref\n", encoding="utf-8")
    wiki_dir = tmp_path / ".claude" / "wiki" / "wiki" / "reference"
    wiki_dir.mkdir(parents=True)
    (wiki_dir / "agent-engineering-quality-standard.md").write_text("# page\n", encoding="utf-8")
    hook_dir = tmp_path / ".claude" / "hooks" / "pre"
    hook_dir.mkdir(parents=True)
    (hook_dir / "plan_quality_gate.py").write_text("# hook\n", encoding="utf-8")
    (hook_dir / "engineering_quality_guard.py").write_text("# hook\n", encoding="utf-8")
    result = check_engineering_quality_surfaces(tmp_path)
    assert result.status == "pass"


def test_lint_has_errors_true_when_fail_present() -> None:
    results = [LintResult("A", "pass", "ok"), LintResult("B", "fail", "bad")]
    assert lint_has_errors(results) is True


def test_lint_has_errors_false_when_only_warns() -> None:
    results = [LintResult("A", "pass", "ok"), LintResult("B", "warn", "note")]
    assert lint_has_errors(results) is False


def test_format_lint_report_shows_all_checks(tmp_path: Path) -> None:
    results = run_lint(tmp_path)
    report = format_lint_report(results, tmp_path)
    assert "Wiki Index" in report
    assert "Skill Compliance" in report
    assert "Hook Registration" in report
    assert "Wiki Reminders" in report
    assert "Engineering Quality" in report


def test_format_lint_report_shows_all_checks_passed_when_clean(tmp_path: Path) -> None:
    results = [LintResult("Check A", "pass", "ok"), LintResult("Check B", "pass", "also ok")]
    report = format_lint_report(results)
    assert "All checks passed" in report
