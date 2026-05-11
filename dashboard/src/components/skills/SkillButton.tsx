"use client";

import { useState, useCallback } from "react";

type BtnState = "idle" | "running" | "done" | "failed";

interface SkillButtonProps {
  skillName: string;        // directory name e.g. "planning-work"
  displayLabel: string;     // "Planning Work"
  description: string;
  invocableOnly?: boolean;
  onRun: (runId: string) => void;  // called with the run ID on dispatch
}

export function SkillButton({
  skillName,
  displayLabel,
  description,
  invocableOnly = false,
  onRun,
}: SkillButtonProps) {
  const [state, setState] = useState<BtnState>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (state === "running") return;
    setState("running");
    setError(null);

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "claude" }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const { runId } = await res.json();
      setState("done");
      onRun(runId);

      // Reset to idle after 3 s
      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unknown error");
      setTimeout(() => { setState("idle"); setError(null); }, 5000);
    }
  }, [state, skillName, onRun]);

  return (
    <button
      className="skill-btn group"
      data-state={state}
      disabled={state === "running"}
      onClick={handleClick}
      title={description || displayLabel}
      id={`skill-btn-${skillName}`}
    >
      {/* State indicator */}
      <span style={{ flexShrink: 0, width: 8, height: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {state === "running" && <span className="dot-pulse" style={{ width: 6, height: 6 }} />}
        {state === "done"    && <span style={{ color: "var(--color-success)", fontSize: 10 }}>✓</span>}
        {state === "failed"  && <span style={{ color: "var(--color-danger)", fontSize: 10 }}>✗</span>}
        {state === "idle"    && <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>▷</span>}
      </span>

      <span className="flex-1 truncate">{displayLabel}</span>

      {invocableOnly && (
        <span
          className="text-xs px-1.5 py-0.5 rounded border flex-shrink-0"
          style={{
            fontSize: "0.6rem",
            color: "var(--color-text-muted)",
            borderColor: "var(--color-border)",
          }}
        >
          /slash
        </span>
      )}

      {/* Error tooltip */}
      {error && (
        <span
          className="absolute bottom-full left-0 mb-1 text-xs rounded px-2 py-1 z-50 max-w-xs"
          style={{
            background: "var(--color-bg-overlay)",
            color: "var(--color-danger)",
            border: "1px solid var(--color-danger)",
          }}
        >
          {error}
        </span>
      )}
    </button>
  );
}
