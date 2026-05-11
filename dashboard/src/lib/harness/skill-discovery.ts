/**
 * skill-discovery.ts — TypeScript port of Python skill_discovery.py
 *
 * Supports two layouts:
 *   flat:   .claude/skills/<skill>/SKILL.md
 *   nested: .claude/skills/<domain>/<skill>/SKILL.md
 *
 * The harness currently uses flat layout. Both are detected automatically.
 */

import fs from "fs";
import path from "path";

export interface SkillEntry {
  skillDir: string;       // relative to skills root e.g. "planning-work"
  skillName: string;      // from frontmatter "name" field or derived
  description: string;    // from frontmatter "description" field
  domain: string;         // effective domain (after built-in mapping)
  displayLabel: string;   // title-cased
  domainDisplay: string;  // title-cased domain
  invocableOnly: boolean; // true if skillOverrides = "user-invocable-only"
  skillMdPath: string;    // absolute path to SKILL.md
  sortScore: number;
  runCount30d: number;
  lastRunAt: string | null;
}

/** Built-in skill → domain mapping (§4.4) */
const BUILTIN_DOMAIN_MAP: Record<string, string> = {
  "planning-work": "daily",
  "executing-plans": "daily",
  "looping-to-completion": "daily",
  "orienting-session": "daily",
  "workspace-status": "daily",
  "reviewing-work": "daily",
  "auditing-completion": "daily",
  "maintaining-wiki": "productivity",
  "investigating-questions": "research",
  "suggesting-skills": "ops",
  "generating-prompts": "ops",
  "agent-engineering-quality": "ops",
};

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

function loadSkillOverrides(workspace: string): Record<string, string> {
  const settingsPath = path.join(workspace, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return typeof data.skillOverrides === "object" ? data.skillOverrides : {};
  } catch {
    return {};
  }
}

export function discoverSkills(workspace: string): SkillEntry[] {
  const skillsRoot = path.join(workspace, ".claude", "skills");
  if (!fs.existsSync(skillsRoot)) return [];

  const overrides = loadSkillOverrides(workspace);
  const skills: SkillEntry[] = [];

  for (const entry of fs.readdirSync(skillsRoot).sort()) {
    const entryPath = path.join(skillsRoot, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;

    // Check if this is a flat skill (SKILL.md directly inside entry/)
    const flatSkillMd = path.join(entryPath, "SKILL.md");
    if (fs.existsSync(flatSkillMd)) {
      // Flat layout: .claude/skills/<skill>/SKILL.md
      const skillKey = entry;
      const override = overrides[skillKey] ?? "default";
      if (override === "off") continue;
      const invocableOnly = override === "user-invocable-only";

      const text = fs.readFileSync(flatSkillMd, "utf-8");
      const fm = parseFrontmatter(text);
      const name = fm["name"] ?? titleCase(skillKey);
      const description = fm["description"] ?? "";
      const domain = BUILTIN_DOMAIN_MAP[skillKey] ?? "custom";

      skills.push({
        skillDir: entry,
        skillName: name,
        description,
        domain,
        displayLabel: titleCase(name),
        domainDisplay: titleCase(domain),
        invocableOnly,
        skillMdPath: flatSkillMd,
        sortScore: 0,
        runCount30d: 0,
        lastRunAt: null,
      });
    } else {
      // Nested layout: .claude/skills/<domain>/<skill>/SKILL.md
      const domainName = entry;
      for (const skillEntry of fs.readdirSync(entryPath).sort()) {
        const skillPath = path.join(entryPath, skillEntry);
        if (!fs.statSync(skillPath).isDirectory()) continue;
        const skillMd = path.join(skillPath, "SKILL.md");
        if (!fs.existsSync(skillMd)) continue;

        const skillKey = skillEntry;
        const override = overrides[skillKey] ?? "default";
        if (override === "off") continue;
        const invocableOnly = override === "user-invocable-only";

        const text = fs.readFileSync(skillMd, "utf-8");
        const fm = parseFrontmatter(text);
        const name = fm["name"] ?? titleCase(skillKey);
        const description = fm["description"] ?? "";
        const effectiveDomain = BUILTIN_DOMAIN_MAP[skillKey] ?? domainName;

        skills.push({
          skillDir: `${domainName}/${skillEntry}`,
          skillName: name,
          description,
          domain: effectiveDomain,
          displayLabel: titleCase(name),
          domainDisplay: titleCase(effectiveDomain),
          invocableOnly,
          skillMdPath: skillMd,
          sortScore: 0,
          runCount30d: 0,
          lastRunAt: null,
        });
      }
    }
  }

  return skills;
}
