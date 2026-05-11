/**
 * GET  /api/tasks          — list all tasks (optional ?status=&agent= filters)
 * POST /api/tasks          — create task
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createTask, listTasks } from "@/lib/data/tasks";
import { TaskStatusSchema, AgentSchema } from "@/schemas/task";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const agent = req.nextUrl.searchParams.get("agent") ?? undefined;

  const filter: Record<string, string> = {};
  if (status) {
    const parsed = TaskStatusSchema.safeParse(status);
    if (parsed.success) filter.status = parsed.data;
  }
  if (agent) {
    const parsed = AgentSchema.safeParse(agent);
    if (parsed.success) filter.agent = parsed.data;
  }

  const tasks = listTasks(workspace, filter as Parameters<typeof listTasks>[1]);
  return NextResponse.json({ tasks, total: tasks.length });
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  agent: AgentSchema.optional(),
  project: z.string().nullable().optional(),
  skill: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  tags: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const task = await createTask(workspace, body);
  return NextResponse.json({ task }, { status: 201 });
}
