import { describe, expect, it } from "vitest";
import { memorySummary, type LearningStatus } from "./learning";

describe("learning helpers", () => {
  it("summarises memories", () => {
    const s = { memories: { bull_memory: 2, bear_memory: 0, trader_memory: 1 } } as unknown as LearningStatus;
    expect(memorySummary(s)).toBe("3 lessons across 2 agents.");
    expect(memorySummary({ ...s, memories: { trader_memory: 1 } })).toBe("1 lesson across 1 agent.");
    expect(memorySummary({ ...s, memories: {} })).toBe("No lessons stored yet.");
  });
});
