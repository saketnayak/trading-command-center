import { describe, expect, it } from "vitest";
import { resolveSchedulePreset } from "./watchlistSchedulePresets";

describe("watchlistSchedulePresets", () => {
  it("detects manual and preset schedules", () => {
    expect(resolveSchedulePreset(null)).toBe("manual");
    expect(resolveSchedulePreset("0 9 * * 1-5")).toBe("weekdays");
    expect(resolveSchedulePreset("0 9 * * *")).toBe("daily");
    expect(resolveSchedulePreset("0 9 * * 1")).toBe("weekly");
    expect(resolveSchedulePreset("30 14 * * 3")).toBe("custom");
  });
});
