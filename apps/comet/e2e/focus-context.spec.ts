import { expect, test } from "./tauri";

const now = Date.parse("2026-10-07T12:00:00Z");
const previousSession = {
  id: "s1",
  title: "이전 집중",
  startedAt: now - 3_600_000,
  endedAt: now - 2_100_000,
  elapsedMs: 1_500_000,
  segments: [{ startAt: now - 3_600_000, endAt: now - 2_100_000 }],
  memo: "기존 기록 메모",
  noteRef: { kind: "diary", id: "old-note", title: "이전 노트" },
};
const base = {
  reaction: true,
  version: 1,
  missing: [],
  packageBytes: 0,
  error: null,
  status: "enabled",
};
const before = {
  ...base,
  id: "focus",
  kind: "focus-timer",
  revision: 1,
  data: {
    status: "idle",
    mode: "focus",
    durationMs: 1_500_000,
    title: "이전 작업",
    memo: "이전 집중 메모",
    todoId: null,
    eventRef: { calendarWidgetId: "calendar", id: "previous-event", title: "이전 일정" },
    noteRef: { kind: "diary", id: "old-note", title: "이전 노트" },
    sessions: [previousSession],
  },
};
const todo = {
  ...base,
  id: "todo",
  kind: "todo",
  revision: 4,
  data: { items: [{ id: "task", title: "자료 검토", completedAt: null, memo: "할 일 원문" }] },
};
// What the organizer's focus_start with a todoId stores: a new context over the same history.
const context = { title: "자료 검토", todoId: "task", memo: "", eventRef: null, noteRef: null };
const started = {
  ...before,
  revision: 2,
  data: {
    ...before.data,
    ...context,
    status: "running",
    startedAt: now,
    endsAt: now + 1_500_000,
    activeSession: { id: "s2", startedAt: now, ...context },
  },
};
const catalog = [
  {
    id: "focus-timer",
    name: "집중 타이머",
    description: "",
    category: "",
    version: 1,
    required: [],
    connection: null,
  },
];

test("a focus the organizer starts for a task replaces the open window's context and keeps its records", async ({
  page,
  tauri,
}) => {
  await page.clock.setFixedTime(new Date(now));
  tauri.handle("get_widgets", () => ({ catalog, onboardingDone: true, widgets: [before, todo] }));
  await tauri.open("widget", { id: "focus" });
  const timer = page.getByRole("region", { name: "타이머 조작" });
  await expect(timer.getByRole("textbox", { name: "집중할 일" })).toHaveValue("이전 작업");
  await expect(timer.getByText("일정 · 이전 일정")).toBeVisible();

  const writesBefore = tauri.calls.length;
  await tauri.emit("widgets-state", { catalog, onboardingDone: true, widgets: [started, todo] });

  await expect(timer).toContainText("자료 검토");
  await expect(timer.getByText(/이전 작업/)).toHaveCount(0);
  await expect(timer.getByRole("button", { name: "일정 연결 해제" })).toBeHidden();
  await expect(page.getByRole("timer", { name: "남은 시간" })).toBeVisible();

  const panel = page.getByRole("complementary", { name: "일정과 집중 기록" });
  await panel.getByText("노트", { exact: true }).click();
  await expect(page.getByLabel("이번 집중 메모")).toHaveValue("");
  await expect(page.getByLabel("연결한 메모 내용")).toHaveCount(0);

  await panel.getByText("기록", { exact: true }).click();
  await expect(panel.getByRole("button", { name: "이전 집중 집중 기록 상세" })).toBeVisible();

  // Receiving the new context must not write anything back over the organizer's change
  // (organizer_touch is the activity ping from the clicks above).
  const after = tauri.calls.slice(writesBefore).map((call) => call.name);
  expect(
    after.filter((name) => !/^(get|list|count)_|analytics|organizer_touch/.test(name)),
  ).toEqual([]);
});
