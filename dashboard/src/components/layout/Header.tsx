"use client";

import { useEffect, useState } from "react";

interface RunSummary {
  active: Array<{ id: string; skillName: string; agent: string }>;
}

export function Header() {
  const [active, setActive] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [stopResult, setStopResult] = useState<{ killed: number; paused: number } | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/runs");
        if (res.ok) {
          const data: RunSummary = await res.json();
          setActive(data.active?.length ?? 0);
        }
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const handleEmergencyStop = async () => {
    if (!confirm(`Stop all ${active} active session${active !== 1 ? "s" : ""} and pause all running missions?`)) return;
    setStopping(true);
    try {
      const res = await fetch("/api/runs/stop-all", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setStopResult({ killed: data.killed, paused: data.paused });
        setActive(0);
        setTimeout(() => setStopResult(null), 4000);
      }
    } finally {
      setStopping(false);
    }
  };

  return (
    <header
      className="shell-header glass flex items-center justify-between px-4 border-b z-10"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3">
        <span style={{ color: "var(--color-accent)", fontSize: "1rem", fontWeight: 700, letterSpacing: "0.05em" }}>
          ⚡ AGENTIC OS
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded font-mono"
          style={{ background: "var(--color-bg-overlay)", color: "var(--color-text-muted)" }}
        >
          v1.0.0
        </span>
      </div>

      {/* Right: active sessions + emergency stop */}
      <div className="flex items-center gap-3">
        {stopResult && (
          <span
            className="text-xs px-2.5 py-1 rounded animate-fade-in"
            style={{ background: "color-mix(in srgb, var(--color-danger) 15%, var(--color-bg-elevated))", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }}
          >
            ⏹ Stopped {stopResult.killed} run{stopResult.killed !== 1 ? "s" : ""}, paused {stopResult.paused} mission{stopResult.paused !== 1 ? "s" : ""}
          </span>
        )}

        {active > 0 && (
          <div className="flex items-center gap-2">
            <span className="dot-pulse" />
            <span style={{ color: "var(--color-accent)", fontSize: "0.75rem", fontWeight: 600 }}>
              {active} running
            </span>
            <button
              onClick={handleEmergencyStop}
              disabled={stopping}
              title="Emergency stop — kill all active sessions"
              className="text-xs px-2.5 py-1 rounded font-semibold"
              style={{
                background: stopping ? "var(--color-border)" : "color-mix(in srgb, var(--color-danger) 20%, var(--color-bg-elevated))",
                color: stopping ? "var(--color-text-muted)" : "var(--color-danger)",
                border: `1px solid var(--color-danger)`,
                cursor: stopping ? "not-allowed" : "pointer",
              }}
              id="header-emergency-stop-btn"
            >
              {stopping ? "…" : "⏹ Stop All"}
            </button>
          </div>
        )}

        <span className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>
          harness dashboard
        </span>
      </div>
    </header>
  );
}
