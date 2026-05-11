from __future__ import annotations

from pathlib import Path

from agentos_harness.analyzer import analyze_workspace

FIXTURES = Path(__file__).parent / "fixtures"


def without_timestamp(payload: dict) -> dict:
    clone = dict(payload)
    clone["workspace"] = dict(payload["workspace"])
    clone["workspace"].pop("scanned_at", None)
    return clone


def test_analyzer_detects_python_fixture() -> None:
    analysis = analyze_workspace(FIXTURES / "python_basic", write_state=False)
    assert "Python" in analysis["inventory"]["languages"]
    assert "python" in analysis["inventory"]["package_managers"]
    assert "python -m pytest" in analysis["inventory"]["test_commands"]


def test_analyzer_detects_typescript_fixture() -> None:
    analysis = analyze_workspace(FIXTURES / "typescript_basic", write_state=False)
    assert "TypeScript" in analysis["inventory"]["languages"]
    assert "npm" in analysis["inventory"]["package_managers"]
    assert "npm test" in analysis["inventory"]["test_commands"]
    assert "npm run build" in analysis["inventory"]["build_commands"]


def test_analyzer_is_stable_for_fixtures() -> None:
    for root in FIXTURES.iterdir():
        if root.is_dir():
            first = analyze_workspace(root, write_state=False)
            second = analyze_workspace(root, write_state=False)
            assert without_timestamp(first) == without_timestamp(second)


def test_analyzer_detects_partial_harness() -> None:
    analysis = analyze_workspace(FIXTURES / "existing_partial_harness", write_state=False)
    assert "AGENTS.md" in analysis["inventory"]["agent_files"]
    assert ".claude/skills/sample-skill/SKILL.md" in analysis["inventory"]["agent_files"]
