import { describe, expect, it } from "vitest";
import { isNavItemActive, isResearchActive } from "./navConfig";

describe("navConfig", () => {
  it("detects research routes", () => {
    expect(isResearchActive("/runs")).toBe(true);
    expect(isResearchActive("/runs/new")).toBe(true);
    expect(isResearchActive("/runs/performance")).toBe(true);
    expect(isResearchActive("/runs/compare")).toBe(true);
    expect(isResearchActive("/runs/abc123")).toBe(true);
    expect(isResearchActive("/runs/abc123/live")).toBe(true);
    expect(isResearchActive("/portfolio")).toBe(false);
    expect(isResearchActive("/market")).toBe(false);
  });

  it("marks history active for run detail pages", () => {
    expect(isNavItemActive("/runs", "/runs")).toBe(true);
    expect(isNavItemActive("/runs/abc", "/runs")).toBe(true);
    expect(isNavItemActive("/runs/new", "/runs")).toBe(false);
    expect(isNavItemActive("/runs/compare", "/runs")).toBe(false);
  });

  it("marks compare only on compare routes", () => {
    expect(isNavItemActive("/runs/compare", "/runs/compare")).toBe(true);
    expect(isNavItemActive("/runs/abc", "/runs/compare")).toBe(false);
  });
});
