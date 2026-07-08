Audience: agent-facing operating brief for project resumption, routing, and execution.
Project posture: `infrastructure`

# Agentos Harness Handoff

## Summary

`agentos-harness` installs a local AI assistant harness (operating guides,
workflow skills, slash commands, safety hooks) into a developer repository,
tailored to that repo's detected structure and available AI tools (Claude Code,
Codex CLI, Gemini CLI, or any two/three-tool combination). Distributed as a pip
package (`git+https://github.com/htleffew/agentos-harness.git@master`), driven
via `harness setup` (guided, reviews planned changes before applying) and
`harness validate`/`harness lint` (post-apply health checks on the generated
target repo).

- Verified state: 1e77465 2026-07-08 chore: update graphify-out/ (branch master, working tree clean). Last substantive commit: 33268f7 2026-06-19 Make agentos-harness vendor-agnostic.
- Current version: 0.6.3 (see CHANGELOG.md) -- Windows-safe layout-apply fallback, dynamic tool-tier coverage for every one/two-agent permutation, publishable-package tree cleanup.

## Current Authority

- `HANDOFF.md`: agent-facing operating brief.
- `UPDATE.txt`: human-facing status log.

## Read Order

1. Root `AGENTS.md`
2. Root assistant supplement for the active agent
3. `.claude/wiki/index.md`
4. This `HANDOFF.md`
5. `UPDATE.txt`
6. Active plans under `internal/plans/active/`
7. Project-owned source and delivery surfaces

## Directory Contract

| Path | Purpose |
|---|---|
| `internal/` | Project-local plans, scripts, resources, state, and working artifacts |
| `internal/plans/active/` | Active implementation plans |
| `internal/plans/completed/` | Completed implementation plans |
| `external/` | Curated colleague-facing deliverables only |

## Routing Rules

- Start project work from `projects/agentos-harness/`.
- Keep project-local execution material under `internal/`.
- Keep only curated deliverables under `external/`.
- Update `HANDOFF.md` and `UPDATE.txt` when durable project context changes.
