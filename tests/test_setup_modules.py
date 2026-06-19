from __future__ import annotations

from pathlib import Path

from agentos_harness.analyzer import analyze_workspace
from agentos_harness.setup_modules import render_module_targets, selected_modules, unselected_modules

FIXTURES = Path(__file__).parent / "fixtures"


def module_ids(root: Path) -> set[str]:
    analysis = analyze_workspace(root, write_state=False)
    return {module["id"] for module in selected_modules(analysis)}


def test_adaptive_modules_select_expected_fixtures() -> None:
    assert {"python-package", "docs-site"} <= module_ids(FIXTURES / "python_basic")
    assert {"typescript-app", "docs-site"} <= module_ids(FIXTURES / "typescript_basic")
    assert {"python-package", "typescript-app", "monorepo", "docs-site"} <= module_ids(FIXTURES / "monorepo_mixed")
    assert {"notebook-workspace", "docs-site"} <= module_ids(FIXTURES / "notebook_workspace")
    assert {"docs-site", "ci-release"} <= module_ids(FIXTURES / "docs_ci_workspace")


def test_unselected_modules_have_rejection_reasons() -> None:
    analysis = analyze_workspace(FIXTURES / "python_basic", write_state=False)
    unselected = unselected_modules(analysis)
    assert unselected
    assert all(module["status"] == "unselected" for module in unselected)
    assert all(module["reason"] for module in unselected)


def test_adaptive_targets_are_stable_and_workspace_neutral() -> None:
    analysis = analyze_workspace(FIXTURES / "monorepo_mixed", write_state=False)
    targets = render_module_targets(analysis)
    assert targets == render_module_targets(analysis)
    assert ".claude/hooks/post/setup_rescan_reminder.py" in targets
    assert ".claude/commands/python-test.md" in targets
    assert ".claude/commands/typescript-check.md" in targets
    assert ".claude/commands/monorepo-status.md" in targets
    text = "\n".join(targets.values())
    import re
    assert re.search(r"/home/\w", text) is None
    assert re.search(r"/Users/\w", text) is None
    assert "s3://" not in text


def test_adaptive_wiki_targets_have_required_lint_sections() -> None:
    analysis = analyze_workspace(FIXTURES / "monorepo_mixed", write_state=False)
    targets = render_module_targets(analysis)
    wiki_pages = {
        path: content
        for path, content in targets.items()
        if path.startswith(".claude/wiki/wiki/") and path.endswith(".md")
    }
    assert wiki_pages
    for content in wiki_pages.values():
        assert "## Summary" in content
        assert "## Authority And Recency" in content
        assert "## Source Artifacts" in content
        assert "## Related Pages" in content
