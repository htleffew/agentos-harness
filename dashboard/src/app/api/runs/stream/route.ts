/**
 * GET /api/runs/stream?runId=<id> — SSE stream for live run output.
 *
 * Tails the per-run JSONL file written by the skills run route.
 * Closes when the "done" event is received or the client disconnects.
 */

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 150;
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest): Promise<Response> {
  const runId = req.nextUrl.searchParams.get("runId");
  if (!runId) {
    return new Response("Missing runId", { status: 400 });
  }

  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();
  const streamFile = path.join(
    workspace,
    ".harness",
    "state",
    "run-streams",
    `${runId}.jsonl`
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let offset = 0;
      let elapsed = 0;
      let done = false;

      // Wait up to 5s for the file to appear (process may not have started yet)
      let waited = 0;
      while (!fs.existsSync(streamFile) && waited < 5000) {
        await sleep(200);
        waited += 200;
      }

      if (!fs.existsSync(streamFile)) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: "Run stream file not found" })}\n\n`
          )
        );
        controller.close();
        return;
      }

      while (!done && elapsed < MAX_WAIT_MS) {
        if (req.signal.aborted) break;

        const stat = fs.statSync(streamFile);
        if (stat.size > offset) {
          const fd = fs.openSync(streamFile, "r");
          const buf = Buffer.alloc(stat.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = stat.size;

          const text = buf.toString("utf-8");
          for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const evt = JSON.parse(trimmed);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
              if (evt.type === "done") {
                done = true;
                break;
              }
            } catch {
              // Skip malformed lines
            }
          }
        }

        if (!done) {
          await sleep(POLL_INTERVAL_MS);
          elapsed += POLL_INTERVAL_MS;
        }
      }

      if (!done) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", error: "Stream timeout" })}\n\n`
          )
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
