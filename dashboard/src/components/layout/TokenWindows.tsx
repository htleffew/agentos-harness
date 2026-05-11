"use client";

import { useEffect, useState } from "react";

interface TelemetryData {
  tokenInputs: number;
  tokenOutputs: number;
  totalCost: number;
  burnRatePerHour: number;
  contextPct: number;
  sparkline: number[];
}

const EMPTY: TelemetryData = {
  tokenInputs: 0,
  tokenOutputs: 0,
  totalCost: 0,
  burnRatePerHour: 0,
  contextPct: 0,
  sparkline: Array(24).fill(0),
};

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenWindows() {
  const [data, setData] = useState<TelemetryData>(EMPTY);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/telemetry");
        if (res.ok) setData(await res.json());
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, []);

  const pct = data.contextPct;
  const barColour =
    pct > 80 ? "var(--color-danger)" : pct > 50 ? "var(--color-warning)" : "var(--color-accent)";

  return (
    <div className="shell-token-bar flex items-center gap-4 px-4 py-2 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-surface)" }}>
      {/* Context window bar */}
      <div className="flex items-center gap-2 flex-1">
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.65rem", whiteSpace: "nowrap" }}>
          CTX
        </span>
        <div className="token-bar-track flex-1" style={{ maxWidth: 120 }}>
          <div
            className="token-bar-fill"
            style={{ width: `${pct}%`, background: barColour }}
          />
        </div>
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.65rem", fontFamily: "var(--font-mono)" }}>
          {pct}%
        </span>
      </div>

      {/* Token counts */}
      <div className="flex items-center gap-1" style={{ color: "var(--color-text-muted)", fontSize: "0.65rem" }}>
        <span style={{ color: "var(--color-info)" }}>↑{fmt(data.tokenInputs)}</span>
        <span>/</span>
        <span style={{ color: "var(--color-accent)" }}>↓{fmt(data.tokenOutputs)}</span>
      </div>

      {/* Cost */}
      <div style={{ color: "var(--color-text-muted)", fontSize: "0.65rem", fontFamily: "var(--font-mono)" }}>
        ${data.totalCost.toFixed(3)} today
      </div>

      {/* Sparkline */}
      <ActivitySparkline data={data.sparkline} />
    </div>
  );
}

function ActivitySparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const W = 60;
  const H = 20;
  const barW = W / data.length - 0.5;

  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      {data.map((val, i) => {
        const barH = Math.max(1, (val / max) * (H - 2));
        return (
          <rect
            key={i}
            x={i * (barW + 0.5)}
            y={H - barH}
            width={barW}
            height={barH}
            fill="var(--color-accent)"
            opacity={0.5 + 0.5 * (val / max)}
          />
        );
      })}
    </svg>
  );
}
