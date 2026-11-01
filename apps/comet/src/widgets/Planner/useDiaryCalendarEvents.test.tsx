import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";
import { useDiaryCalendarEvents } from "./useDiaryCalendarEvents";

vi.mock("../../hooks/useSnapshot", () => ({ command: vi.fn() }));
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it("checks the restored original event before updating a concurrently changed event", async () => {
  const original = { id: "event", title: "원래 일정", connectionId: "local", allDay: true };
  const current = { ...original, title: "다른 창에서 수정" };
  const widget: WidgetView = {
    kind: "calendar", id: "calendar", revision: 2, data: { events: [current] },
    reaction: true, version: 1, error: null, missing: [], status: "enabled", packageBytes: 1,
  };
  localStorage.setItem("comet:diary-calendar-draft", JSON.stringify({
    date: "2026-10-08", event: original, revision: 1,
    values: { title: "내 초안", allDay: true, startDate: "2026-10-08", endDate: "2026-10-08", startTime: "09:00", endTime: "10:00", location: "", description: "", moveTogether: false },
  }));
  vi.mocked(command).mockResolvedValue({ widgets: [widget] });
  const actions = {
    latestWidgets: { current: [] },
    ensureWidget: vi.fn().mockResolvedValue(widget),
    run: async (operation: () => Promise<unknown>) => {
      try { return { value: await operation() }; } catch { return null; }
    },
  } as unknown as DiaryWidgetActions;
  const { result } = renderHook(() => useDiaryCalendarEvents({ actions, reload: vi.fn() }));
  let saved = true;
  await act(async () => { saved = await result.current.saveCalendarEvent({ title: "내 초안" }); });
  expect(saved).toBe(false);
  expect(result.current.calendarDraft?.event).toEqual(original);
  expect(localStorage.getItem("comet:diary-calendar-draft")).not.toBeNull();
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).not.toContain("execute_widget");
});
