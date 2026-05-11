import { describe, it, expect } from "vitest";
import { parseBrainDump } from "@/lib/parse/brain-dump-parser";

describe("parseBrainDump", () => {
  it("parses a bare bullet list", () => {
    const tasks = parseBrainDump("- Task one\n- Task two\n- Task three");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe("Task one");
    expect(tasks[2].title).toBe("Task three");
  });

  it("parses markdown unchecked checkbox", () => {
    const tasks = parseBrainDump("- [ ] My task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("My task");
  });

  it("skips already-done checkboxes", () => {
    const tasks = parseBrainDump("- [x] Done already\n- [ ] Not done");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Not done");
  });

  it("extracts #P1–#P4 priority", () => {
    const tasks = parseBrainDump("- Fix critical bug #P1\n- Write docs #P4");
    expect(tasks[0].priority).toBe(1);
    expect(tasks[1].priority).toBe(4);
  });

  it("extracts @agent mentions", () => {
    const tasks = parseBrainDump("- Deploy to prod @claude\n- Run tests @codex");
    expect(tasks[0].agent).toBe("claude");
    expect(tasks[1].agent).toBe("codex");
  });

  it("extracts #hashtags as tags", () => {
    const tasks = parseBrainDump("- Update wiki #productivity #docs");
    expect(tasks[0].tags).toContain("productivity");
    expect(tasks[0].tags).toContain("docs");
  });

  it("handles indented continuation as description", () => {
    const tasks = parseBrainDump("- Main task\n  This is the description");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("This is the description");
  });

  it("handles bare lines as tasks", () => {
    const tasks = parseBrainDump("Do the thing");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Do the thing");
  });

  it("deduplicates identical titles", () => {
    const tasks = parseBrainDump("- Same task\n- Same task\n- Different task");
    expect(tasks).toHaveLength(2);
  });

  it("blank lines flush current task", () => {
    const tasks = parseBrainDump("- Task A\n\n- Task B");
    expect(tasks).toHaveLength(2);
  });

  it("defaults priority to 3 and agent to unassigned", () => {
    const tasks = parseBrainDump("- Plain task");
    expect(tasks[0].priority).toBe(3);
    expect(tasks[0].agent).toBe("unassigned");
  });

  it("handles mixed bullet types", () => {
    const tasks = parseBrainDump("* bullet\n• bullet2\n→ arrow\n> quote");
    expect(tasks).toHaveLength(4);
  });
});
