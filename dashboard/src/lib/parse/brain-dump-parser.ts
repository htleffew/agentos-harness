/**
 * brain-dump-parser.ts — Heuristic text → task conversion.
 *
 * Supported patterns:
 *   - Lines starting with "-", "*", "•", "→", ">" → individual tasks
 *   - Lines starting with "[ ]" or "- [ ]" → tasks (markdown checklist)
 *   - Lines starting with "[x]" or "- [x]" → skip (already done)
 *   - Bare non-empty lines (not part of a block) → individual tasks
 *   - #P1 / #P2 / #P3 / #P4 tag → sets priority
 *   - @claude / @codex / @gemini → sets agent
 *   - #tag → adds as tag
 */

export interface ParsedTask {
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4;
  agent: "claude" | "codex" | "gemini" | "unassigned";
  tags: string[];
}

const BULLET_RE = /^[-*•→>]\s+/;
const UNCHECKED_RE = /^\[[ ]\]\s*/;
const LIST_ITEM_RE = /^(?:[-*•→>]\s+|\[[ ]\]\s+)/;

const PRIORITY_RE = /#[Pp]([1-4])\b/;
const AGENT_RE = /@(claude|codex|gemini)\b/i;
const TAG_RE = /#([a-zA-Z]\w*)\b/g;

function extractMeta(line: string): {
  cleaned: string;
  priority: 1 | 2 | 3 | 4;
  agent: "claude" | "codex" | "gemini" | "unassigned";
  tags: string[];
} {
  let cleaned = line;
  let priority: 1 | 2 | 3 | 4 = 3;
  let agent: "claude" | "codex" | "gemini" | "unassigned" = "unassigned";
  const tags: string[] = [];

  const pMatch = PRIORITY_RE.exec(cleaned);
  if (pMatch) {
    priority = Number(pMatch[1]) as 1 | 2 | 3 | 4;
    cleaned = cleaned.replace(pMatch[0], "").trim();
  }

  const aMatch = AGENT_RE.exec(cleaned);
  if (aMatch) {
    agent = aMatch[1].toLowerCase() as "claude" | "codex" | "gemini";
    cleaned = cleaned.replace(aMatch[0], "").trim();
  }

  // Collect remaining #tags
  let tagMatch: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((tagMatch = TAG_RE.exec(cleaned)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    if (!["p1", "p2", "p3", "p4"].includes(tag)) tags.push(tag);
  }
  cleaned = cleaned.replace(TAG_RE, "").trim();

  // Strip bullet prefix
  cleaned = cleaned.replace(BULLET_RE, "").replace(UNCHECKED_RE, "").trim();

  return { cleaned, priority, agent, tags };
}

export function parseBrainDump(text: string): ParsedTask[] {
  const lines = text.split(/\r?\n/);
  const tasks: ParsedTask[] = [];
  let descBuffer = "";
  let currentTask: ParsedTask | null = null;

  const flush = () => {
    if (currentTask) {
      if (descBuffer.trim()) currentTask.description = descBuffer.trim();
      tasks.push(currentTask);
      currentTask = null;
      descBuffer = "";
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip blank lines — flush current task
    if (!line.trim()) {
      flush();
      continue;
    }

    // Skip already-done checkboxes (e.g. "- [x] ..." or "[x] ...")
    if (/^(?:[-*•→>]\s+)?\[[xX]\]/.test(line.trimStart())) continue;

    // List item → new task
    if (LIST_ITEM_RE.test(line.trimStart()) || UNCHECKED_RE.test(line.trimStart())) {
      flush();
      const { cleaned, priority, agent, tags } = extractMeta(line.trimStart());
      if (cleaned) {
        currentTask = { title: cleaned, description: "", priority, agent, tags };
      }
      continue;
    }

    // Indented continuation → description of current task
    if (currentTask && /^\s{2,}/.test(rawLine)) {
      descBuffer += (descBuffer ? " " : "") + line.trim();
      continue;
    }

    // Non-empty, non-indented, non-list line → new standalone task
    flush();
    const { cleaned, priority, agent, tags } = extractMeta(line.trim());
    if (cleaned) {
      currentTask = { title: cleaned, description: "", priority, agent, tags };
    }
  }

  flush();

  // Deduplicate by title
  const seen = new Set<string>();
  return tasks.filter((t) => {
    if (seen.has(t.title)) return false;
    seen.add(t.title);
    return true;
  });
}
