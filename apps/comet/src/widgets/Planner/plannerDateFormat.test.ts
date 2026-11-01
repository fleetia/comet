import { describe, expect, it } from "vitest";
import { formatPlannerDate } from "./plannerData";

describe("formatPlannerDate", () => {
  it("formats calendar dates in Korean without shifting the day", () => {
    expect(formatPlannerDate("2026-01-01")).toBe("2026년 1월 1일");
    expect(formatPlannerDate("2026-12-31")).toBe("2026년 12월 31일");
  });

  it("formats month and year precision consistently", () => {
    expect(formatPlannerDate("2026-11-01", "month")).toBe("2026년 11월");
    expect(formatPlannerDate("2026-11-01", "year")).toBe("2026년");
  });
});
