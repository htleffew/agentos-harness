/**
 * POST /api/brain-dump/triage — AI triage of a brain dump entry.
 *
 * Spawns `claude -p <prompt> --output-format stream-json` with a structured
 * triage prompt. Parses Claude's response for a JSON block containing an array
 * of task objects. Returns parsed tasks ready for import to the Kanban.
 *
 * Falls back to heuristic parsing if Claude is unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { z } from "zod";
import { buildPreamble } from "@/lib/harness/preflight";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  text: z.string().min(1).max(10_000),
});

const TRIAGE_PROMPT = `You are a task triage assistant. The user has given you a raw brain dump of thoughts, ideas, and notes. Your job is to extract discrete, actionable tasks from it.

Return ONLY a JSON object (no markdown, no prose, no code fences) in this exact shape:
{
  "tasks": [
    {
      "title": "Short, action-oriented title (max 100 chars)",
      "description": "One sentence elaborating what needs to be done",
      "priority": "P1" | "P2" | "P3" | "P4",
      "agent": "claude" | "codex" | "gemini" | "unassigned",
      "tags": ["tag1", "tag2"],
      "eisenhower": "DO" | "SCHEDULE" | "DELEGATE" | "DELETE"
    }
  ]
}

Priority guide:
- P1 = Critical / fire-fighting
- P2 = Important, this week
- P3 = Nice to have, this month
- P4 = Someday / backlog

Eisenhower quadrant:
- DO = Urgent + Important
- SCHEDULE = Not urgent + Important
- DELEGATE = Urgent + Not important
- DELETE = Not urgent + Not important

Assign agent based on task nature:
- claude = research, writing, planning, analysis
- codex = code implementation, debugging, testing
- gemini = long-context analysis, visual/document review
- unassigned = unclear or mixed

BRAIN DUMP TEXT:
`;

interface TriagedTask {
  title: string;
  description: string;
  priority: string;
  agent: string;
  tags: string[];
  eisenhower: string;
}

function extractJsonBlock(text: string): unknown {
  // Try to find and parse a JSON object in the output
  const jsonMatch = text.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
  }
  // Try parsing entire output as JSON
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  return null;
}

function heuristicFallback(text: string): TriagedTask[] {
  // Basic heuristic: each line or bullet that looks like a task
  const tasks: TriagedTask[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.replace(/^[-*•·]\s*/, "").replace(/^\[\s*\]\s*/, "").trim();
    if (trimmed.length < 5) continue;
    tasks.push({
      title: trimmed.slice(0, 100),
      description: "",
      priority: "P3",
      agent: "unassigned",
      tags: [],
      eisenhower: "SCHEDULE",
    });
  }
  return tasks;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body — text required" }, { status: 400 });
  }

  const fullPrompt = buildPreamble({
    agent: "claude",
    skillPrompt: TRIAGE_PROMPT + body.text,
    skillName: "brain-dump-triage",
  });

  // Spawn claude synchronously with a tight timeout
  const result = spawnSync(
    "claude",
    ["-p", fullPrompt, "--output-format", "stream-json"],
    {
      cwd: workspace,
      env: { ...process.env, CLAUDE_PROJECT_DIR: workspace },
      encoding: "utf-8",
      timeout: 60_000, // 60 second max
    }
  );

  let tasks: TriagedTask[] = [];
  let usedAI = false;

  if (!result.error && result.status === 0 && result.stdout) {
    // Collect all text deltas from stream-json
    let assembled = "";
    for (const line of result.stdout.split("\n")) {
      try {
        const evt = JSON.parse(line.trim());
        if (evt.type === "content_block_delta" && evt.delta?.text) {
          assembled += evt.delta.text;
        }
      } catch { /* skip non-JSON lines */ }
    }

    const parsed = extractJsonBlock(assembled);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).tasks)) {
      const raw = (parsed as { tasks: unknown[] }).tasks;
      tasks = raw.map((t) => {
        const task = t as Partial<TriagedTask>;
        return {
          title:       String(task.title       ?? "Untitled task").slice(0, 100),
          description: String(task.description ?? ""),
          priority:    ["P1","P2","P3","P4"].includes(task.priority ?? "") ? task.priority! : "P3",
          agent:       ["claude","codex","gemini","unassigned"].includes(task.agent ?? "") ? task.agent! : "unassigned",
          tags:        Array.isArray(task.tags) ? task.tags.map(String) : [],
          eisenhower:  ["DO","SCHEDULE","DELEGATE","DELETE"].includes(task.eisenhower ?? "") ? task.eisenhower! : "SCHEDULE",
        };
      });
      usedAI = true;
    }
  }

  if (tasks.length === 0) {
    // Fall back to heuristic
    tasks = heuristicFallback(body.text);
  }

  return NextResponse.json({ tasks, usedAI, count: tasks.length });
}
