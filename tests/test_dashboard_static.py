from __future__ import annotations

from pathlib import Path

STATIC = Path(__file__).parents[1] / "src/distributable_harness/static"


def test_dashboard_html_landmarks() -> None:
    html = (STATIC / "dashboard.html").read_text(encoding="utf-8")
    for text in ("Workspace Control Dashboard", "Refresh Scan", "Open Search", "Copy Command", "Copy Path"):
        assert text in html
    for metric in ("metricWiki", "metricSkills", "metricCommands", "metricHooks", "metricProjects", "metricMaintenance"):
        assert metric in html


def test_dashboard_css_contract() -> None:
    css = (STATIC / "dashboard.css").read_text(encoding="utf-8")
    for token in ("--dh-bg", "--dh-panel", "--dh-focus", "grid-template-columns: 300px", "@media (max-width: 900px)"):
        assert token in css
    assert "gradient" not in css.lower()


def test_dashboard_js_interactions() -> None:
    js = (STATIC / "dashboard.js").read_text(encoding="utf-8")
    for token in ("refreshScan", "copyCommand", "textSearch", "data-filter", "/api/refresh"):
        assert token in js
