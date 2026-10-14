import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FocusTimerCalendar } from "./FocusTimerCalendar";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";

const calendar: WidgetView = {
  id: "calendar",
  kind: "calendar",
  version: 1,
  installed: true,
  enabled: true,
  revision: 1,
  data: { connections: [], events: [] },
  error: null,
  missing: [],
  status: "enabled",
  packageBytes: 0,
};
const act = vi.fn<ToolAction>();
function view(): void {
  render(
    <FocusTimerCalendar
      calendar={calendar}
      act={act}
      canPrepare
      title="자정 뒤에도 이어 쓰기"
      durationMs={25 * 60000}
      noteRef={{ kind: "diary", id: "original", title: "원본 노트" }}
      linkedEvent={null}
      sessions={[]}
      onPrepare={vi.fn()}
      onSession={vi.fn()}
    />,
  );
}
beforeEach(() => {
  act.mockReset();
  act.mockResolvedValue(true);
});
afterEach(cleanup);

it("keeps schedule inputs hidden until requested and copies an overnight focus without truncating its duration", async () => {
  view();
  expect(screen.queryByRole("form", { name: "일정 빠르게 등록" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
  fireEvent.change(screen.getByLabelText(/^일정 날짜\s*\*?$/), { target: { value: "2026-10-07" } });
  fireEvent.change(screen.getByLabelText(/^시작\s*\*?$/), { target: { value: "23:50" } });
  fireEvent.click(screen.getByRole("button", { name: "집중할 일 가져오기" }));
  expect(screen.getByLabelText(/^종료 날짜\s*\*?$/)).toHaveProperty("value", "2026-10-08");
  expect(screen.getByLabelText(/^종료\s*\*?$/)).toHaveProperty("value", "00:15");
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "일정 등록" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "create-event",
      {
        title: "자정 뒤에도 이어 쓰기",
        allDay: false,
        startAt: new Date("2026-10-07T23:50:00").getTime(),
        endAt: new Date("2026-10-08T00:15:00").getTime(),
        timeZone: "local",
        noteRef: { kind: "diary", id: "original", title: "원본 노트" },
      },
      calendar,
    ),
  );
  expect(screen.queryByRole("form", { name: "일정 빠르게 등록" })).toBeNull();
});

it("prevents composition Enter from submitting and retains the schedule draft after a failed save", async () => {
  act.mockResolvedValue(false);
  view();
  fireEvent.click(screen.getByRole("button", { name: "일정 추가" }));
  const input = screen.getByLabelText(/^일정 제목\s*\*?$/);
  fireEvent.change(input, { target: { value: "조합 중인 제목" } });
  fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
  expect(act).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.change(screen.getByLabelText(/^시작\s*\*?$/), { target: { value: "14:00" } });
  fireEvent.change(screen.getByLabelText(/^종료\s*\*?$/), { target: { value: "14:30" } });
  fireEvent.click(screen.getByRole("button", { name: "일정 등록" }));
  await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
  expect(input).toHaveProperty("value", "조합 중인 제목");
  expect(screen.getByRole("form", { name: "일정 빠르게 등록" })).toBeTruthy();
});
