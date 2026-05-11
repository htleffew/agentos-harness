/**
 * stream-parser.ts — Parse `claude --output-format stream-json` events.
 *
 * Handles the stream-json protocol emitted by Claude CLI ≥ 1.x.
 * For Codex and Gemini (no structured output), falls back to raw-line mode.
 *
 * Emits DashboardStreamEvent objects to a callback for SSE forwarding.
 */

export type StreamEventType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "cost"
  | "error"
  | "done"
  | "raw";

export interface DashboardStreamEvent {
  type: StreamEventType;
  text?: string;
  toolName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
  raw?: string;
}

type EventCallback = (evt: DashboardStreamEvent) => void;

// ── Claude stream-json parser ─────────────────────────────────────────────────

interface ClaudeStreamEvent {
  type: string;
  index?: number;
  delta?: { type: string; text?: string };
  content_block?: { type: string; name?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  result?: string;
}

function parseClaude(line: string, onEvent: EventCallback): void {
  let obj: ClaudeStreamEvent;
  try {
    obj = JSON.parse(line);
  } catch {
    // Not JSON — treat as raw text
    if (line.trim()) onEvent({ type: "raw", raw: line });
    return;
  }

  switch (obj.type) {
    case "content_block_delta": {
      const text = obj.delta?.text;
      if (text) onEvent({ type: "text", text });
      break;
    }
    case "content_block_start": {
      const name = obj.content_block?.name;
      if (name) onEvent({ type: "tool_use", toolName: name, text: `[tool: ${name}]` });
      break;
    }
    case "message_delta": {
      const usage = obj.usage;
      if (usage) {
        onEvent({
          type: "cost",
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        });
      }
      break;
    }
    case "message_stop":
      onEvent({ type: "done" });
      break;
    case "error":
      onEvent({ type: "error", error: line });
      break;
    default:
      // Silently ignore other event types (ping, etc.)
      break;
  }
}

// ── Raw-line parser (Codex / Gemini) ─────────────────────────────────────────

function parseRaw(line: string, onEvent: EventCallback): void {
  if (!line.trim()) return;
  onEvent({ type: "raw", text: line, raw: line });
}

// ── Cost estimation for non-Claude agents ─────────────────────────────────────

export function estimateCost(
  agent: "codex" | "gemini",
  elapsedMs: number,
  rates: { codexBurnRatePerMin: number; geminiBurnRatePerMin: number }
): number {
  const mins = elapsedMs / 60_000;
  const rate = agent === "codex" ? rates.codexBurnRatePerMin : rates.geminiBurnRatePerMin;
  return parseFloat((mins * rate).toFixed(4));
}

// ── Public: create a line-by-line parser ─────────────────────────────────────

export type AgentMode = "claude" | "codex" | "gemini";

export function createStreamParser(
  agent: AgentMode,
  onEvent: EventCallback
): (line: string) => void {
  return (line: string) => {
    if (agent === "claude") {
      parseClaude(line, onEvent);
    } else {
      parseRaw(line, onEvent);
    }
  };
}

// ── SSE format helpers ────────────────────────────────────────────────────────

export function toSseLine(evt: DashboardStreamEvent): string {
  return `data: ${JSON.stringify(evt)}\n\n`;
}
