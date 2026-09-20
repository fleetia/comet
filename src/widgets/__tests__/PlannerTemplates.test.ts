import { describe, expect, it } from "vitest";
import { PLANNER_TEMPLATES, templateItems, type PlannerTemplate } from "../Planner/templateCatalog";

function template(id: string): PlannerTemplate {
  const result = PLANNER_TEMPLATES.find((entry) => entry.id === id);
  if (!result) throw new Error(`Unknown template: ${id}`);
  return result;
}

describe("template first dates", () => {
  it("aligns household weekdays and last Sundays while including the selected day", () => {
    const items = templateItems(template("home"), "2026-09-21");
    expect(items.map((item) => item.dueDate)).toEqual([
      "2026-09-23",
      "2026-09-27",
      "2026-09-27",
      "2026-09-21",
      "2026-09-27",
    ]);
    const sameDay = templateItems(template("home"), "2026-09-27");
    expect(sameDay[1].dueDate).toBe("2026-09-27");
    expect(sameDay[4].dueDate).toBe("2026-09-27");
    const nextMonth = templateItems(template("home"), "2026-09-28");
    expect(nextMonth[4].dueDate).toBe("2026-10-25");
    expect(nextMonth[4].planAnchor).toBe("2026-10-19");
  });

  it("uses the actual month end while leaving same-day monthly rules unchanged", () => {
    const items = templateItems(template("monthly"), "2028-02-14");
    expect(items.map((item) => item.dueDate)).toEqual([
      "2028-02-29",
      "2028-02-29",
      "2028-02-14",
      "2028-02-14",
      "2028-02-29",
    ]);
    expect(templateItems(template("monthly"), "2026-12-31")[0].dueDate).toBe("2026-12-31");
  });

  it("skips a month without the fifth selected weekday and rolls past an elapsed match", () => {
    const monthly: PlannerTemplate = {
      id: "fifth",
      title: "다섯 번째 목요일",
      description: "",
      period: "month",
      items: [
        {
          title: "정리",
          repeatRule: {
            mode: "calendar",
            unit: "month",
            interval: 1,
            monthlyMode: "nth-weekday",
            nth: 5,
            weekday: 3,
          },
        },
      ],
    };
    expect(templateItems(monthly, "2026-02-01")[0].dueDate).toBe("2026-04-30");
    expect(templateItems(monthly, "2026-04-30")[0].dueDate).toBe("2026-04-30");
    expect(templateItems(monthly, "2026-05-01")[0].dueDate).toBe("2026-07-30");
  });

  it("preserves frequency, yearly, daily and occasion offsets", () => {
    expect(
      templateItems(template("health"), "2026-09-21")
        .slice(0, 4)
        .map((item) => item.dueDate),
    ).toEqual(Array(4).fill("2026-09-21"));
    expect(templateItems(template("yearly"), "2026-09-21").map((item) => item.dueDate)).toEqual(
      Array(5).fill("2026-09-21"),
    );
    expect(templateItems(template("occasion"), "2027-01-02").map((item) => item.dueDate)).toEqual([
      "2026-12-19",
      "2026-12-26",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});
