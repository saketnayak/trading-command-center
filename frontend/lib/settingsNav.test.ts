import { describe, expect, it } from "vitest";
import { visibleSettingsSections } from "./settingsNav";

describe("settingsNav", () => {
  it("shows core sections for all users", () => {
    const sections = visibleSettingsSections(false);
    expect(sections.map((s) => s.id)).toEqual(["profile", "investor-dna", "strategy"]);
  });

  it("includes admin sections for admins", () => {
    const sections = visibleSettingsSections(true);
    expect(sections.some((s) => s.id === "llm-providers")).toBe(true);
    expect(sections.some((s) => s.id === "database")).toBe(true);
  });
});
