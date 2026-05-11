from __future__ import annotations

from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
REQUIRED = {
    "python_basic": ["pyproject.toml", "src/python_basic/__init__.py", "tests/test_basic.py"],
    "typescript_basic": ["package.json", "src/index.ts"],
    "monorepo_mixed": ["package.json", "packages/api/pyproject.toml", "packages/web/package.json"],
    "existing_partial_harness": ["AGENTS.md", ".claude/skills/sample-skill/SKILL.md", ".claude/commands/sample.md"],
    "notebook_workspace": ["README.md", "notebooks/example.ipynb"],
    "docs_ci_workspace": ["README.md", "docs/index.md", ".github/workflows/ci.yml"],
}


def test_fixture_paths_exist() -> None:
    for fixture, paths in REQUIRED.items():
        root = FIXTURES / fixture
        assert root.is_dir()
        for path in paths:
            assert (root / path).exists()


def test_fixture_size_and_no_credentials() -> None:
    total = 0
    for path in FIXTURES.rglob("*"):
        if path.is_file():
            total += path.stat().st_size
            if path.suffix in {".pyc", ".pyo"} or "__pycache__" in path.parts:
                continue
            text = path.read_text(encoding="utf-8")
            lowered = text.lower()
            assert "password" not in lowered
            assert "api_key" not in lowered
            assert "secret" not in lowered
    assert total < 250_000
