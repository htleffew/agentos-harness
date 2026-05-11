"use client";

import { useCallback, useState } from "react";


interface SetupStep {
  id: number;
  title: string;
  description: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
}

const STEPS: Omit<SetupStep, "status" | "output">[] = [
  { id: 1, title: "Detect workspace",        description: "Read CLAUDE_PROJECT_DIR and locate harness artifacts" },
  { id: 2, title: "Verify AGENTS.md",        description: "Confirm multi-model routing tier is configured" },
  { id: 3, title: "Skill discovery",          description: "Walk .claude/skills/ and count discovered skills" },
  { id: 4, title: "Wiki index check",         description: "Verify .claude/wiki/index.md exists" },
  { id: 5, title: "Dashboard config",         description: "Read or create .harness/config/dashboard.json" },
  { id: 6, title: "State directory",          description: "Ensure .harness/state/ is writable" },
  { id: 7, title: "Harness lint",             description: "Run harness lint and surface any issues" },
];

interface WizardResult {
  steps: { id: number; status: string; output: string }[];
  workspace: string;
  port: number;
  skills: number;
  errors: number;
}

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const [steps, setSteps] = useState<SetupStep[]>(STEPS.map((s) => ({ ...s, status: "pending" })));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<WizardResult | null>(null);

  const runWizard = useCallback(async () => {
    setRunning(true);
    setDone(false);
    setResult(null);
    setSteps(STEPS.map((s) => ({ ...s, status: "pending" })));

    try {
      const res = await fetch("/api/wizard/run", { method: "POST" });
      if (!res.ok) throw new Error("Wizard API failed");
      const data: WizardResult = await res.json();

      // Animate through steps
      for (const stepResult of data.steps) {
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepResult.id
              ? { ...s, status: stepResult.status as SetupStep["status"], output: stepResult.output }
              : s
          )
        );
        await new Promise((r) => setTimeout(r, 200));
      }

      setResult(data);
    } catch {
      setSteps((prev) => prev.map((s) => (s.status === "pending" || s.status === "running" ? { ...s, status: "error" } : s)));
    } finally {
      setRunning(false);
      setDone(true);
    }
  }, []);

  const allPassed = steps.every((s) => s.status === "done");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
      <div
        className="flex flex-col"
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          width: "min(680px, 95vw)",
          maxHeight: "85vh",
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--color-text-primary)" }}>
              ⚡ Setup Wizard
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              Validate workspace, skill discovery, and harness integration
            </p>
          </div>
          <button onClick={onClose} style={{ color: "var(--color-text-muted)", background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {steps.map((step) => (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-md px-4 py-3"
              style={{
                background: step.status === "done" ? "color-mix(in srgb, var(--color-success) 8%, var(--color-bg-surface))"
                  : step.status === "error" ? "color-mix(in srgb, var(--color-danger) 8%, var(--color-bg-surface))"
                  : step.status === "running" ? "color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-surface))"
                  : "var(--color-bg-surface)",
                border: `1px solid ${
                  step.status === "done" ? "var(--color-success)" :
                  step.status === "error" ? "var(--color-danger)" :
                  step.status === "running" ? "var(--color-accent)" :
                  "var(--color-border)"
                }`,
                transition: "background 200ms ease, border-color 200ms ease",
              }}
            >
              {/* Status icon */}
              <span
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold"
                style={{
                  background: step.status === "done" ? "var(--color-success)" :
                    step.status === "error" ? "var(--color-danger)" :
                    step.status === "running" ? "var(--color-accent)" :
                    "var(--color-bg-overlay)",
                  color: step.status === "pending" ? "var(--color-text-muted)" : "var(--color-text-inverse)",
                }}
              >
                {step.status === "done" ? "✓" :
                  step.status === "error" ? "✗" :
                  step.status === "running" ? "…" :
                  step.id}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{step.title}</p>
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{step.description}</p>
                {step.output && (
                  <p className="text-xs mt-1 font-mono" style={{ color: step.status === "error" ? "var(--color-danger)" : "var(--color-success)" }}>
                    {step.output}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Result summary */}
        {result && (
          <div
            className="px-6 py-4 border-t"
            style={{
              borderColor: "var(--color-border)",
              background: allPassed ? "color-mix(in srgb, var(--color-success) 5%, var(--color-bg-elevated))" : "var(--color-bg-elevated)",
            }}
          >
            {allPassed ? (
              <p className="text-sm" style={{ color: "var(--color-success)" }}>
                ✓ All {steps.length} checks passed — workspace is healthy. {result.skills} skills discovered on port {result.port}.
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--color-danger)" }}>
                ✗ {result.errors} check{result.errors !== 1 ? "s" : ""} failed. Review the items above and fix before proceeding.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: "var(--color-border)" }}>
          <button onClick={onClose} className="px-4 py-2 rounded text-sm"
            style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>
            Close
          </button>
          <button
            onClick={runWizard}
            disabled={running}
            className="px-4 py-2 rounded text-sm font-semibold"
            style={{
              background: running ? "var(--color-border)" : "var(--color-accent)",
              color: running ? "var(--color-text-muted)" : "var(--color-text-inverse)",
              border: "none", cursor: running ? "not-allowed" : "pointer",
            }}
            id="setup-wizard-run-btn"
          >
            {running ? "Running…" : done ? "↺ Re-run" : "⚡ Run Setup Check"}
          </button>
        </div>
      </div>
    </div>
  );
}
