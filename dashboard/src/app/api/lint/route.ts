/**
 * GET /api/lint — run `harness lint <workspace>` and return structured results.
 *
 * Spawns the harness CLI as a subprocess, captures stdout, and parses the
 * lint report into structured JSON. Falls back to a static "unknown" result
 * if harness is not installed or the workspace has no lint surfaces yet.
 */

import { NextResponse } from "next/server";
import { spawnSync } from "child_process";

export const dynamic = "force-dynamic";

interface LintCheck {
  check: string;
  status: "pass" | "fail" | "warn" | "unknown";
  message: string;
  details: string[];
}

interface LintResult {
  checks: LintCheck[];
  errors: number;
  warnings: number;
  runAt: string;
  durationMs: number;
  raw: string;
}

// Parse harness lint text output into structured checks
function parseLintOutput(output: string): Omit<LintResult, "runAt" | "durationMs" | "raw"> {
  const checks: LintCheck[] = [];
  let errors = 0;
  let warnings = 0;

  const lines = output.split(/\r?\n/);
  let currentCheck: LintCheck | null = null;

  for (const line of lines) {
    // "✓ Check Name: message"
    const passMatch = /^✓\s+(.+?):\s*(.*)$/.exec(line);
    if (passMatch) {
      if (currentCheck) checks.push(currentCheck);
      currentCheck = { check: passMatch[1], status: "pass", message: passMatch[2], details: [] };
      continue;
    }

    // "✗ Check Name: message"
    const failMatch = /^✗\s+(.+?):\s*(.*)$/.exec(line);
    if (failMatch) {
      if (currentCheck) checks.push(currentCheck);
      currentCheck = { check: failMatch[1], status: "fail", message: failMatch[2], details: [] };
      errors++;
      continue;
    }

    // "⚠ Check Name: message"
    const warnMatch = /^⚠\s+(.+?):\s*(.*)$/.exec(line);
    if (warnMatch) {
      if (currentCheck) checks.push(currentCheck);
      currentCheck = { check: warnMatch[1], status: "warn", message: warnMatch[2], details: [] };
      warnings++;
      continue;
    }

    // "  detail: ..." — indented detail line
    const detailMatch = /^\s{2,}(.+)$/.exec(line);
    if (detailMatch && currentCheck) {
      currentCheck.details.push(detailMatch[1].trim());
      continue;
    }
  }

  if (currentCheck) checks.push(currentCheck);

  return { checks, errors, warnings };
}

export async function GET(): Promise<NextResponse> {
  const workspace =
    process.env.CLAUDE_PROJECT_DIR || process.env.AGENTOS_WORKSPACE || process.cwd();

  const t0 = Date.now();

  // Run harness lint
  const result = spawnSync("harness", ["lint", workspace], {
    encoding: "utf-8",
    timeout: 15_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  const durationMs = Date.now() - t0;
  const raw = result.stdout ?? result.stderr ?? "";

  if (result.error || result.status === null) {
    // harness not installed or timed out — return static fallback
    return NextResponse.json({
      checks: [
        { check: "Harness", status: "unknown", message: "harness CLI not available", details: [] },
      ],
      errors: 0,
      warnings: 1,
      runAt: new Date().toISOString(),
      durationMs,
      raw: result.error?.message ?? "harness not found",
    } satisfies LintResult);
  }

  const parsed = parseLintOutput(raw);

  return NextResponse.json({
    ...parsed,
    runAt: new Date().toISOString(),
    durationMs,
    raw,
  } satisfies LintResult);
}
