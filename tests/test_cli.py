from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from agentos_harness.cli import main


def test_help_lists_required_commands(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    assert exc.value.code == 0
    output = capsys.readouterr().out
    for command in ("doctor", "analyze", "generate", "setup", "dashboard", "export"):
        assert command in output


def test_doctor_prints_json(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["doctor", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["python_version"]
    assert payload["state_path"].endswith(".harness/state")
    assert "git_available" in payload
    assert payload["package_version"]


def test_doctor_includes_moe_tier_and_gemini(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["doctor", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "moe_tier" in payload
    assert "gemini_available" in payload
    assert isinstance(payload["gemini_available"], bool)
    assert payload["moe_tier"] in (
        "claude-only",
        "codex-only",
        "gemini-only",
        "claude-codex",
        "claude-gemini",
        "codex-gemini",
        "full-moe",
    )


def test_setup_dry_run_prints_modules_and_writes_state(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "pyproject.toml").write_text("[project]\nname = \"sample\"\n", encoding="utf-8")
    assert main(["setup", str(tmp_path), "--dry-run", "--non-interactive", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "dry-run"
    assert payload["selected_modules"]
    assert payload["manifest"].endswith("generation_manifest.json")
    assert payload["next_command"] == "harness setup . --apply"
    assert (tmp_path / ".harness/state/analysis.json").exists()
    assert (tmp_path / ".harness/state/generation_manifest.json").exists()
    assert (tmp_path / ".harness/state/setup.json").exists()
    assert "moe_tier" in payload


def test_setup_tools_flag_sets_tier(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["moe_tier"] == "claude-only"


def test_setup_tools_flag_codex(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude,codex", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["moe_tier"] == "claude-codex"


def test_setup_tools_flag_codex_only(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "codex", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["moe_tier"] == "codex-only"


def test_setup_tools_flag_codex_gemini(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "codex,gemini", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["moe_tier"] == "codex-gemini"


def test_setup_tools_flag_requires_one_agent(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", ""]) == 1
    captured = capsys.readouterr()
    assert "At least one AI CLI is required" in captured.err


def test_setup_default_guides_user_through_apply_and_agent_prompt(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    with patch(
        "distributable_harness.tool_check.detect_tools",
        return_value={"claude": True, "codex": True, "gemini": True},
    ), patch("builtins.input", side_effect=["", "", "y"]):
        assert main(["setup", str(tmp_path)]) == 0

    output = capsys.readouterr().out
    assert "Harness setup review ready." in output
    assert "Apply these changes now?" not in output
    assert "Harness setup applied." in output
    assert "Open your agent terminal in this repository." in output
    assert "Finish harness setup for this repository." in output
    assert "harness validate ." in output
    assert "harness lint ." in output


def test_setup_existing_harness_fresh_choice_applies_in_guided_mode(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    skill = tmp_path / ".claude" / "skills" / "executing-plans" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text("# local change\n", encoding="utf-8")
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    (api_dir / "pyproject.toml").write_text("[project]\nname = \"api\"\n", encoding="utf-8")

    with patch(
        "distributable_harness.cli.run_tool_wizard",
        return_value={"claude": True, "codex": True, "gemini": True},
    ), patch("builtins.input", side_effect=["1", "o", "all", "y", "y", "y"]):
        assert main(["setup", str(tmp_path)]) == 0

    captured = capsys.readouterr()
    assert "Fresh install plan - on apply, backup and replace all generated paths" in captured.err
    assert "Harness setup review ready." in captured.out
    assert "Harness setup applied." in captured.out
    assert not captured.out.lstrip().startswith("{")

    setup = json.loads((tmp_path / ".harness" / "state" / "setup.json").read_text(encoding="utf-8"))
    assert setup["mode"] == "apply"
    assert setup["applied_count"] > 0
    assert setup["next_command"] == "harness dashboard . --port 8765"
    assert (tmp_path / "projects" / "api" / "HANDOFF.md").exists()
    assert not api_dir.exists()


def test_setup_json_guided_mode_stops_after_review_manifest(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    with patch(
        "distributable_harness.cli.run_tool_wizard",
        return_value={"claude": True, "codex": True, "gemini": True},
    ), patch("builtins.input", side_effect=["", ""]):
        assert main(["setup", str(tmp_path), "--json"]) == 0

    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "dry-run"
    assert payload["applied_count"] == 0
    assert payload["next_command"] == "harness setup . --apply"


def test_setup_dry_run_default_prints_human_summary(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude"]) == 0
    captured = capsys.readouterr()
    assert "Harness setup review ready." in captured.out
    assert "Manifest:" in captured.out
    assert "harness setup . --apply" in captured.out
    assert not captured.out.lstrip().startswith("{")


def test_setup_apply_scaffolds_dry_run_confirmed_projects(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    api_dir = tmp_path / "api"
    web_dir = tmp_path / "web"
    api_dir.mkdir()
    web_dir.mkdir()
    (api_dir / "pyproject.toml").write_text("[project]\nname = \"api\"\n", encoding="utf-8")
    (web_dir / "package.json").write_text('{"name": "web"}\n', encoding="utf-8")

    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude", "--json"]) == 0
    dry_run_payload = json.loads(capsys.readouterr().out)
    assert [project["source_path"] for project in dry_run_payload["confirmed_projects"]] == ["api", "web"]
    assert [project["path"] for project in dry_run_payload["confirmed_projects"]] == ["projects/api", "projects/web"]

    assert main(["setup", str(tmp_path), "--apply", "--tools", "claude", "--json"]) == 0
    apply_payload = json.loads(capsys.readouterr().out)
    assert [project["path"] for project in apply_payload["confirmed_projects"]] == ["projects/api", "projects/web"]
    assert not api_dir.exists()
    assert not web_dir.exists()
    assert (tmp_path / "projects" / "api" / "pyproject.toml").exists()
    assert (tmp_path / "projects" / "api" / "HANDOFF.md").exists()
    assert (tmp_path / "projects" / "api" / "UPDATE.txt").exists()
    assert (tmp_path / "projects" / "api" / "internal" / "plans" / "active" / ".gitkeep").exists()
    assert (tmp_path / "projects" / "api" / "internal" / "plans" / "completed" / ".gitkeep").exists()
    assert (tmp_path / "projects" / "api" / "internal" / "resources" / ".gitkeep").exists()
    assert (tmp_path / "projects" / "api" / "internal" / "state" / ".gitkeep").exists()
    assert (tmp_path / "projects" / "api" / "external" / ".gitkeep").exists()
    assert (tmp_path / "projects" / "web" / "package.json").exists()
    assert (tmp_path / "projects" / "web" / "HANDOFF.md").exists()
    assert (tmp_path / "projects" / "web" / "UPDATE.txt").exists()


def test_update_reinstalls_from_repo(capsys: pytest.CaptureFixture[str]) -> None:
    result = type("Result", (), {"returncode": 0})()
    with patch("distributable_harness.cli.subprocess.run", return_value=result) as run:
        assert main(["--update"]) == 0

    command = run.call_args.args[0]
    assert command[:5] == [
        __import__("sys").executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
    ]
    assert "--force-reinstall" in command
    assert "git+https://github.com/spokeo/atlas.git@main#subdirectory=distributable-harness" in command
    output = capsys.readouterr().out
    assert "Update complete." in output
    assert "harness setup" in output


def test_setup_apply_rejects_project_layout_conflict(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    (api_dir / "pyproject.toml").write_text("[project]\nname = \"api\"\n", encoding="utf-8")

    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude", "--json"]) == 0
    capsys.readouterr()

    conflict = tmp_path / "projects" / "api"
    conflict.mkdir(parents=True)
    (conflict / "README.md").write_text("# conflict\n", encoding="utf-8")

    assert main(["setup", str(tmp_path), "--apply", "--tools", "claude", "--json"]) == 1
    assert "target project already exists" in capsys.readouterr().err


def test_setup_apply_without_dry_run_prints_next_steps(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    with patch("distributable_harness.cli.detect_tools", side_effect=AssertionError("tool detection should not run")):
        assert main(["setup", str(tmp_path), "--apply", "--non-interactive"]) == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert "harness setup --apply could not apply generated harness files." in captured.err
    assert "Reason: dry-run manifest is required before apply" in captured.err
    assert "harness setup . --dry-run" in captured.err
    assert "harness setup . --apply" in captured.err
    assert ".harness/state/generation_manifest.json" in captured.err
    assert "No repository files were changed by this failed apply." in captured.err
    assert "Traceback" not in captured.err


def test_setup_apply_stale_manifest_prints_next_steps(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude", "--json"]) == 0
    capsys.readouterr()

    manifest_path = tmp_path / ".harness" / "state" / "generation_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["profile_version"] = "0.0.0"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert main(["setup", str(tmp_path), "--apply", "--tools", "claude"]) == 1
    captured = capsys.readouterr()
    assert "manifest profile metadata is stale" in captured.err
    assert "harness setup . --dry-run" in captured.err
    assert "harness setup . --apply" in captured.err
    assert "Traceback" not in captured.err


def test_rollback_reverses_project_layout_move_and_scaffold(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    (api_dir / "pyproject.toml").write_text("[project]\nname = \"api\"\n", encoding="utf-8")

    assert main(["setup", str(tmp_path), "--dry-run", "--tools", "claude", "--json"]) == 0
    capsys.readouterr()
    assert main(["setup", str(tmp_path), "--apply", "--tools", "claude", "--json"]) == 0
    capsys.readouterr()
    assert not api_dir.exists()
    assert (tmp_path / "projects" / "api" / "HANDOFF.md").exists()

    assert main(["rollback", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["project_moves_reverted"] == [{"source_path": "api", "path": "projects/api"}]
    assert (api_dir / "pyproject.toml").exists()
    assert not (api_dir / "HANDOFF.md").exists()
    assert not (tmp_path / "projects" / "api").exists()


def test_audit_missing_skills_dir_exits_one(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    result = main(["audit", str(tmp_path)])
    assert result == 1
    assert "No .claude/skills/ found" in capsys.readouterr().err


def test_audit_valid_skills_dir_exits_zero(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    skills_dir = tmp_path / ".claude" / "skills" / "my-skill"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text(
        "---\nname: my-skill\ndescription: Processes data. Use when the user asks about data.\n---\n\n# Body\n",
        encoding="utf-8",
    )
    result = main(["audit", str(tmp_path)])
    assert result == 0


def test_audit_invalid_skill_exits_one(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    skills_dir = tmp_path / ".claude" / "skills" / "bad-skill"
    skills_dir.mkdir(parents=True)
    (skills_dir / "SKILL.md").write_text(
        "---\nname: anthropic-helper\ndescription: Use when needed.\n---\n\n# Body\n",
        encoding="utf-8",
    )
    result = main(["audit", str(tmp_path)])
    assert result == 1


def test_check_tools_exits_zero_when_claude_present(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    with patch("distributable_harness.tool_check.shutil.which") as mock_which, \
         patch("builtins.input", return_value=""):
        mock_which.side_effect = lambda name: "/usr/bin/claude" if name == "claude" else None
        result = main(["check-tools", str(tmp_path)])
    assert result == 0


def test_check_tools_exits_one_when_claude_missing(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    with patch("distributable_harness.tool_check.shutil.which") as mock_which, \
         patch("builtins.input", return_value=""):
        mock_which.return_value = None
        result = main(["check-tools", str(tmp_path)])
    assert result == 1


def test_lint_command_in_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["--help"])
    assert exc.value.code == 0
    assert "lint" in capsys.readouterr().out


def test_lint_exits_zero_on_empty_workspace(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    result = main(["lint", str(tmp_path)])
    assert result == 0
    output = capsys.readouterr().out
    assert "Wiki Index" in output
    assert "Hook Registration" in output


def test_doctor_includes_lint_key(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["doctor", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "lint" in payload
    assert "errors" in payload["lint"]
    assert "warnings" in payload["lint"]
    assert "checks" in payload["lint"]


# --- Wiki CLI Tests ---


def test_wiki_help_shows_subcommands(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["wiki", "--help"])
    assert exc.value.code == 0
    output = capsys.readouterr().out
    for subcommand in ("init", "preflight", "status", "lint", "search"):
        assert subcommand in output


def test_wiki_init_creates_expected_files(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["wiki", "init", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "created" in payload
    assert "wiki_root" in payload
    assert "settings_path" in payload
    assert "next_command" in payload
    assert (tmp_path / ".claude" / "wiki" / "index.md").exists()
    assert (tmp_path / ".claude" / "wiki" / "log.md").exists()


def test_wiki_preflight_outputs_json_receipt(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    # Initialize wiki first
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()  # Clear output

    assert main(["wiki", "preflight", str(tmp_path), "--task", "test task"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "receipt_id" in payload
    assert "receipt_path" in payload
    assert "created_at" in payload
    assert "expires_at" in payload
    assert payload["mode"] == "read"
    assert "required_reads" in payload


def test_wiki_preflight_maintenance_mode(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    assert main(["wiki", "preflight", str(tmp_path), "--task", "maintenance work", "--mode", "maintenance"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "maintenance"


def test_wiki_status_outputs_json_state(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    assert main(["wiki", "status", str(tmp_path)]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "wiki_root" in payload
    assert "page_count" in payload
    assert "page_counts_by_family" in payload
    assert "raw_counts" in payload
    assert "maintenance_backlog" in payload


def test_wiki_lint_returns_zero_on_valid_wiki(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    # Initialize wiki structure
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    # Valid wiki with just index and log has some expected issues (missing pages in families)
    # but lint should still return a result
    result = main(["wiki", "lint", str(tmp_path)])
    payload = json.loads(capsys.readouterr().out)
    assert "issues" in payload
    assert "count" in payload
    assert isinstance(payload["issues"], list)
    assert isinstance(payload["count"], int)
    # Exit code matches presence of issues
    expected_exit = 1 if payload["count"] > 0 else 0
    assert result == expected_exit


def test_wiki_lint_returns_one_on_invalid_wiki(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    # Create a wiki with a broken page
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    # Create a malformed wiki page (missing required sections)
    bad_page = tmp_path / ".claude" / "wiki" / "wiki" / "projects" / "bad-page.md"
    bad_page.parent.mkdir(parents=True, exist_ok=True)
    bad_page.write_text("# Bad Page\n\nNo required sections.\n", encoding="utf-8")

    result = main(["wiki", "lint", str(tmp_path)])
    payload = json.loads(capsys.readouterr().out)
    assert result == 1
    assert payload["count"] > 0
    assert any("missing section" in issue for issue in payload["issues"])


def test_wiki_search_returns_json_hits(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    assert main(["wiki", "search", str(tmp_path), "wiki"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "hits" in payload
    assert "count" in payload
    assert isinstance(payload["hits"], list)
    assert isinstance(payload["count"], int)


def test_wiki_search_with_limit(tmp_path, capsys: pytest.CaptureFixture[str]) -> None:
    main(["wiki", "init", str(tmp_path)])
    capsys.readouterr()

    assert main(["wiki", "search", str(tmp_path), "index", "--limit", "5"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert "hits" in payload
    assert len(payload["hits"]) <= 5


def test_wiki_init_help(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["wiki", "init", "--help"])
    assert exc.value.code == 0
    output = capsys.readouterr().out
    assert "workspace" in output
