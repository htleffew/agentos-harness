"use client";

import { useEffect, useState } from "react";
import type { Run } from "@/schemas/run";

interface RunsData {
  active: Run[];
  recent: Run[];
}

const AGENT_COLOURS: Record<string, string> = {
  claude: "var(--color-accent)",
  codex: "var(--color-info)",
  gemini: "var(--color-success)",
};

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function RecentRuns() {
  const [data, setData] = useState<RunsData>({ active: [], recent: [] });

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/runs");
        if (res.ok) setData(await res.json());
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const all = [...data.active, ...data.recent].slice(0, 8);

  if (all.length === 0) return null;

  return (
    <div className="p-3 border-t" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-xs font-semibold mb-2 tracking-widest" style={{ color: "var(--color-text-muted)" }}>
        RECENT RUNS
      </p>
      <div className="space-y-1.5">
        {all.map((run) => {
          const isActive = data.active.some((r) => r.id === run.id);
          const colour = AGENT_COLOURS[run.agent] ?? "var(--color-text-muted)";
          return (
            <div key={run.id} className="flex items-center gap-2">
              {isActive
                ? <span className="dot-pulse flex-shrink-0" style={{ width: 6, height: 6 }} />
                : <span className="harness-pulse-dot flex-shrink-0" style={{ width: 6, height: 6, background: run.status === "DONE" ? "var(--color-success)" : run.status === "FAILED" ? "var(--color-danger)" : "var(--color-text-muted)" }} />
              }
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: "0.7rem", color: colour }}>
                  {run.skillName}
                </p>
              </div>
              <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)", flexShrink: 0 }}>
                {relativeTime(run.startedAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
