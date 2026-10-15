import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DiaryToday } from "./DiaryToday";
import type { WidgetView } from "../types";

afterEach(cleanup);

it("shows real focus intervals clipped to the selected day and routes the exact task", () => {
  const onTask = vi.fn();
  const task = { id: "task", title: "초안 마무리", plannedDate: "2026-10-08", completedAt: null };
  const startedAt = new Date("2026-10-07T23:45:00").getTime();
  const endedAt = new Date("2026-10-08T00:10:00").getTime();
  const widget: WidgetView = {
    id: "timer",
    kind: "focus-timer",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: {
      sessions: [
        {
          id: "session",
          title: "원고",
          startedAt,
          endedAt,
          elapsedMs: 1500000,
          segments: [{ startAt: startedAt, endAt: endedAt }],
        },
      ],
    },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  render(
    <DiaryToday
      day="2026-10-08"
      widgets={[widget]}
      items={[task]}
      events={[]}
      notes={[]}
      busy={false}
      onTask={onTask}
      onTasks={vi.fn()}
      onEvent={vi.fn()}
      onNotes={vi.fn()}
    />,
  );
  const ring = within(screen.getByRole("group", { name: "하루 시간 기록" }));
  expect(ring.getByText("집중한 시간")).toBeTruthy();
  expect(ring.getByText("10분")).toBeTruthy();
  expect(screen.queryByText("칠할 분류")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "초안 마무리" }));
  expect(onTask).toHaveBeenCalledExactlyOnceWith(task);
  expect(task.completedAt).toBeNull();
});

it("keeps an empty day empty instead of adding sample focus records or tasks", () => {
  render(
    <DiaryToday
      day="2026-10-08"
      widgets={[]}
      items={[]}
      events={[]}
      notes={[]}
      busy={false}
      onTask={vi.fn()}
      onTasks={vi.fn()}
      onEvent={vi.fn()}
      onNotes={vi.fn()}
    />,
  );
  expect(screen.getByText("이날 계획한 할 일이 없어요.")).toBeTruthy();
  expect(screen.getByText("이날 예정된 일정이 없어요.")).toBeTruthy();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});
