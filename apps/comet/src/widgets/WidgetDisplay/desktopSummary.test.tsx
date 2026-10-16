import { expect, it } from "vitest";
import type { WidgetValue, WidgetView } from "../types";
import { render, screen } from "@testing-library/react";
import { desktopSummary, FreeformWidget } from "./DesktopWidget";

function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    version: 1,
    installed: true,
    enabled: true,
    revision: 1,
    data,
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 0,
  };
}

it("names the focus row by its real state instead of always saying it is running", () => {
  const now = Date.now();
  const title = (data: WidgetValue): string =>
    desktopSummary(widget("focus-timer", data), now).title;
  expect(title({ status: "idle", durationMinutes: 25 })).toBe("집중 준비");
  expect(title({ status: "paused" })).toBe("일시 정지");
  expect(title({ status: "running" })).toBe("집중 중");
  expect(title({ status: "running", mode: "rest" })).toBe("쉬는 중");
  expect(title({ status: "paused", mode: "rest" })).toBe("일시 정지");
  expect(title({ status: "finished", mode: "focus" })).toBe("집중 끝");
  expect(title({ status: "finished", mode: "rest" })).toBe("휴식 끝");
  expect(title({ status: "idle", mode: "rest" })).toBe("집중 준비");
  expect(desktopSummary(widget("focus-timer", { status: "idle" }), now).meta).toBe("");
});

it("keeps a completed break finished after its deadline has been cleared", () => {
  const timer = widget("focus-timer", {
    status: "finished",
    mode: "rest",
    title: "원고 쓰기",
    remainingMs: 0,
    deadline: null,
  });
  const now = Date.now();
  for (const time of [now, now + 60000]) {
    expect(desktopSummary(timer, time)).toMatchObject({
      title: "휴식 끝",
      description: "원고 쓰기",
      value: "00:00",
    });
  }
});

it("does not repeat the empty calendar message or show a placeholder dash for unfetched weather", () => {
  const now = Date.now();
  const calendar = desktopSummary(widget("calendar", { events: [] }), now);
  expect(calendar.description).toBe("예정된 일정이 없어요");
  expect(calendar.value).toBe("");
  const weather = desktopSummary(widget("weather", {}), now);
  expect(weather.title).toBe("날씨");
  expect(weather.value).toBe("");
  expect(weather.meta).toBe("아직 확인하지 않았어요");
});

it("keeps a readable label on the empty calendar chip", () => {
  render(<FreeformWidget widget={widget("calendar", { events: [] })} now={Date.now()} />);
  expect(screen.getByRole("button", { name: "캘린더 일정 없음" })).toBeTruthy();
});
