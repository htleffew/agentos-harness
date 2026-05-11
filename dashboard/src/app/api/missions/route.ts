/**
 * GET  /api/missions      — list missions
 * POST /api/missions      — create mission
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMission, listMissions } from "@/lib/data/missions";
import { MissionStatusSchema } from "@/schemas/mission";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const filter = status ? { status: MissionStatusSchema.parse(status) } : undefined;
  const missions = listMissions(workspace, filter);
  return NextResponse.json({ missions, total: missions.length });
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  objective: z.string().min(1),
  agent: z.enum(["claude", "codex", "gemini"]),
  skillSequence: z.array(z.string()).min(1),
  maxContinuations: z.number().int().min(1).max(20).optional(),
  taskIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const workspace = process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  try {
    const body = CreateSchema.parse(await req.json());
    const mission = await createMission(workspace, body);
    return NextResponse.json({ mission }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
