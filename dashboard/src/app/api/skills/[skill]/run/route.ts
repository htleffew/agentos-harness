/**
 * POST /api/skills/[skill]/run — dispatch a skill session.
 *
 * Body: { agent?: "claude"|"codex"|"gemini", project?: string }
 * Returns: { runId, status }
 *
 * The actual process is spawned server-side; the client polls
 * GET /api/runs/stream?runId=<id> for the SSE stream.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { z } from "zod";
import { buildPreamble, type Agent } from "@/lib/harness/preflight";
import { createRun, updateRun } from "@/lib/dispatch/run-store";
import {
  createStreamParser,
  estimateCost,
  type AgentMode,
} from "@/lib/dispatch/stream-parser";

const BodySchema = z.object({
  agent: z.enum(["claude", "codex", "gemini"]).default("claude"),
  project: z.string().nullable().default(null),
});

const ACTIVITY_JSONL = path.join(".harness", "state", "activity.jsonl");

// Claude Sonnet 4 pricing (USD per million tokens)
const CLAUDE_INPUT_COST_PER_M  = 3.0;
const CLAUDE_OUTPUT_COST_PER_M = 15.0;

function computeClaudeCost(inputTokens: number, outputTokens: number): number {
  return parseFloat(
    ((inputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_M +
     (outputTokens / 1_000_000) * CLAUDE_OUTPUT_COST_PER_M).toFixed(6)
  );
}

function appendActivity(workspace: string, entry: object): void {
  const p = path.join(workspace, ACTIVITY_JSONL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.appendFileSync(p, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Silent on I/O error
  }
}

function readSkillContent(workspace: string, skillName: string): string | null {
  const skillsRoot = path.join(workspace, ".claude", "skills");
  if (!fs.existsSync(skillsRoot)) return null;
  for (const domain of fs.readdirSync(skillsRoot)) {
    const skillMd = path.join(skillsRoot, domain, skillName, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      return fs.readFileSync(skillMd, "utf-8");
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ skill: string }> }
): Promise<NextResponse> {
  const { skill } = await params;
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { agent, project } = body;

  const skillContent = readSkillContent(workspace, skill);
  if (skillContent === null) {
    return NextResponse.json(
      { error: `Skill "${skill}" not found in .claude/skills/` },
      { status: 404 }
    );
  }

  const prompt = buildPreamble({
    agent: agent as Agent,
    skillPrompt: skillContent,
    project,
    skillName: skill,
  });

  const now = new Date().toISOString();
  const runId = randomUUID();

  await createRun(workspace, {
    id: runId,
    skillName: skill,
    agent: agent as "claude" | "codex" | "gemini",
    pid: null,
    startedAt: now,
    costEstimate: 0,
    tokenInputs: 0,
    tokenOutputs: 0,
    taskId: null,
    projectDir: workspace,
  });

  appendActivity(workspace, {
    ts: now,
    tool: "DashboardDispatch",
    ok: true,
    desc: `skill:${skill}`,
    agent,
    runId,
  });

  const agentCmds: Record<AgentMode, string[]> = {
    claude: ["claude", "-p", prompt, "--output-format", "stream-json"],
    codex: ["codex", "-p", prompt],
    gemini: ["gemini", "--prompt", prompt],
  };
  const cmd = agentCmds[agent as AgentMode];
  const startMs = Date.now();

  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: workspace,
    env: { ...process.env, CLAUDE_PROJECT_DIR: workspace },
    stdio: ["ignore", "pipe", "pipe"],
  });

  await updateRun(workspace, runId, { pid: proc.pid ?? null, status: "RUNNING" });

  const streamDir = path.join(workspace, ".harness", "state", "run-streams");
  fs.mkdirSync(streamDir, { recursive: true });
  const streamFile = path.join(streamDir, `${runId}.jsonl`);
  const streamOut = fs.createWriteStream(streamFile, { flags: "a" });

  const parser = createStreamParser(agent as AgentMode, (evt) => {
    streamOut.write(JSON.stringify(evt) + "\n");
    if (evt.type === "cost") {
      const inputTok  = evt.inputTokens  ?? 0;
      const outputTok = evt.outputTokens ?? 0;
      const costUsd   = agent === "claude"
        ? computeClaudeCost(inputTok, outputTok)
        : 0; // Codex/Gemini cost computed from elapsed time at close
      void updateRun(workspace, runId, {
        tokenInputs:  inputTok,
        tokenOutputs: outputTok,
        costEstimate: costUsd,
      });
    }
  });

  proc.stdout.setEncoding("utf-8");
  proc.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split("\n")) parser(line);
  });

  proc.stderr.setEncoding("utf-8");
  proc.stderr.on("data", (chunk: string) => {
    streamOut.write(JSON.stringify({ type: "error", error: chunk }) + "\n");
  });

  proc.on("close", (code) => {
    const elapsedMs = Date.now() - startMs;
    const ok = code === 0;
    const status = ok ? "DONE" : "FAILED";
    let costEstimate = 0;
    if (agent !== "claude") {
      const rates = { codexBurnRatePerMin: 0.05, geminiBurnRatePerMin: 0.03 };
      costEstimate = estimateCost(agent as "codex" | "gemini", elapsedMs, rates);
    }
    streamOut.write(JSON.stringify({ type: "done", exitCode: code }) + "\n");
    streamOut.end();
    void updateRun(workspace, runId, {
      status,
      exitCode: code,
      completedAt: new Date().toISOString(),
      durationMs: elapsedMs,
      costEstimate,
    });
    appendActivity(workspace, {
      ts: new Date().toISOString(),
      tool: ok ? "DashboardComplete" : "DashboardError",
      ok,
      desc: `skill:${skill}`,
      agent,
      runId,
    });
  });

  return NextResponse.json({ runId, status: "RUNNING" }, { status: 202 });
}
