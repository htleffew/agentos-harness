"use client";

import { useEffect, useState, useCallback } from "react";
import { DomainCard } from "@/components/skills/DomainCard";
import { RunDrawer } from "@/components/skills/RunDrawer";

interface SkillEntry {
  skillName: string;
  displayLabel: string;
  description: string;
  domain: string;
  domainDisplay: string;
  invocableOnly: boolean;
  sortScore: number;
}

interface SkillsResponse {
  byDomain: Record<string, SkillEntry[]>;
  total: number;
  workspace: string;
}

interface ActiveRun {
  runId: string;
  skillName: string;
}

export default function SkillsPage() {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/skills");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load skills");
      } finally {
        setLoading(false);
      }
    })();
    const id = setInterval(loadSkills, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleRun = useCallback((runId: string, skillName: string) => {
    setActiveRun({ runId, skillName });
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setActiveRun(null);
    // Reload skills to update sort scores after run
    loadSkills();
  }, [loadSkills]);

  return (
    <>
      <div className="shell-main">
        {/* Page header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b glass"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h1 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>
              Skills
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {data ? `${data.total} skills discovered · ${data.workspace}` : "Loading…"}
            </p>
          </div>
          <button
            onClick={loadSkills}
            className="px-3 py-1.5 rounded text-xs transition-colors"
            style={{
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            }}
            id="skills-refresh-btn"
          >
            ↺ Refresh
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-8">
          {loading && (
            <div className="flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
              <span className="animate-spin" style={{ display: "inline-block" }}>◌</span>
              <span>Discovering skills…</span>
            </div>
          )}

          {error && (
            <div
              className="rounded-md p-4 border"
              style={{
                background: "color-mix(in srgb, var(--color-danger) 8%, var(--color-bg-elevated))",
                borderColor: "var(--color-danger)",
                color: "var(--color-danger)",
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && !error && data && Object.keys(data.byDomain).length === 0 && (
            <div
              className="text-center py-16 surface rounded-lg"
              style={{ color: "var(--color-text-muted)" }}
            >
              <p className="text-4xl mb-4">⚡</p>
              <p className="text-sm">No skills found in <code>.claude/skills/</code></p>
              <p className="text-xs mt-2">Run <code>harness setup . --apply</code> to generate skills.</p>
            </div>
          )}

          {data &&
            Object.entries(data.byDomain).map(([domain, skills]) => (
              <DomainCard
                key={domain}
                domain={domain}
                domainDisplay={skills[0]?.domainDisplay ?? domain}
                skills={skills}
                onRun={handleRun}
              />
            ))}
        </div>
      </div>

      {/* Run drawer (portal-like, rendered outside shell-main) */}
      {activeRun && (
        <RunDrawer
          runId={activeRun.runId}
          skillName={activeRun.skillName}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
}
