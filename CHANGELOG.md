# Changelog

## 0.6.3

- Added Windows-safe project layout apply fallback: if an atomic directory
  rename fails with access denied, setup copies the confirmed project into its
  canonical `projects/<project>/` home and removes the original when possible.
- Added dynamic tool-tier coverage for every one-agent and two-agent
  permutation: `claude-only`, `codex-only`, `gemini-only`, `claude-codex`,
  `claude-gemini`, `codex-gemini`, and `full-moe`.
- Removed project `DISTRIBUTABLE-HARNESS-HANDOFF.md` and
  `DISTRIBUTABLE-HARNESS-UPDATE.txt` copies from the publishable package tree.
- Made package-source `harness lint .` mark generated-harness checks as not
  applicable before setup has been applied.

## 0.6.2

- Tightened guided setup behavior for existing-harness fresh installs.
- Clarified existing-harness migration choices as apply-time plans.
- Kept `harness setup --json` to one dry-run JSON payload instead of prompting
  for immediate apply after printing machine-readable output.
- Added adaptive workflow wiki sections and index backlinks so generated
  harness targets pass wiki validation after setup apply.
- Fixed generated canonical-layout validation so `harness validate` checks
  confirmed project continuity files instead of requiring root continuity files.

## 0.6.1

- Added the generated `agent-engineering-quality` skill, reference, and wiki page.
- Made the generated non-trivial default explicit:
  `/plan -> MoE plan consensus -> /execute -> /loop -> MoE completion audit -> done`.
- Made generated `plan_quality_gate.py` blocking for weak non-trivial plans.
- Added generated `engineering_quality_guard.py` to block completion attempts
  without required engineering-quality evidence.
- Extended generated `harness validate .` with Engineering Quality Contract and
  Engineering Quality Receipt checks.
- Extended generated `harness lint .` and dashboard health with an Engineering
  Quality signal.

## 0.4.1

- Fixed `UnboundLocalError` in project confirmation when user types "all".
- Added 10 new tests for interactive mode across project confirmation, existing harness wizard, discipline wizard, and tool wizard.
- Added Windows installation guidance to README for NTFS path compatibility.

## 0.4.0

- Added hash-based staleness tracking for wiki pages.
- Added semantic lint for contradiction detection between wiki pages.
- Added session learning extraction from activity logs.
- Added automatic synthesis capture for multi-source writes.

## 0.3.0

- Added operating discipline settings during setup.
- Added plan cold-reader quality gate option.
- Added loop-as-default mode option.

## 0.2.0

- Added project boundary detection and confirmation.
- Added project scaffolding with `_UPDATE.md` files.
- Added `plans/active/` and `plans/completed/` directory creation.

## 0.1.0

- Added installable package skeleton.
- Added deterministic workspace analyzer.
- Added adaptive `harness setup` workflow for first-run scan, dry-run manifest
  creation, apply, and optional dashboard launch.
- Added deterministic setup modules for Python packages, JavaScript or
  TypeScript applications, notebooks, documentation, CI release checks, and
  monorepos.
- Added `core` profile generation for root assistant guides, local wiki pages,
  workflow skills, slash-command wrappers, hook scripts, hook registration, and
  assistant discovery facades.
- Added profile metadata to dry-run manifests, apply mode, and rollback state.
- Added selected module metadata and unselected module reasons to dry-run
  manifests.
- Added apply rejection for manifests that do not carry current profile
  metadata.
- Added apply rejection for manifests with stale profile metadata.
- Added read-only local dashboard server and self-contained static dashboard.
- Added dashboard hook counts from generated hook scripts and settings.
- Added dashboard setup section for selected adaptive modules and next setup
  command.
- Added explicit `--host 0.0.0.0` dashboard support for forwarded-port
  development environments.
- Added SageMaker CodeEditor `/codeeditor/default/ports/<port>/` route support,
  with `/codeeditor/default/proxy/<port>/` retained as a
  compatibility route.
- Documented the CodeEditor browser helper command required to open the
  forwarded route from the terminal.
- Added fixture, profile-registry, generated-hook, generator, dashboard,
  end-to-end, and safety tests.
