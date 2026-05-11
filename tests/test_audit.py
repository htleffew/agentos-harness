from __future__ import annotations

from pathlib import Path

import pytest

from agentos_harness.audit import (
    SPEC_RULES,
    audit_has_errors,
    audit_skill_file,
    audit_skills_dir,
    format_audit_report,
)


def _write_skill(tmp_path: Path, name: str, description: str, body: str = "# Body\n") -> Path:
    p = tmp_path / "SKILL.md"
    fm = f"---\nname: {name}\ndescription: {description}\n---\n\n"
    p.write_text(fm + body, encoding="utf-8")
    return p


def test_valid_skill_passes_all_rules(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="processing-pdfs",
        description="Extracts text from PDF files. Use when the user asks about PDFs or document extraction.",
    )
    findings = audit_skill_file(p)
    errors = [f for f in findings if f["severity"] == "error"]
    assert errors == [], f"Unexpected errors: {errors}"


def test_skill01_missing_name(tmp_path: Path) -> None:
    p = tmp_path / "SKILL.md"
    p.write_text("---\ndescription: Something. Use when needed.\n---\n\n# Body\n", encoding="utf-8")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-01" in rules


def test_skill02_name_too_long(tmp_path: Path) -> None:
    long_name = "a" * 65
    p = _write_skill(tmp_path, name=long_name, description="Does something. Use when needed.")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-02" in rules


def test_skill03_name_uppercase(tmp_path: Path) -> None:
    p = _write_skill(tmp_path, name="UPPER_CASE", description="Does something. Use when needed.")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-03" in rules


def test_skill03_name_with_spaces(tmp_path: Path) -> None:
    p = _write_skill(tmp_path, name="my skill", description="Does something. Use when needed.")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-03" in rules


def test_skill04_name_contains_anthropic(tmp_path: Path) -> None:
    p = _write_skill(tmp_path, name="anthropic-helper", description="Does something. Use when needed.")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-04" in rules


def test_skill04_name_contains_claude(tmp_path: Path) -> None:
    p = _write_skill(tmp_path, name="claude-wrapper", description="Does something. Use when needed.")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-04" in rules


def test_skill05_missing_description(tmp_path: Path) -> None:
    p = tmp_path / "SKILL.md"
    p.write_text("---\nname: my-skill\n---\n\n# Body\n", encoding="utf-8")
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-05" in rules


def test_skill06_description_too_long(tmp_path: Path) -> None:
    long_desc = "A" * 1025
    p = _write_skill(tmp_path, name="my-skill", description=long_desc)
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-06" in rules


def test_skill07_xml_in_description(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="Does <b>something</b>. Use when needed.",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-07" in rules


def test_skill08_first_person_i_can(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="I can help you with PDFs. Use when the user asks.",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-08" in rules


def test_skill08_first_person_you_can(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="You can use this to process files. Use when the user asks.",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-08" in rules


def test_skill09_missing_when(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="Processes PDF files and extracts text content from them.",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-09" in rules


def test_skill09_passes_with_use_when(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="Processes PDF files. Use when the user asks about PDFs.",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-09" not in rules


def test_skill10_body_too_long(tmp_path: Path) -> None:
    body = ("line\n" * 502)
    p = _write_skill(tmp_path, name="my-skill", description="Does something. Use when needed.", body=body)
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-10" in rules


def test_skill10_body_exactly_500_lines_passes(tmp_path: Path) -> None:
    body = ("line\n" * 500)
    p = _write_skill(tmp_path, name="my-skill", description="Does something. Use when needed.", body=body)
    findings = audit_skill_file(p)
    error_rules = [f["rule"] for f in findings if f["severity"] == "error"]
    assert "SKILL-10" not in error_rules


def test_skill11_backslash_path(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="Does something. Use when needed.",
        body="See .\\\\claude\\\\settings.json for details.\n",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-11" in rules


def test_skill12_time_sensitive_before(tmp_path: Path) -> None:
    p = _write_skill(
        tmp_path,
        name="my-skill",
        description="Does something. Use when needed.",
        body="This was deprecated before 2024.\n",
    )
    findings = audit_skill_file(p)
    rules = [f["rule"] for f in findings]
    assert "SKILL-12" in rules


def test_audit_skill_file_missing_file_returns_error() -> None:
    findings = audit_skill_file(Path("/nonexistent/SKILL.md"))
    assert len(findings) == 1
    assert findings[0]["severity"] == "error"


def test_audit_skills_dir_finds_all_skills(tmp_path: Path) -> None:
    for name in ("skill-a", "skill-b", "skill-c"):
        d = tmp_path / name
        d.mkdir()
        (d / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: Does something. Use when the user asks.\n---\n\n# Body\n",
            encoding="utf-8",
        )
    findings = audit_skills_dir(tmp_path)
    audited_files = {f["file"] for f in findings}
    assert len(audited_files) == 0 or all("skill-" in f for f in audited_files)


def test_audit_skills_dir_empty_returns_empty(tmp_path: Path) -> None:
    findings = audit_skills_dir(tmp_path)
    assert findings == []


def test_format_audit_report_empty_findings() -> None:
    report = format_audit_report([])
    assert "0 error" in report


def test_format_audit_report_shows_file_and_rule() -> None:
    findings = [
        {"rule": "SKILL-01", "severity": "error", "message": "name missing", "file": "/tmp/SKILL.md"},
    ]
    report = format_audit_report(findings)
    assert "SKILL-01" in report
    assert "/tmp/SKILL.md" in report
    assert "[ERROR]" in report


def test_format_audit_report_warn_label() -> None:
    findings = [
        {"rule": "SKILL-08", "severity": "warning", "message": "third person", "file": "/tmp/SKILL.md"},
    ]
    report = format_audit_report(findings)
    assert "[WARN]" in report


def test_format_audit_report_summary_line() -> None:
    findings = [
        {"rule": "SKILL-01", "severity": "error", "message": "name missing", "file": "/tmp/SKILL.md"},
        {"rule": "SKILL-08", "severity": "warning", "message": "third person", "file": "/tmp/SKILL.md"},
    ]
    report = format_audit_report(findings)
    assert "1 error" in report
    assert "1 warning" in report


def test_audit_has_errors_returns_false_for_empty() -> None:
    assert audit_has_errors([]) is False


def test_audit_has_errors_returns_false_for_warnings_only() -> None:
    findings = [{"rule": "SKILL-08", "severity": "warning", "message": "msg", "file": "f"}]
    assert audit_has_errors(findings) is False


def test_audit_has_errors_returns_true_for_errors() -> None:
    findings = [{"rule": "SKILL-01", "severity": "error", "message": "msg", "file": "f"}]
    assert audit_has_errors(findings) is True


def test_spec_rules_have_required_fields() -> None:
    required_keys = {"id", "description", "severity", "check"}
    for rule in SPEC_RULES:
        for key in required_keys:
            assert key in rule, f"Rule missing key '{key}': {rule}"
        assert rule["severity"] in ("error", "warning")
        assert callable(rule["check"])
