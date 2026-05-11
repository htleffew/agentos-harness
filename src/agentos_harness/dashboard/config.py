"""DashboardConfig — read/write .harness/config/dashboard.json.

Schema mirrors the TypeScript dashboard-config.ts Zod schema (§14 of spec).
Pure stdlib — no Pydantic dependency required.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

DASHBOARD_CONFIG_PATH = Path(".harness") / "config" / "dashboard.json"

DEFAULT_DOMAIN_ORDER = ["daily", "productivity", "research", "content", "community", "ops", "custom"]
DEFAULT_PORT = 8768
DEFAULT_CONCURRENCY = 2
DEFAULT_MAX_CONTINUATIONS = 3
DEFAULT_RECENCY_WEIGHT = 0.6
DEFAULT_FREQUENCY_WEIGHT = 0.4


@dataclass
class CostEstimation:
    codex_burn_rate_per_min: float = 0.05
    gemini_burn_rate_per_min: float = 0.03

    def to_dict(self) -> dict[str, Any]:
        return {
            "codexBurnRatePerMin": self.codex_burn_rate_per_min,
            "geminiBurnRatePerMin": self.gemini_burn_rate_per_min,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CostEstimation":
        return cls(
            codex_burn_rate_per_min=float(d.get("codexBurnRatePerMin", 0.05)),
            gemini_burn_rate_per_min=float(d.get("geminiBurnRatePerMin", 0.03)),
        )


@dataclass
class DashboardConfig:
    port: int = DEFAULT_PORT
    theme: str = "dark"
    domain_order: list[str] = field(default_factory=lambda: list(DEFAULT_DOMAIN_ORDER))
    pinned_skill: str | None = None
    concurrency_limit: int = DEFAULT_CONCURRENCY
    max_continuations: int = DEFAULT_MAX_CONTINUATIONS
    recency_weight: float = DEFAULT_RECENCY_WEIGHT
    frequency_weight: float = DEFAULT_FREQUENCY_WEIGHT
    cost_estimation: CostEstimation = field(default_factory=CostEstimation)

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        return {
            "port": self.port,
            "theme": self.theme,
            "domainOrder": self.domain_order,
            "pinnedSkill": self.pinned_skill,
            "concurrencyLimit": self.concurrency_limit,
            "maxContinuations": self.max_continuations,
            "recencyWeight": self.recency_weight,
            "frequencyWeight": self.frequency_weight,
            "costEstimation": self.cost_estimation.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DashboardConfig":
        return cls(
            port=int(d.get("port", DEFAULT_PORT)),
            theme=str(d.get("theme", "dark")),
            domain_order=list(d.get("domainOrder", DEFAULT_DOMAIN_ORDER)),
            pinned_skill=d.get("pinnedSkill"),
            concurrency_limit=int(d.get("concurrencyLimit", DEFAULT_CONCURRENCY)),
            max_continuations=int(d.get("maxContinuations", DEFAULT_MAX_CONTINUATIONS)),
            recency_weight=float(d.get("recencyWeight", DEFAULT_RECENCY_WEIGHT)),
            frequency_weight=float(d.get("frequencyWeight", DEFAULT_FREQUENCY_WEIGHT)),
            cost_estimation=CostEstimation.from_dict(d.get("costEstimation", {})),
        )

    # ── Validation ────────────────────────────────────────────────────────────

    def validate(self) -> list[str]:
        """Return a list of validation error strings. Empty = valid."""
        errors: list[str] = []
        if not (1024 <= self.port <= 65535):
            errors.append(f"port must be 1024–65535, got {self.port}")
        if self.theme not in ("dark",):
            errors.append(f"theme must be 'dark', got '{self.theme}'")
        if not self.domain_order:
            errors.append("domainOrder must not be empty")
        if not (1 <= self.concurrency_limit <= 16):
            errors.append(f"concurrencyLimit must be 1–16, got {self.concurrency_limit}")
        if not (1 <= self.max_continuations <= 10):
            errors.append(f"maxContinuations must be 1–10, got {self.max_continuations}")
        if not (0.0 <= self.recency_weight <= 1.0):
            errors.append(f"recencyWeight must be 0.0–1.0, got {self.recency_weight}")
        if not (0.0 <= self.frequency_weight <= 1.0):
            errors.append(f"frequencyWeight must be 0.0–1.0, got {self.frequency_weight}")
        return errors


# ── File I/O ──────────────────────────────────────────────────────────────────


def config_path(workspace: Path) -> Path:
    return workspace / DASHBOARD_CONFIG_PATH


def load_config(workspace: Path) -> DashboardConfig:
    """Load dashboard config from .harness/config/dashboard.json.

    Returns defaults if the file does not exist.
    Raises ValueError if the file exists but is invalid JSON.
    """
    path = config_path(workspace)
    if not path.exists():
        return DashboardConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"dashboard.json is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("dashboard.json must be a JSON object")
    return DashboardConfig.from_dict(data)


def save_config(workspace: Path, cfg: DashboardConfig) -> None:
    """Write dashboard config to .harness/config/dashboard.json."""
    errors = cfg.validate()
    if errors:
        raise ValueError(f"Invalid dashboard config: {'; '.join(errors)}")
    path = config_path(workspace)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(cfg.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def config_exists(workspace: Path) -> bool:
    return config_path(workspace).exists()
