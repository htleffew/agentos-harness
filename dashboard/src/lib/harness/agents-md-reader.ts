/**
 * agents-md-reader.ts — Detect the installed harness tier from AGENTS.md / harness doctor.
 */

import fs from "fs";
import path from "path";

export type HarnessTier = "claude-only" | "claude-codex" | "claude-gemini" | "full-moe" | "unknown";

/** Detect available agent tier by reading AGENTS.md and checking tool presence. */
export function detectTier(workspace: string): HarnessTier {
  const agentsMd = path.join(workspace, "AGENTS.md");
  let content = "";
  if (fs.existsSync(agentsMd)) {
    content = fs.readFileSync(agentsMd, "utf-8").toLowerCase();
  }

  // Rough heuristic: look for mentions of codex/gemini in AGENTS.md
  const hasCodex = content.includes("codex");
  const hasGemini = content.includes("gemini");

  if (hasCodex && hasGemini) return "full-moe";
  if (hasCodex) return "claude-codex";
  if (hasGemini) return "claude-gemini";
  return "claude-only";
}
