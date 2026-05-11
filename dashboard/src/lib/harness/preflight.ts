/**
 * preflight.ts — Preamble builder (TypeScript mirror of Python preflight.py)
 *
 * Implements §5 of AGENTIC-OS-DASHBOARD-SPEC.md.
 */

export type Agent = "claude" | "codex" | "gemini";

const BASE_SURFACES = [
  { key: "wiki_index", path: ".claude/wiki/index.md" },
  { key: "agents_md", path: "AGENTS.md" },
  { key: "claude_md", path: "CLAUDE.md" },
  { key: "skills_index", path: ".claude/skills.json" },
];

const OUTPUT_FORMAT = `
Format your final response with these sections:

## OUTPUT
(the substantive result)

## SOURCES
(URLs used, one per line, prefixed with ·)

## FILE
(path where output was saved, if applicable)
`;

export interface PreambleOptions {
  agent: Agent;
  skillPrompt: string;
  project?: string | null;
  skillName?: string | null;
}

export function buildPreamble(opts: PreambleOptions): string {
  const { agent, skillPrompt, project, skillName } = opts;
  const surfaceLines: string[] = [];

  for (let i = 0; i < BASE_SURFACES.length; i++) {
    surfaceLines.push(`${i + 1}. Read \`${BASE_SURFACES[i].path}\``);
  }

  if (agent === "codex") {
    surfaceLines.push(`${surfaceLines.length + 1}. Read \`CODEX.md\``);
  }

  if (project) {
    const n = surfaceLines.length + 1;
    surfaceLines.push(`${n}. Read \`projects/${project}/HANDOFF.md\``);
    surfaceLines.push(`${n + 1}. Read \`.claude/wiki/wiki/projects/${project}.md\` (if it exists)`);
  }

  if (skillName) {
    const n = surfaceLines.length + 1;
    surfaceLines.push(`${n}. Read \`.claude/skills/${skillName}/SKILL.md\` before modifying it`);
    surfaceLines.push(`${n + 1}. Read \`.claude/SKILL_STANDARDS.md\``);
  }

  const total = surfaceLines.length;
  const block = surfaceLines.join("\n");

  return `DASHBOARD SESSION PREFLIGHT

Before taking any action, read these knowledge surfaces in order:
${block}

These reads satisfy the knowledge_preflight_guard requirement. Do not write,
edit, or spawn sub-agents until all ${total} read${total !== 1 ? "s" : ""} are complete.

After reading, proceed with the following task:
${OUTPUT_FORMAT}
---

${skillPrompt}`;
}
