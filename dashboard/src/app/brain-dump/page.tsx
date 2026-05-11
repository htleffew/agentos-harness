"use client";

import { useCallback, useState } from "react";
import { parseBrainDump, type ParsedTask } from "@/lib/parse/brain-dump-parser";

interface TriagedTask {
  title: string;
  description: string;
  priority: string;
  agent: string;
  tags: string[];
  eisenhower: string;
}

const PLACEHOLDER = `Paste anything. Brain dump it all out.

Examples:
- Write spec for dashboard Phase 4 #P2 @claude
- Fix the CORS issue in /api/runs #P1
  This is blocking the SSE stream from working
- [ ] Review wiki entries for stale content #productivity
- Update portfolio with NLA case study @claude #P3

Lines starting with - * • → or [ ] become tasks.
Indented lines become the task description.
#P1–#P4 sets priority. @claude/@codex/@gemini assigns agent.
#tags are collected automatically.`;

const PRIORITY_LABELS: Record<number, string> = {
  1: "🔴 P1",
  2: "🔵 P2",
  3: "🟡 P3",
  4: "⚪ P4",
};

const AGENT_COLOURS: Record<string, string> = {
  claude: "var(--color-accent)",
  codex: "var(--color-info)",
  gemini: "var(--color-success)",
  unassigned: "var(--color-text-muted)",
};

export default function BrainDumpPage() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedTask[]>([]);
  const [aiResults, setAiResults] = useState<TriagedTask[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [aiTriaging, setAiTriaging] = useState(false);
  const [imported, setImported] = useState(0);
  const [mode, setMode] = useState<"heuristic" | "ai">("heuristic");

  const handleParse = useCallback(() => {
    const tasks = parseBrainDump(text);
    setParsed(tasks);
    setAiResults([]);
    setMode("heuristic");
    setSelected(new Set(tasks.map((_, i) => i)));
  }, [text]);

  const handleAiTriage = useCallback(async () => {
    if (!text.trim()) return;
    setAiTriaging(true);
    try {
      const res = await fetch("/api/brain-dump/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        const tasks: TriagedTask[] = data.tasks ?? [];
        setAiResults(tasks);
        setParsed([]);
        setMode("ai");
        setSelected(new Set(tasks.map((_, i) => i)));
      }
    } finally {
      setAiTriaging(false);
    }
  }, [text]);

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); } else { next.add(i); }
      return next;
    });
  };

  const handleImport = async () => {
    const allItems = mode === "ai" ? aiResults : parsed;
    const toImport = allItems.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;

    setLoading(true);
    let count = 0;
    for (const task of toImport) {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: (task as TriagedTask).description ?? (task as ParsedTask).description,
          priority: typeof task.priority === "number" ? task.priority : parseInt(String(task.priority).replace("P","")) || 3,
          agent: task.agent,
          tags: task.tags,
          status: "BACKLOG",
        }),
      });
      if (res.ok) count++;
    }
    setLoading(false);
    setImported(count);
    setParsed([]); setAiResults([]); setSelected(new Set()); setText("");
    setTimeout(() => setImported(0), 3000);
  };


  return (
    <div className="shell-main flex flex-col">
      {/* Page header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b glass"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>
            Brain Dump
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Dump everything, let the parser sort it
          </p>
        </div>
        {imported > 0 && (
          <div
            className="text-sm px-4 py-2 rounded animate-fade-in"
            style={{
              background: "color-mix(in srgb, var(--color-success) 15%, var(--color-bg-elevated))",
              border: "1px solid var(--color-success)",
              color: "var(--color-success)",
            }}
          >
            ✓ {imported} task{imported !== 1 ? "s" : ""} imported to Backlog
          </div>
        )}
      </div>

      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" }}>
        {/* Left: text input */}
        <div className="flex flex-col border-r p-6 overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between mb-3">
            <label
              htmlFor="brain-dump-input"
              className="text-xs font-semibold tracking-widest"
              style={{ color: "var(--color-text-muted)" }}
            >
              DUMP
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => { setText(""); setParsed([]); setAiResults([]); setSelected(new Set()); }}
                className="text-xs px-2.5 py-1 rounded"
                style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
              >
                Clear
              </button>
              <button
                onClick={handleAiTriage}
                disabled={!text.trim() || aiTriaging}
                className="text-xs px-3 py-1 rounded font-semibold"
                style={{
                  background: text.trim() && !aiTriaging ? "var(--color-info)" : "var(--color-border)",
                  color: text.trim() && !aiTriaging ? "var(--color-text-inverse)" : "var(--color-text-muted)",
                  border: "none",
                  cursor: text.trim() && !aiTriaging ? "pointer" : "not-allowed",
                }}
                id="brain-dump-ai-triage-btn"
              >
                {aiTriaging ? "Triaging…" : "🤖 AI Triage"}
              </button>
              <button
                onClick={handleParse}
                disabled={!text.trim()}
                className="text-xs px-3 py-1 rounded font-semibold"
                style={{
                  background: text.trim() ? "var(--color-accent)" : "var(--color-border)",
                  color: text.trim() ? "var(--color-text-inverse)" : "var(--color-text-muted)",
                  border: "none",
                  cursor: text.trim() ? "pointer" : "not-allowed",
                }}
                id="brain-dump-parse-btn"
              >
                ⚡ Parse
              </button>
            </div>
          </div>

          <textarea
            id="brain-dump-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            className="flex-1 resize-none rounded p-4 text-sm run-output"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
              lineHeight: 1.7,
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />

          {/* Keyboard hint */}
          <p className="text-xs mt-2" style={{ color: "var(--color-text-muted)" }}>
            Tip: use <kbd style={{ padding: "1px 4px", background: "var(--color-bg-overlay)", borderRadius: 3 }}>⚡ Parse</kbd> to preview extracted tasks before importing
          </p>
        </div>

        {/* Right: parsed preview */}
        <div className="flex flex-col p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs font-semibold tracking-widest" style={{ color: "var(--color-text-muted)" }}>
              PARSED TASKS {(mode === "ai" ? aiResults : parsed).length > 0 && `(${selected.size} / ${(mode === "ai" ? aiResults : parsed).length} selected)`}
              {mode === "ai" && <span style={{ color: "var(--color-info)", marginLeft: 6 }}>🤖 AI</span>}
            </label>
            {(mode === "ai" ? aiResults : parsed).length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected(new Set(parsed.map((_, i) => i)))}
                  className="text-xs px-2.5 py-1 rounded"
                  style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                >
                  All
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs px-2.5 py-1 rounded"
                  style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
                >
                  None
                </button>
                <button
                  onClick={handleImport}
                  disabled={selected.size === 0 || loading}
                  className="text-xs px-3 py-1 rounded font-semibold"
                  style={{
                    background: selected.size > 0 ? "var(--color-accent)" : "var(--color-border)",
                    color: selected.size > 0 ? "var(--color-text-inverse)" : "var(--color-text-muted)",
                    border: "none",
                    cursor: selected.size > 0 ? "pointer" : "not-allowed",
                  }}
                  id="brain-dump-import-btn"
                >
                  {loading ? "Importing…" : `→ Import ${selected.size}`}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {(mode === "ai" ? aiResults : parsed).length === 0 && (
              <div
                className="h-full flex flex-col items-center justify-center"
                style={{ color: "var(--color-text-muted)" }}
              >
                <p className="text-3xl mb-3">🧠</p>
                <p className="text-sm">Paste your thoughts and click ⚡ Parse</p>
                <p className="text-xs mt-1 opacity-60">Tasks appear here for review before import</p>
              </div>
            )}

            {(mode === "ai" ? aiResults : parsed).map((task, i) => {
              const isSelected = selected.has(i);
              const priorityNum = mode === "ai" ? parseInt(String((task as TriagedTask).priority).replace("P","")) || 3 : (task as ParsedTask).priority;
              return (
                <button
                  key={i}
                  onClick={() => toggleSelect(i)}
                  className="w-full text-left rounded-md p-3 transition-colors"
                  style={{
                    background: isSelected ? "var(--color-bg-elevated)" : "var(--color-bg-surface)",
                    border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border)"}`,
                    cursor: "pointer",
                  }}
                  id={`brain-dump-task-${i}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      style={{
                        flexShrink: 0,
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        border: `1.5px solid ${isSelected ? "var(--color-accent)" : "var(--color-border)"}`,
                        background: isSelected ? "var(--color-accent)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: 2,
                        fontSize: 9,
                        color: "var(--color-text-inverse)",
                      }}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs mt-0.5 truncate-2" style={{ color: "var(--color-text-secondary)" }}>
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                          {PRIORITY_LABELS[priorityNum]}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: AGENT_COLOURS[task.agent] }}>
                          {task.agent !== "unassigned" ? `@${task.agent}` : ""}
                        </span>
                        {task.tags.map((t) => (
                          <span
                            key={t}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)", fontSize: "0.65rem" }}
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
