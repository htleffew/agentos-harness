/**
 * GET    /api/missions/[id]        — get mission
 * PATCH  /api/missions/[id]        — update mission (status, continuationCount, etc.)
 * DELETE /api/missions/[id]        — delete mission
 * POST   /api/missions/[id]/launch — start/resume a mission dispatch loop
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMissionById, updateMission, deleteMission } from "@/lib/data/missions";
import { MissionStatusSchema } from "@/schemas/mission";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const mission = getMissionById(workspace, id);
  if (!mission) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ mission });
}

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  objective: z.string().optional(),
  status: MissionStatusSchema.optional(),
  currentSkillIndex: z.number().int().min(0).optional(),
  continuationCount: z.number().int().min(0).optional(),
  failCount: z.number().int().min(0).optional(),
  costAccumulated: z.number().min(0).optional(),
  runIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  try {
    const body = PatchSchema.parse(await req.json());
    const mission = await updateMission(workspace, id, body);
    if (!mission) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ mission });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const deleted = await deleteMission(workspace, id);
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
