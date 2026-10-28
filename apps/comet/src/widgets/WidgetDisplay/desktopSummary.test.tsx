import { expect, it } from "vitest";
import type { WidgetValue, WidgetView } from "../types";
import { render, screen } from "@testing-library/react";
import { desktopSummary, FreeformWidget } from "./DesktopWidget";

function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    version: 1,
    reaction: true,
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

it("shows the unstarted focus choice instead of the previous confirmed session", () => {
  localStorage.clear();
  const now = Date.now();
  const data = { status: "idle", mode: "focus", title: "원고", focusDurationMs: 180000, remainingMs: 180000 };
  const base = JSON.stringify({
    title: "원고",
    minutes: "3",
    todoId: "",
    eventRef: null,
    noteRef: null,
    memo: "",
  });
  const choose = (draft: Record<string, string>, savedBase = base): void =>
    localStorage.setItem(
      "comet.focus.draft:focus-timer",
      JSON.stringify({ base: savedBase, draft: { todoId: "", memo: "", ...draft }, memoBase: "" }),
    );
  expect(desktopSummary(widget("focus-timer", data), now)).toMatchObject({
    description: "원고",
    value: "03:00",
  });
  choose({ title: "교정", minutes: "25" });
  expect(desktopSummary(widget("focus-timer", data), now)).toMatchObject({
    title: "집중 준비",
    description: "교정",
    value: "25:00",
  });
  choose({ title: "", minutes: "25" });
  expect(desktopSummary(widget("focus-timer", data), now).description).toBe(
    "집중할 일을 정해 주세요",
  );
  // A draft written against an older confirmed session is not this choice.
  choose({ title: "교정", minutes: "25" }, "{}");
  expect(desktopSummary(widget("focus-timer", data), now).value).toBe("03:00");
  choose({ title: "교정", minutes: "25" });
  const running = { ...data, status: "running", remainingMs: 120000, deadline: now + 120000 };
  expect(desktopSummary(widget("focus-timer", running), now)).toMatchObject({
    description: "원고",
    value: "02:00",
  });
  localStorage.clear();
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
