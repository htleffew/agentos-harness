"use client";

import { useEffect, useRef, useState } from "react";

interface DashboardStreamEvent {
  type: string;
  text?: string;
  toolName?: string;
  error?: string;
  exitCode?: number;
  raw?: string;
}

interface RunDrawerProps {
  runId: string;
  skillName: string;
  onClose: () => void;
}

export function RunDrawer({ runId, skillName, onClose }: RunDrawerProps) {
  const [lines, setLines] = useState<{ cls: string; text: string }[]>([]);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<"running" | "done" | "failed">("running");
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/stream?runId=${encodeURIComponent(runId)}`);
    esRef.current = es;

    es.onmessage = (e) => {
      let evt: DashboardStreamEvent;
      try { evt = JSON.parse(e.data); } catch { return; }

      if (evt.type === "text" && evt.text) {
        setLines((prev) => [...prev, { cls: "out-assistant", text: evt.text! }]);
      } else if (evt.type === "tool_use" && evt.text) {
        setLines((prev) => [...prev, { cls: "out-tool", text: evt.text! }]);
      } else if (evt.type === "error" && evt.error) {
        setLines((prev) => [...prev, { cls: "out-error", text: evt.error! }]);
      } else if (evt.type === "raw" && (evt.text || evt.raw)) {
        setLines((prev) => [...prev, { cls: "", text: evt.text ?? evt.raw ?? "" }]);
      } else if (evt.type === "done") {
        setDone(true);
        setStatus(evt.exitCode === 0 ? "done" : "failed");
        es.close();
      }
    };

    es.onerror = () => {
      setLines((prev) => [...prev, { cls: "out-error", text: "[stream disconnected]" }]);
      setDone(true);
      setStatus("failed");
      es.close();
    };

    return () => { es.close(); };
  }, [runId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const statusColour = status === "done" ? "var(--color-success)" : status === "failed" ? "var(--color-danger)" : "var(--color-accent)";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className="animate-slide-in fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: "min(720px, 90vw)",
          background: "var(--color-bg-surface)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
            {!done && <span className="dot-pulse" />}
            {done && (
              <span style={{ color: statusColour, fontSize: 14 }}>
                {status === "done" ? "✓" : "✗"}
              </span>
            )}
            <div>
              <h3 style={{ color: "var(--color-text-primary)", fontSize: "0.875rem", fontWeight: 600 }}>
                {skillName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </h3>
              <p style={{ color: statusColour, fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}>
                {done ? status.toUpperCase() : "RUNNING"} · {runId.slice(0, 8)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm transition-colors"
            style={{
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
            id="run-drawer-close"
          >
            ✕ Close
          </button>
        </div>

        {/* Preflight badge strip */}
        <div
          className="flex items-center gap-2 px-4 py-2 border-b text-xs"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg-elevated)" }}
        >
          <span style={{ color: "var(--color-text-muted)" }}>PREFLIGHT:</span>
          {["wiki/index.md", "AGENTS.md", "CLAUDE.md", "skills.json"].map((s) => (
            <span
              key={s}
              className="px-1.5 py-0.5 rounded font-mono"
              style={{
                background: "var(--color-accent-dim)",
                color: "var(--color-accent)",
                fontSize: "0.65rem",
              }}
            >
              ✓ {s}
            </span>
          ))}
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto p-4 run-output">
          {lines.length === 0 && !done && (
            <p style={{ color: "var(--color-text-muted)" }}>Connecting to agent…</p>
          )}
          {lines.map((line, i) => (
            <div key={i} className={line.cls}>
              {line.text}
            </div>
          ))}
          {done && (
            <div
              className="mt-4 pt-4 border-t out-section"
              style={{ borderColor: "var(--color-border)" }}
            >
              ── Session {status.toUpperCase()} ──
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </aside>
    </>
  );
}
