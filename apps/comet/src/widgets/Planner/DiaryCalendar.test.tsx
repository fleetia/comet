import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiaryCalendar } from "./DiaryCalendar";
import type { FocusSession } from "../PlanningTools/FocusTimerData";

afterEach(cleanup);

it("projects observed focus segments into each day while respecting the session's timeline choice", () => {
  const startedAt = new Date("2026-10-07T23:45:00").getTime();
  const endedAt = new Date("2026-10-08T00:10:00").getTime();
  const session: FocusSession = {
    id: "focus",
    title: "원고",
    startedAt,
    endedAt,
    elapsedMs: endedAt - startedAt,
    outcome: "finished",
    memo: "",
    eventRef: {},
    noteRef: {},
    segments: [{ startAt: startedAt, endAt: endedAt }],
  };
  const onDay = vi.fn();
  render(
    <DiaryCalendar
      day="2026-10-08"
      view="week"
      pages={[]}
      events={[]}
      items={[]}
      envelopes={[]}
      focusSessions={[
        session,
        { ...session, id: "hidden", title: "개인 기록", recordTimeline: false },
      ]}
      onDay={onDay}
      onEvent={vi.fn()}
      onEnvelope={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "2026-10-07 원고 집중 · 15분" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2026-10-08 원고 집중 · 10분" }));
  expect(onDay).toHaveBeenCalledExactlyOnceWith("2026-10-08");
  expect(screen.queryByRole("button", { name: /개인 기록/ })).toBeNull();
});
