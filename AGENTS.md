# Roleplay Instructions

Apply the [mobile UX standard](docs/mobile-ux-standard.md) when designing or implementing features, repairing UI, auditing workflows, or running interactive QA. Use its task-based checks and document observed behavior and any remaining verification gaps.

## Prefer programmatic execution

For new features, repairs and audits, examine extension code and scripts, host macros, native SillyTavern and TauriTavern capabilities, and existing structured data first. Use a programmatic path whenever it can deliver the required behavior.

If the operation genuinely needs model output, check whether the ordinary reply request or an already authorized request can supply it at the right time without changing the requested behavior. Add a separate model call only for work that cannot be accomplished through those paths. Keep data gathering, validation, state changes and other deterministic steps in code.

Record the paths considered and the reason for any extra call in the design or audit. During QA, observe actual request counts with a fixture or request recorder, including failure and retry paths. Apply the documented disclosure, opt-in and saved connection rules to each necessary extra call.

## Preserve prompt caches and deliberate instruction order

Treat prompt-cache reuse and instruction placement as first-class criteria for feature design, implementation, repairs, audits and QA. Apply the [prompt assembly standard](docs/prompt-assembly-standard.md) before changing a request. Identify stable and changing content, preserve reusable prefixes where the route supports them, and verify that current instructions remain salient in the assembled request.
