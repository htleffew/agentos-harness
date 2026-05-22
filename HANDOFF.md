Audience: agent-facing operating brief for project resumption, routing, and execution.
Project posture: `infrastructure`

# Agentos Harness Handoff

## Summary

<What this project owns and why it exists.>

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
