/**
 * POST /api/wizard/run — Execute the setup check wizard.
 *
 * Performs 7 sequential checks on the workspace:
 *   1. Workspace detection
 *   2. AGENTS.md exists
 *   3. Skill discovery count
 *   4. Wiki index exists
 *   5. Dashboard config readable/writable
 *   6. .harness/state/ writable
 *   7. harness lint summary
 */

import { NextResponse } from "next/server";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface StepResult {
  id: number;
  status: "done" | "error";
  output: string;
}

export async function POST(): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const steps: StepResult[] = [];
  let errors = 0;
  let skillCount = 0;
  let port = 8768;

  function pass(id: number, msg: string) { steps.push({ id, status: "done", output: msg }); }
  function fail(id: number, msg: string) { steps.push({ id, status: "error", output: msg }); errors++; }

  // Step 1 — Workspace
  if (fs.existsSync(workspace)) {
    pass(1, `Workspace: ${workspace}`);
  } else {
    fail(1, `Workspace not found: ${workspace}`);
  }

  // Step 2 — AGENTS.md
  const agentsMd = path.join(workspace, "AGENTS.md");
  if (fs.existsSync(agentsMd)) {
    pass(2, "AGENTS.md present");
  } else {
    fail(2, "AGENTS.md not found — run harness setup first");
  }

  // Step 3 — Skill discovery
  const skillsDir = path.join(workspace, ".claude", "skills");
  if (fs.existsSync(skillsDir)) {
    const domains = fs.readdirSync(skillsDir).filter((d) => {
      try { return fs.statSync(path.join(skillsDir, d)).isDirectory(); } catch { return false; }
    });
    for (const domain of domains) {
      const domainPath = path.join(skillsDir, domain);
      const skills = fs.readdirSync(domainPath).filter((f) => {
        return fs.existsSync(path.join(domainPath, f, "SKILL.md")) ||
               (f === "SKILL.md" && false); // flat layout check
      });
      skillCount += skills.length;
    }
    if (skillCount > 0) {
      pass(3, `${skillCount} skills discovered in ${domains.length} domain(s)`);
    } else {
      fail(3, ".claude/skills/ exists but no SKILL.md files found");
    }
  } else {
    fail(3, ".claude/skills/ not found");
  }

  // Step 4 — Wiki index
  const wikiIndex = path.join(workspace, ".claude", "wiki", "index.md");
  if (fs.existsSync(wikiIndex)) {
    pass(4, "wiki/index.md present");
  } else {
    fail(4, ".claude/wiki/index.md not found — run `harness wiki init`");
  }

  // Step 5 — Dashboard config
  const configPath = path.join(workspace, ".harness", "config", "dashboard.json");
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      port = cfg.port ?? 8768;
      pass(5, `dashboard.json valid — port ${port}, ${(cfg.domainOrder ?? []).length} domain(s)`);
    } catch {
      fail(5, "dashboard.json exists but is not valid JSON");
    }
  } else {
    // Auto-create minimal config
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ port: 8768, theme: "dark", domainOrder: ["daily", "ops"] }, null, 2), "utf-8");
      pass(5, "dashboard.json not found — created minimal config");
    } catch {
      fail(5, "Could not create dashboard.json — check permissions");
    }
  }

  // Step 6 — State directory writable
  const stateDir = path.join(workspace, ".harness", "state");
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const probe = path.join(stateDir, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    pass(6, `.harness/state/ writable`);
  } catch (e) {
    fail(6, `.harness/state/ not writable: ${(e as Error).message}`);
  }

  // Step 7 — Harness lint (summarize)
  const lintResult = spawnSync("harness", ["lint", workspace], {
    encoding: "utf-8", timeout: 15_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  const lintOut = lintResult.stdout ?? "";
  const passCount = (lintOut.match(/^✓/gm) ?? []).length;
  const failCount = (lintOut.match(/^✗/gm) ?? []).length;
  const warnCount = (lintOut.match(/^⚠/gm) ?? []).length;

  if (lintResult.error) {
    fail(7, "harness lint not available — install agentos-harness");
  } else if (failCount > 0) {
    fail(7, `lint: ✓${passCount} ✗${failCount} ⚠${warnCount} — see OPS page for details`);
  } else {
    pass(7, `lint: ✓${passCount} ⚠${warnCount} — all checks ${failCount === 0 ? "passed" : "clean"}`);
  }

  return NextResponse.json({
    steps,
    workspace,
    port,
    skills: skillCount,
    errors,
  });
}
