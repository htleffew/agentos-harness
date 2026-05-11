"""Tests for dashboard lint check (§12.3) and dashboard validate check (§12.4)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from agentos_harness.linter import check_dashboard_config
from agentos_harness.validate import validate_dashboard_tasks


# ── §12.3 check_dashboard_config ──────────────────────────────────────────────


def _make_tmp() -> Path:
    return Path(tempfile.mkdtemp())


def _write_config(root: Path, data: object) -> None:
    path = root / ".harness" / "config"
    path.mkdir(parents=True, exist_ok=True)
    (path / "dashboard.json").write_text(
        json.dumps(data) if not isinstance(data, str) else data,
        encoding="utf-8",
    )


class TestCheckDashboardConfig:
    def test_missing_file_returns_warn(self):
        root = _make_tmp()
        r = check_dashboard_config(root)
        assert r.status == "warn"
        assert "dashboard install" in r.message

    def test_invalid_json_returns_fail(self):
        root = _make_tmp()
        _write_config(root, "{{not json")
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert "not valid JSON" in r.message

    def test_json_array_returns_fail(self):
        root = _make_tmp()
        _write_config(root, [1, 2, 3])
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert "JSON object" in r.message

    def test_port_out_of_range_returns_fail(self):
        root = _make_tmp()
        _write_config(root, {"port": 80, "theme": "dark", "domainOrder": ["daily"]})
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert any("port" in d for d in r.details)

    def test_wrong_theme_returns_fail(self):
        root = _make_tmp()
        _write_config(root, {"port": 8768, "theme": "light", "domainOrder": ["daily"]})
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert any("theme" in d for d in r.details)

    def test_empty_domain_order_returns_fail(self):
        root = _make_tmp()
        _write_config(root, {"port": 8768, "theme": "dark", "domainOrder": []})
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert any("domainOrder" in d for d in r.details)

    def test_valid_config_returns_pass(self):
        root = _make_tmp()
        _write_config(root, {
            "port": 8768,
            "theme": "dark",
            "domainOrder": ["daily", "ops"],
            "concurrencyLimit": 2,
            "maxContinuations": 3,
            "recencyWeight": 0.6,
            "frequencyWeight": 0.4,
        })
        r = check_dashboard_config(root)
        assert r.status == "pass"
        assert "8768" in r.message

    def test_pinned_skill_not_found_returns_fail(self):
        root = _make_tmp()
        # Create skills dir but not the pinned skill
        (root / ".claude" / "skills" / "daily").mkdir(parents=True)
        _write_config(root, {
            "port": 8768,
            "theme": "dark",
            "domainOrder": ["daily"],
            "pinnedSkill": "nonexistent-skill",
        })
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert any("pinnedSkill" in d for d in r.details)

    def test_pinned_skill_found_returns_pass(self):
        root = _make_tmp()
        (root / ".claude" / "skills" / "daily" / "planning-work").mkdir(parents=True)
        _write_config(root, {
            "port": 8768,
            "theme": "dark",
            "domainOrder": ["daily"],
            "pinnedSkill": "planning-work",
        })
        r = check_dashboard_config(root)
        assert r.status == "pass"

    def test_multiple_field_errors_all_reported(self):
        root = _make_tmp()
        _write_config(root, {
            "port": 99,
            "theme": "light",
            "domainOrder": [],
            "concurrencyLimit": 99,
        })
        r = check_dashboard_config(root)
        assert r.status == "fail"
        assert len(r.details) >= 3


# ── §12.4 validate_dashboard_tasks ────────────────────────────────────────────


def _write_tasks(root: Path, tasks: list) -> None:
    state = root / ".harness" / "state"
    state.mkdir(parents=True, exist_ok=True)
    (state / "dashboard-tasks.json").write_text(
        json.dumps(tasks), encoding="utf-8"
    )


def _write_missions(root: Path, missions: list) -> None:
    state = root / ".harness" / "state"
    state.mkdir(parents=True, exist_ok=True)
    (state / "dashboard-missions.json").write_text(
        json.dumps(missions), encoding="utf-8"
    )


class TestValidateDashboardTasks:
    def test_no_state_files_is_skipped(self):
        root = _make_tmp()
        result = validate_dashboard_tasks(root)
        assert result["passed"] is True
        assert result["skipped"] is True

    def test_tasks_in_progress_without_pid_is_stuck(self):
        root = _make_tmp()
        _write_tasks(root, [
            {"id": "abc-123", "title": "Deploy", "status": "IN_PROGRESS", "activePid": None},
        ])
        result = validate_dashboard_tasks(root)
        assert result["passed"] is False
        assert len(result["stuck_tasks"]) == 1
        assert "Deploy" in result["stuck_tasks"][0]

    def test_tasks_in_progress_with_pid_not_stuck(self):
        root = _make_tmp()
        _write_tasks(root, [
            {"id": "abc-123", "title": "Deploy", "status": "IN_PROGRESS", "activePid": 12345},
        ])
        result = validate_dashboard_tasks(root)
        assert result["passed"] is True
        assert result["stuck_tasks"] == []

    def test_done_tasks_not_stuck(self):
        root = _make_tmp()
        _write_tasks(root, [
            {"id": "abc-123", "title": "Done task", "status": "DONE", "activePid": None},
        ])
        result = validate_dashboard_tasks(root)
        assert result["passed"] is True

    def test_running_mission_without_daemon_is_orphaned(self):
        root = _make_tmp()
        # No pids file → daemon is stopped
        _write_missions(root, [
            {"id": "xyz-456", "title": "Nightly sync", "status": "RUNNING"},
        ])
        result = validate_dashboard_tasks(root)
        assert result["passed"] is False
        assert len(result["orphaned_missions"]) == 1
        assert "Nightly sync" in result["orphaned_missions"][0]

    def test_draft_mission_without_daemon_not_orphaned(self):
        root = _make_tmp()
        _write_missions(root, [
            {"id": "xyz-456", "title": "Pending", "status": "DRAFT"},
        ])
        result = validate_dashboard_tasks(root)
        assert result["passed"] is True

    def test_malformed_tasks_file_does_not_crash(self):
        root = _make_tmp()
        state = root / ".harness" / "state"
        state.mkdir(parents=True, exist_ok=True)
        (state / "dashboard-tasks.json").write_text("{{bad}}", encoding="utf-8")
        result = validate_dashboard_tasks(root)
        # Should not crash; stuck_tasks will be empty
        assert "stuck_tasks" in result
