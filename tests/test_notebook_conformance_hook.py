"""Tests for notebook_conformance_check hook."""

from __future__ import annotations

import json
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import pytest

from agentos_harness.hooks import notebook_conformance_check


def _make_valid_notebook() -> dict:
    """Create a valid notebook that passes all checks."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test Notebook\n",
                    "\n",
                    "## Research Questions\n",
                    "- Q1: Test question?\n",
                    "\n",
                    "## Pipeline Position\n",
                    "Step 1 of pipeline.\n",
                    "\n",
                    "## Surfaces Under Examination\n",
                    "Test data surfaces.\n",
                    "\n",
                    "## Scope Constraints\n",
                    "Limited to test data.\n",
                    "\n",
                    "## Methodology References\n",
                    "See references.md\n",
                ],
            },
            {"cell_type": "code", "source": ["import pandas as pd\n"]},
            {"cell_type": "markdown", "source": ["## Analysis\n", "Findings here.\n"]},
            {"cell_type": "code", "source": ["df = pd.DataFrame()\n"]},
            {"cell_type": "markdown", "source": ["## Conclusion\n", "<!-- decision: confirmed -->\n"]},
        ],
    }


def _make_invalid_notebook_missing_sections() -> dict:
    """Create a notebook missing required opening sections."""
    return {
        "cells": [
            {"cell_type": "markdown", "source": ["# Test Notebook\n"]},
            {"cell_type": "code", "source": ["x = 1\n"]},
            {"cell_type": "markdown", "source": ["## End\n", "<!-- decision: done -->\n"]},
        ],
    }


def _make_notebook_consecutive_code() -> dict:
    """Create a notebook with too many consecutive code cells."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test\n",
                    "## Research Questions\n",
                    "## Pipeline Position\n",
                    "## Surfaces Under Examination\n",
                    "## Scope Constraints\n",
                    "## Methodology References\n",
                ],
            },
            {"cell_type": "code", "source": ["x = 1\n"]},
            {"cell_type": "code", "source": ["y = 2\n"]},
            {"cell_type": "code", "source": ["z = 3\n"]},
            {"cell_type": "markdown", "source": ["<!-- decision: done -->\n"]},
        ],
    }


def _make_notebook_missing_decision() -> dict:
    """Create a notebook missing decision code."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test\n",
                    "## Research Questions\n",
                    "## Pipeline Position\n",
                    "## Surfaces Under Examination\n",
                    "## Scope Constraints\n",
                    "## Methodology References\n",
                ],
            },
            {"cell_type": "code", "source": ["x = 1\n"]},
            {"cell_type": "markdown", "source": ["## End\n"]},
        ],
    }


def _make_notebook_forbidden_import() -> dict:
    """Create a notebook with forbidden imports."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test\n",
                    "## Research Questions\n",
                    "## Pipeline Position\n",
                    "## Surfaces Under Examination\n",
                    "## Scope Constraints\n",
                    "## Methodology References\n",
                ],
            },
            {"cell_type": "code", "source": ["import sys\n", "sys.path.insert(0, '/custom')\n"]},
            {"cell_type": "markdown", "source": ["<!-- decision: done -->\n"]},
        ],
    }


def _make_notebook_absolute_path() -> dict:
    """Create a notebook with absolute paths."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test\n",
                    "## Research Questions\n",
                    "## Pipeline Position\n",
                    "## Surfaces Under Examination\n",
                    "## Scope Constraints\n",
                    "## Methodology References\n",
                ],
            },
            {"cell_type": "code", "source": ["path = '/home/user/data.csv'\n"]},
            {"cell_type": "markdown", "source": ["<!-- decision: done -->\n"]},
        ],
    }


def _make_notebook_llm_markers() -> dict:
    """Create a notebook with LLM prose markers."""
    return {
        "cells": [
            {
                "cell_type": "markdown",
                "source": [
                    "# Test\n",
                    "## Research Questions\n",
                    "## Pipeline Position\n",
                    "## Surfaces Under Examination\n",
                    "## Scope Constraints\n",
                    "## Methodology References\n",
                ],
            },
            {"cell_type": "code", "source": ["x = 1\n"]},
            {"cell_type": "markdown", "source": ["**Finding:** The data shows...\n", "<!-- decision: done -->\n"]},
        ],
    }


class TestNotebookConformanceCheck:
    """Tests for notebook_conformance_check hook."""

    def test_passes_valid_notebook(self, tmp_path: Path) -> None:
        """Hook passes valid notebook."""
        (tmp_path / ".harness").mkdir()
        nb = _make_valid_notebook()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit) as exc_info:
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") != "deny"
                    assert exc_info.value.code == 0

    def test_blocks_missing_opening_sections_external_tier(self, tmp_path: Path) -> None:
        """Hook blocks missing opening sections for external tier."""
        (tmp_path / ".harness").mkdir()
        nb = _make_invalid_notebook_missing_sections()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"
                        assert "opening-cell-structure" in data["hookSpecificOutput"]["permissionDecisionReason"]

    def test_blocks_consecutive_code_cells(self, tmp_path: Path) -> None:
        """Hook blocks 3+ consecutive code cells."""
        (tmp_path / ".harness").mkdir()
        nb = _make_notebook_consecutive_code()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_blocks_missing_decision_code(self, tmp_path: Path) -> None:
        """Hook blocks missing decision code."""
        (tmp_path / ".harness").mkdir()
        nb = _make_notebook_missing_decision()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_blocks_forbidden_imports(self, tmp_path: Path) -> None:
        """Hook blocks forbidden imports."""
        (tmp_path / ".harness").mkdir()
        nb = _make_notebook_forbidden_import()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_blocks_absolute_paths(self, tmp_path: Path) -> None:
        """Hook blocks absolute paths."""
        (tmp_path / ".harness").mkdir()
        nb = _make_notebook_absolute_path()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_blocks_llm_markers(self, tmp_path: Path) -> None:
        """Hook blocks LLM prose markers."""
        (tmp_path / ".harness").mkdir()
        nb = _make_notebook_llm_markers()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit):
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    if output.strip():
                        data = json.loads(output)
                        assert data.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_respects_grace_period_allowlist(self, tmp_path: Path) -> None:
        """Hook respects grace period allowlist."""
        (tmp_path / ".harness" / "hooks" / "config").mkdir(parents=True)
        policy = {
            "grace_period_allowlist": {
                "paths": ["projects/test/external/notebooks/nb.ipynb"],
            },
        }
        (tmp_path / ".harness" / "hooks" / "config" / "notebook_conformance_policy.json").write_text(json.dumps(policy))

        nb = _make_invalid_notebook_missing_sections()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit) as exc_info:
                        notebook_conformance_check.main()
                    output = mock_stdout.getvalue()
                    assert exc_info.value.code == 0

    def test_skips_non_ipynb_files(self, tmp_path: Path) -> None:
        """Hook skips non-ipynb files."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/code.py"),
                "content": "x = 1",
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit) as exc_info:
                        notebook_conformance_check.main()
                    assert exc_info.value.code == 0

    def test_skips_non_write_tools(self, tmp_path: Path) -> None:
        """Hook skips non-Write tools."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Read",
            "tool_input": {"file_path": str(tmp_path / "test.ipynb")},
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with pytest.raises(SystemExit) as exc_info:
                notebook_conformance_check.main()
            assert exc_info.value.code == 0

    def test_handles_malformed_notebook_json(self, tmp_path: Path) -> None:
        """Hook handles malformed notebook JSON."""
        (tmp_path / ".harness").mkdir()
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": "not valid json",
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with pytest.raises(SystemExit) as exc_info:
                    notebook_conformance_check.main()
                assert exc_info.value.code == 0

    def test_loads_custom_policy_from_config(self, tmp_path: Path) -> None:
        """Hook loads custom policy from config."""
        (tmp_path / ".harness" / "hooks" / "config").mkdir(parents=True)
        policy = {
            "required_opening_sections": ["title"],
            "forbidden_import_patterns": [],
            "forbidden_absolute_paths": [],
            "forbidden_llm_markers": [],
        }
        (tmp_path / ".harness" / "hooks" / "config" / "notebook_conformance_policy.json").write_text(json.dumps(policy))

        nb = {
            "cells": [
                {"cell_type": "markdown", "source": ["# Title\n"]},
                {"cell_type": "code", "source": ["x = 1\n"]},
                {"cell_type": "markdown", "source": ["<!-- decision: done -->\n"]},
            ],
        }
        event = {
            "tool_name": "Write",
            "tool_input": {
                "file_path": str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
                "content": json.dumps(nb),
            },
        }
        with patch.object(sys, "stdin", StringIO(json.dumps(event))):
            with patch.object(notebook_conformance_check, "_detect_workspace_root", return_value=tmp_path):
                with patch("sys.stdout", new_callable=StringIO) as mock_stdout:
                    with pytest.raises(SystemExit) as exc_info:
                        notebook_conformance_check.main()
                    assert exc_info.value.code == 0


class TestClassifyPath:
    """Tests for _classify_path function."""

    def test_classifies_external_notebooks(self, tmp_path: Path) -> None:
        policy = {"research_program_projects": []}
        tier = notebook_conformance_check._classify_path(
            str(tmp_path / "projects/test/external/notebooks/nb.ipynb"),
            tmp_path,
            policy,
        )
        assert tier == "external"

    def test_classifies_internal_research(self, tmp_path: Path) -> None:
        policy = {"research_program_projects": ["test"]}
        tier = notebook_conformance_check._classify_path(
            str(tmp_path / "projects/test/internal/research/nb.ipynb"),
            tmp_path,
            policy,
        )
        assert tier == "internal_research"

    def test_classifies_infrastructure(self, tmp_path: Path) -> None:
        policy = {"research_program_projects": []}
        tier = notebook_conformance_check._classify_path(
            str(tmp_path / "projects/test/internal/scripts/nb.ipynb"),
            tmp_path,
            policy,
        )
        assert tier == "infrastructure"

    def test_classifies_skip_for_non_project(self, tmp_path: Path) -> None:
        policy = {"research_program_projects": []}
        tier = notebook_conformance_check._classify_path(
            str(tmp_path / "random/nb.ipynb"),
            tmp_path,
            policy,
        )
        assert tier == "skip"
