/**
 * GET    /api/tasks/[id]   — get single task
 * PATCH  /api/tasks/[id]   — update task fields
 * DELETE /api/tasks/[id]   — delete task
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTaskById, updateTask, deleteTask } from "@/lib/data/tasks";
import { TaskStatusSchema, AgentSchema } from "@/schemas/task";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const task = getTaskById(workspace, id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  agent: AgentSchema.optional(),
  project: z.string().nullable().optional(),
  skill: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  tags: z.array(z.string()).optional(),
  activePid: z.number().nullable().optional(),
  continuationCount: z.number().int().min(0).optional(),
  costAccumulated: z.number().min(0).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const task = await updateTask(workspace, id, body);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const deleted = await deleteTask(workspace, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
