import { NextResponse } from "next/server";
import { getActiveRuns, getRecentRuns } from "@/lib/dispatch/run-store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  return NextResponse.json({
    active: getActiveRuns(workspace),
    recent: getRecentRuns(workspace, 20),
  });
}
