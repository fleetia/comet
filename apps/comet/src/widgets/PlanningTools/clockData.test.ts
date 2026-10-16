import { describe, expect, it } from "vitest";
import { anniversaryLabel, anniversaryTarget, clockFeatured } from "./clockData";

describe("anniversary presentation", () => {
  it("counts calendar days across daylight savings and advances yearly dates", () => {
    const today = new Date(2026, 9, 16, 12).getTime();
    expect(anniversaryLabel({ date: "2026-10-15", countMode: "elapsed" }, today)).toBe("D+1");
    expect(anniversaryTarget({ date: "2020-10-15", repeat: "yearly" }, today).getFullYear()).toBe(2027);
    expect(anniversaryLabel({ date: "2024-02-29", repeat: "yearly" }, new Date(2025, 1, 28, 12).getTime())).toBe("D-day");
  });
  it("keeps one selected anniversary and respects explicitly hidden state", () => {
    const anniversaries = [{ id: "first" }, { id: "chosen" }];
    expect(clockFeatured({ anniversaries, featuredId: "chosen" })?.id).toBe("chosen");
    expect(clockFeatured({ anniversaries, featuredEnabled: false })).toBeUndefined();
    expect(clockFeatured({ anniversaries })?.id).toBe("first");
  });
});
