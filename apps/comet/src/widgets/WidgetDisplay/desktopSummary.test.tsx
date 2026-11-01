import { afterEach, expect, it, vi } from "vitest";
import type { WidgetValue, WidgetView } from "../types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { CollapsedDesktopWidget, desktopSummary, ExpandedDesktopWidget, FreeformWidget, widgetWindowCommand } from "./DesktopWidget";
import { widgetLine } from "../Travel/travelSummary";

vi.mock("../../hooks/useSnapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../hooks/useSnapshot")>(),
  command: vi.fn(),
}));
afterEach(cleanup);

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

it("selects the most recently updated nonempty stored memo", () => {
  const memo = widget("memo", { notes: [
    { id: "old", title: "예전", body: "", isOpen: false, updatedAt: 1 },
    { id: "new", title: "", body: "최근 내용", isOpen: false, updatedAt: 3 },
    { id: "blank", title: "", body: "", isOpen: false, updatedAt: 4 },
  ] });
  expect(desktopSummary(memo, 0).description).toBe("최근 내용");
  expect(widgetWindowCommand(memo)).toEqual(["open_memo_note", { id: "memo", noteId: "new" }]);
  expect(widgetWindowCommand(widget("memo", { notes: [{ id: "blank", title: "", body: "" }] })))
    .toEqual(["open_widget", { id: "memo" }]);
});

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
  expect(weather.meta).toBe("지역을 골라 주세요");
});

it("shows weather lookup states and labels the previous region", () => {
  const now = Date.now();
  expect(desktopSummary(widget("weather", { configured: true, status: "stale" }), now).meta)
    .toBe("아직 확인하지 않았어요");
  expect(desktopSummary(widget("weather", { configured: true, status: "syncing", lastAttemptAt: now }), now).meta)
    .toBe("날씨 확인 중");
  const failed = widget("weather", { configured: true, status: "offline", lastAttemptAt: now });
  expect(desktopSummary(failed, now).meta).toBe("날씨 확인 실패");
  render(<FreeformWidget widget={failed} now={now} />);
  expect(screen.getByText("날씨 확인 실패")).toBeTruthy();
  expect(desktopSummary(widget("weather", {
    configured: true, status: "offline", lastAttemptAt: now, lastSuccessAt: null,
    config: { name: "부산" }, observation: { name: "서울", temperature: 21, weatherCode: 0 },
  }), now)).toMatchObject({ description: "서울", meta: "새 지역 확인 실패 · 이전 지역 정보" });
});

it("keeps a readable label on the empty calendar chip", () => {
  render(<FreeformWidget widget={widget("calendar", { events: [] })} now={Date.now()} />);
  expect(screen.getByRole("button", { name: "캘린더 일정 없음" })).toBeTruthy();
});

it("counts only today's planned tasks and shows unfinished overdue tasks when today is empty", () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const items = [
    { plannedDate: "2026-10-16", completedAt: now },
    { plannedDate: "2026-10-16", completedAt: null },
    { plannedDate: "2026-10-15", completedAt: null },
    { plannedDate: "2026-10-14", completedAt: now },
    { plannedDate: "2026-10-17", completedAt: null },
    { plannedDate: null, completedAt: null },
  ];
  expect(desktopSummary(widget("todo", { items }), now)).toMatchObject({ value: "1 / 2", description: "1개 남음" });
  expect(desktopSummary(widget("todo", { items: items.slice(2) }), now)).toMatchObject({ value: "밀린 일 1개", description: "밀린 일 1개" });
  expect(desktopSummary(widget("todo", { items: [] }), now).value).toBe("0 / 0");
});

it("keeps all-day events until the exclusive end date and shows dates for future events", () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const allDay = { title: "휴가", allDay: true, startDate: "2026-10-15", endDate: "2026-10-17" };
  expect(desktopSummary(widget("calendar", { events: [allDay] }), now)).toMatchObject({ description: "휴가", value: "10. 15. 종일" });
  expect(desktopSummary(widget("calendar", { events: [allDay] }), new Date(2026, 9, 17).getTime()).description).toBe("예정된 일정이 없어요");
  const start = new Date(2026, 9, 17, 15, 30).getTime();
  const timed = { title: "약속", startAt: start, endAt: start + 3600000 };
  expect(desktopSummary(widget("calendar", { events: [timed] }), now).value).toBe("10. 17. 오후 3:30");
  expect(desktopSummary(widget("calendar", { events: [timed] }), start).value).toBe("오후 3:30");
  const calendar = widget("calendar", { events: [timed] });
  render(<FreeformWidget widget={calendar} now={now} />);
  expect(screen.getByRole("button", { name: "캘린더 10/17" })).toBeTruthy();
  render(<CollapsedDesktopWidget widget={calendar} now={now} onExpand={() => undefined} />);
  expect(screen.getByText("10. 17. 오후 3:30")).toBeTruthy();
});

it("shows the travel read failure on the chip and without repeating it in the row", () => {
  const line = widgetLine(undefined, null, new Date(), "error");
  const travel = widget("travel", { line });
  render(<FreeformWidget widget={travel} now={Date.now()} />);
  expect(screen.getByRole("button", { name: "여행 정보를 불러오지 못했어요 확인 필요" })).toBeTruthy();
  cleanup();
  render(<CollapsedDesktopWidget widget={travel} now={Date.now()} onExpand={() => undefined} />);
  expect(screen.getByText("여행 정보를 불러오지 못했어요")).toBeTruthy();
  expect(screen.getByText("다시 불러와 주세요")).toBeTruthy();
  expect(screen.getAllByText("확인 필요")).toHaveLength(1);
});

it("distinguishes failed calendar reads with and without a cached event", () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const failed = { ...widget("calendar", { events: [] }), status: "error" as const };
  expect(desktopSummary(failed, now)).toMatchObject({ description: "확인 필요", value: "확인 필요", meta: "" });
  render(<FreeformWidget widget={failed} now={now} />);
  expect(screen.getByRole("button", { name: "캘린더 확인 필요" })).toBeTruthy();
  const cached = { ...failed, status: "enabled" as const, error: "연결 실패", data: { events: [{ title: "약속", startAt: now + 1000, endAt: now + 2000 }] } };
  expect(desktopSummary(cached, now)).toMatchObject({ description: "약속", meta: "이전 정보" });
  render(<FreeformWidget widget={cached} now={now} />);
  expect(screen.getByRole("button", { name: "캘린더 이전 정보" })).toBeTruthy();
});

it("shows music connection and running states without an empty-track caption", () => {
  const now = Date.now();
  expect(desktopSummary(widget("music", {}), now)).toMatchObject({ title: "음악 앱을 연결해 주세요", meta: "", value: "" });
  expect(desktopSummary(widget("music", { configured: true, observation: { running: false } }), now).title).toBe("음악 앱이 닫혀 있어요");
  const playing = widget("music", { configured: true, observation: { running: true } });
  expect(desktopSummary(playing, now)).toMatchObject({ title: "재생 중인 곡이 없어요", meta: "" });
  render(<FreeformWidget widget={playing} now={now} />);
  expect(screen.queryByText("지금 듣는 곡")).toBeNull();
  expect(screen.queryByText("이전 정보")).toBeNull();
});

it("omits the focus action when no preparation envelope exists", () => {
  const preparation = widget("preparation", { envelopes: [] });
  render(<ExpandedDesktopWidget widget={preparation} widgets={[preparation]} now={Date.now()} onCollapse={() => undefined} act={async () => true} />);
  expect(screen.queryByRole("button", { name: "이 봉투로 집중" })).toBeNull();
  expect(screen.getByRole("button", { name: "봉투 열기" })).toBeTruthy();
});

it("opens the corresponding settings detail when a chip cannot open its window", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(undefined);
  render(<FreeformWidget widget={widget("travel", {})} now={Date.now()} />);
  fireEvent.click(screen.getByRole("button", { name: "여행 여행" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "travel" }));
});
