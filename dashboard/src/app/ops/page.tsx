"use client";

import { useCallback, useEffect, useState } from "react";
import { SetupWizard } from "@/components/ops/SetupWizard";

interface LintCheck {
  check: string;
  status: "pass" | "fail" | "warn" | "unknown";
  message: string;
  details: string[];
}

interface LintData {
  checks: LintCheck[];
  errors: number;
  warnings: number;
  runAt: string;
  durationMs: number;
  raw: string;
}

const STATUS_ICON: Record<string, string> = { pass: "✓", fail: "✗", warn: "⚠", unknown: "?" };
const STATUS_COLOUR: Record<string, string> = {
  pass: "var(--color-success)",
  fail: "var(--color-danger)",
  warn: "var(--color-warning)",
  unknown: "var(--color-text-muted)",
};

export default function OpsPage() {
  const [lint, setLint] = useState<LintData | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [telemetry, setTelemetry] = useState<Record<string, unknown> | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const runLint = useCallback(async () => {
    setLintLoading(true);
    try {
      const res = await fetch("/api/lint");
      if (res.ok) setLint(await res.json());
    } finally {
      setLintLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLintLoading(true);
      try {
        const res = await fetch("/api/lint");
        if (res.ok) setLint(await res.json());
      } finally {
        setLintLoading(false);
      }
    })();
    void fetch("/api/telemetry").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setTelemetry(d); });
  }, []);


  return (
    <>
    <div className="shell-main flex flex-col">
      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b glass"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>OPS</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            Harness lint · token telemetry · workspace config
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWizard(true)}
            className="px-3 py-2 rounded text-sm"
            style={{ background: "var(--color-bg-elevated)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)", cursor: "pointer" }}
            id="ops-wizard-btn"
          >
            ⚙ Setup Check
          </button>
          <button
            onClick={runLint}
            disabled={lintLoading}
            className="px-4 py-2 rounded text-sm font-semibold"
            style={{
              background: lintLoading ? "var(--color-border)" : "var(--color-accent)",
              color: lintLoading ? "var(--color-text-muted)" : "var(--color-text-inverse)",
              border: "none", cursor: lintLoading ? "not-allowed" : "pointer",
            }}
            id="ops-run-lint-btn"
          >
            {lintLoading ? "Running lint…" : "⚡ Run Lint"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Lint results */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold tracking-widest" style={{ color: "var(--color-text-muted)" }}>
              LINT CHECKS
            </h2>
            {lint && (
              <div className="flex items-center gap-3" style={{ fontSize: "0.7rem" }}>
                {lint.errors > 0 && <span style={{ color: "var(--color-danger)" }}>✗ {lint.errors} error{lint.errors !== 1 ? "s" : ""}</span>}
                {lint.warnings > 0 && <span style={{ color: "var(--color-warning)" }}>⚠ {lint.warnings} warning{lint.warnings !== 1 ? "s" : ""}</span>}
                {lint.errors === 0 && lint.warnings === 0 && <span style={{ color: "var(--color-success)" }}>✓ clean</span>}
                <span style={{ color: "var(--color-text-muted)" }}>{lint.durationMs}ms</span>
                <button onClick={() => setShowRaw((v) => !v)} className="px-2 py-0.5 rounded"
                  style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                  {showRaw ? "Hide raw" : "Raw output"}
                </button>
              </div>
            )}
          </div>

          {lint ? (
            <div className="space-y-2">
              {lint.checks.map((check, i) => (
                <div key={i} className="surface rounded-md px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-sm flex-shrink-0" style={{ color: STATUS_COLOUR[check.status] }}>
                      {STATUS_ICON[check.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{check.check}</p>
                        <span className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: `color-mix(in srgb, ${STATUS_COLOUR[check.status]} 15%, var(--color-bg-elevated))`, color: STATUS_COLOUR[check.status] }}>
                          {check.status}
                        </span>
                      </div>
                      {check.message && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{check.message}</p>
                      )}
                      {check.details.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5">
                          {check.details.map((d, j) => (
                            <li key={j} className="text-xs" style={{ color: "var(--color-text-muted)", paddingLeft: "0.75rem" }}>
                              · {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {lint.checks.length === 0 && (
                <div className="surface rounded-md px-4 py-8 text-center" style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>
                  No lint checks found. Run <code style={{ fontFamily: "var(--font-mono)" }}>harness lint .</code> manually to see output.
                </div>
              )}

              {showRaw && (
                <pre className="run-output rounded-md p-4 text-xs overflow-x-auto"
                  style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {lint.raw || "(no output)"}
                </pre>
              )}
            </div>
          ) : lintLoading ? (
            <div className="surface rounded-md px-4 py-8 text-center" style={{ color: "var(--color-text-muted)", fontSize: "0.8rem" }}>
              Running harness lint…
            </div>
          ) : null}
        </section>

        {/* Telemetry section */}
        {telemetry && (
          <section>
            <h2 className="text-sm font-bold tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>
              TODAY&apos;S TELEMETRY
            </h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
              {[
                { label: "Token Inputs", value: String(telemetry.tokenInputs ?? 0), colour: "var(--color-info)" },
                { label: "Token Outputs", value: String(telemetry.tokenOutputs ?? 0), colour: "var(--color-accent)" },
                { label: "Total Cost", value: `$${Number(telemetry.totalCost ?? 0).toFixed(4)}`, colour: "var(--color-warning)" },
                { label: "Burn Rate", value: `$${Number(telemetry.burnRatePerHour ?? 0).toFixed(4)}/hr`, colour: "var(--color-text-muted)" },
                { label: "Context Used", value: `${telemetry.contextPct ?? 0}%`, colour: Number(telemetry.contextPct) > 80 ? "var(--color-danger)" : "var(--color-success)" },
              ].map((stat) => (
                <div key={stat.label} className="surface rounded-md px-4 py-3">
                  <p className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>{stat.label}</p>
                  <p className="text-lg font-mono font-bold" style={{ color: stat.colour }}>{stat.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Environment */}
        <section>
          <h2 className="text-sm font-bold tracking-widest mb-3" style={{ color: "var(--color-text-muted)" }}>
            ENVIRONMENT
          </h2>
          <div className="surface rounded-md p-4 space-y-2">
            {telemetry && [
              ["CLAUDE_PROJECT_DIR", (telemetry as Record<string, string>).workspace ?? "(not set)"],
              ["NODE_ENV", "production"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 text-xs">
                <span className="font-mono flex-shrink-0" style={{ color: "var(--color-text-muted)", minWidth: 200 }}>{k}</span>
                <span className="font-mono truncate" style={{ color: "var(--color-accent)" }}>{v}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
    {showWizard && <SetupWizard onClose={() => setShowWizard(false)} />}
    </>
  );
}
