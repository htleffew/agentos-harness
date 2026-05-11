from __future__ import annotations

from pathlib import Path

import pytest

from agentos_harness.project_detector import (
    apply_project_layout,
    confirm_projects_interactive,
    detect_project_boundaries,
    get_update_filename,
    plan_project_layout,
    render_agents_project_table,
    render_handoff_template,
    render_update_template,
    scaffold_project,
    suggest_project_names,
)


def test_detect_empty_dir_returns_empty(tmp_path: Path) -> None:
    assert detect_project_boundaries(tmp_path) == []


def test_detect_finds_package_json(tmp_path: Path) -> None:
    subdir = tmp_path / "my-app"
    subdir.mkdir()
    (subdir / "package.json").write_text("{}", encoding="utf-8")
    result = detect_project_boundaries(tmp_path)
    assert len(result) == 1
    assert "package.json" in result[0]["signals"]
    assert result[0]["path"] == "my-app"


def test_detect_finds_pyproject(tmp_path: Path) -> None:
    subdir = tmp_path / "backend"
    subdir.mkdir()
    (subdir / "pyproject.toml").write_text("[project]\nname = 'backend'\n", encoding="utf-8")
    result = detect_project_boundaries(tmp_path)
    assert len(result) == 1
    assert "pyproject.toml" in result[0]["signals"]


def test_detect_finds_existing_managed_project(tmp_path: Path) -> None:
    project = tmp_path / "projects" / "api"
    project.mkdir(parents=True)
    (project / "HANDOFF.md").write_text("# API\n", encoding="utf-8")
    result = detect_project_boundaries(tmp_path)
    assert result[0]["path"] == "projects/api"
    assert result[0]["source_path"] == "projects/api"


def test_detect_finds_multiple_signals(tmp_path: Path) -> None:
    subdir = tmp_path / "api"
    subdir.mkdir()
    (subdir / "pyproject.toml").write_text("", encoding="utf-8")
    (subdir / "README.md").write_text("# api", encoding="utf-8")
    result = detect_project_boundaries(tmp_path)
    assert len(result) == 1
    assert "pyproject.toml" in result[0]["signals"]
    assert "README.md" in result[0]["signals"]


def test_detect_skips_hidden_dirs(tmp_path: Path) -> None:
    hidden = tmp_path / ".hidden"
    hidden.mkdir()
    (hidden / "package.json").write_text("{}", encoding="utf-8")
    assert detect_project_boundaries(tmp_path) == []


def test_detect_skips_excluded_dirs(tmp_path: Path) -> None:
    for excluded in ("node_modules", "__pycache__", ".venv", "dist", "build"):
        d = tmp_path / excluded
        d.mkdir()
        (d / "package.json").write_text("{}", encoding="utf-8")
    assert detect_project_boundaries(tmp_path) == []


def test_detect_on_nonexistent_path() -> None:
    result = detect_project_boundaries(Path("/nonexistent/path"))
    assert result == []


def test_detect_max_20_results(tmp_path: Path) -> None:
    for i in range(25):
        d = tmp_path / f"proj{i:02d}"
        d.mkdir()
        (d / "README.md").write_text("", encoding="utf-8")
    result = detect_project_boundaries(tmp_path)
    assert len(result) <= 20


def test_suggest_normalizes_spaces_to_hyphens() -> None:
    result = suggest_project_names([{"path": "my project", "signals": ["README.md"], "suggested_name": "my project"}])
    assert result[0]["suggested_name"] == "my-project"


def test_suggest_normalizes_underscores() -> None:
    result = suggest_project_names([{"path": "my_module", "signals": [], "suggested_name": "my_module"}])
    assert result[0]["suggested_name"] == "my-module"


def test_suggest_normalizes_uppercase() -> None:
    result = suggest_project_names([{"path": "MyProject", "signals": [], "suggested_name": "MyProject"}])
    assert result[0]["suggested_name"] == "myproject"


def test_suggest_removes_special_chars() -> None:
    result = suggest_project_names([{"path": "my.project!", "signals": [], "suggested_name": "my.project!"}])
    assert result[0]["suggested_name"] == "myproject"


def test_confirm_non_interactive_returns_all(tmp_path: Path) -> None:
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
        {"path": "frontend", "signals": ["package.json"], "suggested_name": "frontend"},
    ]
    result = confirm_projects_interactive(boundaries, interactive=False)
    assert result == boundaries


def test_confirm_empty_returns_empty() -> None:
    result = confirm_projects_interactive([], interactive=True)
    assert result == []


def test_confirm_non_interactive_empty_returns_empty() -> None:
    result = confirm_projects_interactive([], interactive=False)
    assert result == []


def test_confirm_interactive_y_returns_all(monkeypatch) -> None:
    """Test that typing 'y' in interactive mode returns all boundaries."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
        {"path": "frontend", "signals": ["package.json"], "suggested_name": "frontend"},
    ]
    monkeypatch.setattr("builtins.input", lambda _: "y")
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert len(result) == 2
    assert result == boundaries


def test_confirm_interactive_default_enter_returns_all(monkeypatch) -> None:
    """Test that pressing Enter (default) in interactive mode returns all boundaries."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
    ]
    monkeypatch.setattr("builtins.input", lambda _: "")
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert len(result) == 1
    assert result == boundaries


def test_confirm_interactive_n_returns_empty(monkeypatch) -> None:
    """Test that typing 'n' in interactive mode returns an empty list."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
    ]
    monkeypatch.setattr("builtins.input", lambda _: "n")
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert result == []


def test_confirm_interactive_o_select_indices(monkeypatch) -> None:
    """Test that 'o' followed by specific indices returns only those boundaries."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
        {"path": "frontend", "signals": ["package.json"], "suggested_name": "frontend"},
        {"path": "infra", "signals": ["Makefile"], "suggested_name": "infra"},
    ]
    # Simulate two inputs: first 'o', then the selection
    inputs = iter(["o", "1, 3"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert len(result) == 2
    assert result[0]["path"] == "api"
    assert result[1]["path"] == "infra"


def test_confirm_interactive_o_custom_name(monkeypatch) -> None:
    """Test that 'o' followed by custom name syntax works."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
    ]
    inputs = iter(["o", "1:my-custom-api"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert len(result) == 1
    assert result[0]["suggested_name"] == "my-custom-api"


def test_confirm_interactive_o_all_returns_all(monkeypatch) -> None:
    """Test that 'o' followed by 'all' returns all boundaries."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
        {"path": "frontend", "signals": ["package.json"], "suggested_name": "frontend"},
    ]
    inputs = iter(["o", "all"])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert len(result) == 2


def test_confirm_interactive_o_empty_input_returns_empty(monkeypatch) -> None:
    """Test that 'o' followed by empty input returns an empty list."""
    boundaries = [
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
    ]
    inputs = iter(["o", ""])
    monkeypatch.setattr("builtins.input", lambda _: next(inputs))
    result = confirm_projects_interactive(boundaries, interactive=True)
    assert result == []



def test_render_handoff_template_contains_title() -> None:
    # render_handoff_template now delegates to render_update_template
    result = render_handoff_template("auth", "projects/auth")
    assert "# Auth" in result


def test_render_handoff_template_contains_summary() -> None:
    result = render_handoff_template("auth", "projects/auth")
    assert "## Summary" in result


def test_render_handoff_template_contains_current_state() -> None:
    result = render_handoff_template("auth", "projects/auth")
    assert "## Current State" in result


def test_render_handoff_template_contains_project_path() -> None:
    result = render_handoff_template("my-service", "projects/my-service")
    assert "projects/my-service" in result


def test_render_agents_project_table_empty_has_no_placeholder() -> None:
    result = render_agents_project_table([])
    assert "(none detected)" in result
    assert "<project>" not in result


def test_render_agents_project_table_has_header() -> None:
    result = render_agents_project_table([])
    assert "| Project |" in result
    assert "| Home |" in result


def test_render_agents_project_table_with_projects() -> None:
    confirmed = [
        {"path": "projects/api", "signals": ["pyproject.toml"], "suggested_name": "api"},
        {"path": "projects/frontend", "signals": ["package.json"], "suggested_name": "frontend"},
    ]
    result = render_agents_project_table(confirmed)
    assert "api" in result
    assert "frontend" in result
    assert "`projects/api/`" in result
    assert "<project>" not in result


def test_plan_project_layout_maps_top_level_to_projects_dir() -> None:
    result = plan_project_layout([
        {"path": "api", "signals": ["pyproject.toml"], "suggested_name": "api"},
    ])
    assert result[0]["source_path"] == "api"
    assert result[0]["path"] == "projects/api"
    assert result[0]["move_required"] is True


def test_plan_project_layout_keeps_existing_canonical_project() -> None:
    result = plan_project_layout([
        {"path": "projects/api", "source_path": "projects/api", "signals": ["HANDOFF.md"], "suggested_name": "api"},
    ])
    assert result[0]["source_path"] == "projects/api"
    assert result[0]["path"] == "projects/api"
    assert result[0]["move_required"] is False


# Tests for _UPDATE.md template and scaffolding


def test_get_update_filename_simple() -> None:
    assert get_update_filename("api") == "API_UPDATE.md"


def test_get_update_filename_hyphenated() -> None:
    assert get_update_filename("my-project") == "MY_PROJECT_UPDATE.md"


def test_get_update_filename_multiple_hyphens() -> None:
    assert get_update_filename("my-cool-project") == "MY_COOL_PROJECT_UPDATE.md"


def test_render_update_template_contains_title() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "# Auth" in result


def test_render_update_template_contains_summary() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Summary" in result


def test_render_update_template_contains_current_state() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Current State" in result


def test_render_update_template_contains_project_structure() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Project Structure" in result
    assert "plans/active/" in result
    assert "plans/completed/" in result


def test_render_update_template_contains_active_plans() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Active Plans" in result


def test_render_update_template_contains_read_order() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Read Order" in result


def test_render_update_template_contains_routing_rules() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Routing Rules" in result


def test_render_update_template_contains_validation() -> None:
    result = render_update_template("auth", "projects/auth")
    assert "## Validation" in result


def test_render_update_template_references_update_filename() -> None:
    result = render_update_template("my-api", "projects/my-api")
    assert "MY_API_UPDATE.md" in result


def test_scaffold_project_creates_update_file(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "my-app"
    project_dir.mkdir(parents=True)
    project = {"path": "projects/my-app", "source_path": "my-app", "suggested_name": "my-app"}
    result = scaffold_project(tmp_path, project)
    assert result["update_file"] == "UPDATE.txt"
    assert (project_dir / "UPDATE.txt").exists()
    assert (project_dir / "HANDOFF.md").exists()


def test_scaffold_project_creates_plans_active(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "api"
    project_dir.mkdir(parents=True)
    project = {"path": "projects/api", "suggested_name": "api"}
    scaffold_project(tmp_path, project)
    assert (project_dir / "internal" / "plans" / "active").is_dir()
    assert (project_dir / "internal" / "plans" / "active" / ".gitkeep").exists()


def test_scaffold_project_creates_plans_completed(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "api"
    project_dir.mkdir(parents=True)
    project = {"path": "projects/api", "suggested_name": "api"}
    scaffold_project(tmp_path, project)
    assert (project_dir / "internal" / "plans" / "completed").is_dir()
    assert (project_dir / "internal" / "plans" / "completed" / ".gitkeep").exists()


def test_scaffold_project_returns_created_files(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "frontend"
    project_dir.mkdir(parents=True)
    project = {"path": "projects/frontend", "suggested_name": "frontend"}
    result = scaffold_project(tmp_path, project)
    assert len(result["created_files"]) == 7
    assert "projects/frontend/HANDOFF.md" in result["created_files"]
    assert "projects/frontend/UPDATE.txt" in result["created_files"]


def test_scaffold_project_skips_existing_update_file(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "existing"
    project_dir.mkdir(parents=True)
    (project_dir / "UPDATE.txt").write_text("# Custom content", encoding="utf-8")
    project = {"path": "projects/existing", "suggested_name": "existing"}
    result = scaffold_project(tmp_path, project)
    assert "projects/existing/UPDATE.txt" not in result["created_files"]
    assert (project_dir / "UPDATE.txt").read_text() == "# Custom content"


def test_scaffold_project_skips_existing_plans(tmp_path: Path) -> None:
    project_dir = tmp_path / "projects" / "existing"
    project_dir.mkdir(parents=True)
    (project_dir / "internal" / "plans" / "active").mkdir(parents=True)
    project = {"path": "projects/existing", "suggested_name": "existing"}
    result = scaffold_project(tmp_path, project)
    created_paths = result["created_files"]
    assert "projects/existing/internal/plans/active" not in created_paths


def test_apply_project_layout_moves_top_level_project(tmp_path: Path) -> None:
    source = tmp_path / "api"
    source.mkdir()
    (source / "pyproject.toml").write_text("[project]\nname='api'\n", encoding="utf-8")
    result = apply_project_layout(
        tmp_path,
        {"source_path": "api", "path": "projects/api", "suggested_name": "api"},
    )
    assert result["action"] == "move"
    assert not source.exists()
    assert (tmp_path / "projects" / "api" / "pyproject.toml").exists()


def test_apply_project_layout_copies_when_windows_rename_is_denied(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "api"
    source.mkdir()
    (source / "pyproject.toml").write_text("[project]\nname='api'\n", encoding="utf-8")

    def deny_rename(self: Path, target: Path) -> None:
        raise PermissionError(5, "Access is denied", str(self))

    monkeypatch.setattr(Path, "rename", deny_rename)
    result = apply_project_layout(
        tmp_path,
        {"source_path": "api", "path": "projects/api", "suggested_name": "api"},
    )
    assert result["action"] == "move"
    assert result["errors"] == []
    assert "copy fallback" in result["warnings"][0]
    assert not source.exists()
    assert (tmp_path / "projects" / "api" / "pyproject.toml").exists()


def test_apply_project_layout_keeps_copy_when_cleanup_is_denied(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "api"
    source.mkdir()
    (source / "pyproject.toml").write_text("[project]\nname='api'\n", encoding="utf-8")

    def deny_rename(self: Path, target: Path) -> None:
        raise PermissionError(5, "Access is denied", str(self))

    def deny_cleanup(path: Path) -> None:
        raise PermissionError(5, "Access is denied", str(path))

    monkeypatch.setattr(Path, "rename", deny_rename)
    monkeypatch.setattr("distributable_harness.project_detector.shutil.rmtree", deny_cleanup)
    result = apply_project_layout(
        tmp_path,
        {"source_path": "api", "path": "projects/api", "suggested_name": "api"},
    )
    assert result["action"] == "copy"
    assert result["errors"] == []
    assert "original source retained" in result["warnings"][1]
    assert source.exists()
    assert (tmp_path / "projects" / "api" / "pyproject.toml").exists()


def test_apply_project_layout_rejects_existing_target(tmp_path: Path) -> None:
    (tmp_path / "api").mkdir()
    (tmp_path / "projects" / "api").mkdir(parents=True)
    result = apply_project_layout(
        tmp_path,
        {"source_path": "api", "path": "projects/api", "suggested_name": "api"},
    )
    assert result["action"] == "error"
    assert "target project already exists" in result["errors"][0]
