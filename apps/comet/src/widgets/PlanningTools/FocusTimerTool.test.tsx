import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimerTool } from "./FocusTimerTool";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";

function widget(kind: string, data: DataRecord): WidgetView {
  return {
    id: `${kind}-id`,
    kind,
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
const action = vi.fn<ToolAction>();
beforeEach(() => {
  localStorage.clear();
  action.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T10:00:00"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function click(name: string, role = "button"): Promise<void> {
  await reactAct(async () => fireEvent.click(screen.getByRole(role, { name })));
}

describe("focus workspace", () => {
  it("switches presentation without changing the running countdown", async () => {
    const timer = widget("focus-timer", {
      status: "running",
      mode: "focus",
      durationMs: 1500000,
      remainingMs: 1500000,
      deadline: Date.now() + 1500000,
    });
    const view = render(<TimerTool widget={timer} widgets={[]} act={action} />);
    await reactAct(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:58");
    await click("숫자");
    expect(action).toHaveBeenCalledExactlyOnceWith("configure", { presentation: "digits" });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:58");
    view.rerender(
      <TimerTool
        widget={{
          ...timer,
          revision: 2,
          data: {
            ...(timer.data as DataRecord),
            presentation: "digits",
            status: "paused",
            remainingMs: 1498000,
            deadline: null,
          },
        }}
        widgets={[]}
        act={action}
      />,
    );
    await reactAct(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:58");
  });

  it("opens event details separately and prepares a linked focus only on the explicit action", async () => {
    const event = {
      id: "event",
      title: "원고 쓰기",
      startAt: Date.now() + 60000,
      endAt: Date.now() + 31 * 60000,
      allDay: false,
      cancelled: false,
      connectionId: "local",
      sourceId: "local",
      occurrenceId: "event",
      noteRef: { kind: "diary", id: "note", title: "원고 노트" },
    };
    const calendar = widget("calendar", { events: [event], connections: [] });
    const timer = widget("focus-timer", { status: "idle", mode: "focus", durationMs: 1500000 });
    render(<TimerTool widget={timer} widgets={[calendar]} act={action} />);
    expect(screen.queryByRole("form", { name: "일정 빠르게 등록" })).toBeNull();
    await click("원고 쓰기 일정 상세");
    expect(action).not.toHaveBeenCalled();
    await click("이 일정으로 집중 준비");
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "configure",
      expect.objectContaining({
        title: "원고 쓰기",
        durationMs: 30 * 60000,
        noteRef: event.noteRef,
        eventRef: expect.objectContaining({ calendarWidgetId: calendar.id, id: "event" }),
      }),
    );
    expect(screen.getByLabelText("집중할 일")).toHaveProperty("value", "원고 쓰기");
    await click("집중 시작");
    expect(action).toHaveBeenLastCalledWith(
      "start",
      expect.objectContaining({
        durationMs: 30 * 60000,
        title: "원고 쓰기",
        noteRef: event.noteRef,
      }),
    );
  });

  it("retains an unsaved focus title and memo when closed and reopened", async () => {
    const timer = widget("focus-timer", { status: "idle", mode: "focus", durationMs: 1500000 });
    const view = render(<TimerTool widget={timer} widgets={[]} act={action} />);
    fireEvent.change(screen.getByLabelText("집중할 일"), { target: { value: "작업 초안" } });
    await click("노트", "tab");
    fireEvent.change(screen.getByLabelText("이번 집중 메모"), {
      target: { value: "다음에 확인할 내용" },
    });
    view.unmount();
    render(<TimerTool widget={timer} widgets={[]} act={action} />);
    expect(screen.getByLabelText("집중할 일")).toHaveProperty("value", "작업 초안");
    await click("노트", "tab");
    expect(screen.getByLabelText("이번 집중 메모")).toHaveProperty("value", "다음에 확인할 내용");
    await click("집중 시작");
    expect(action).toHaveBeenCalledExactlyOnceWith("start", {
      durationMs: 1500000,
      todoId: null,
      title: "작업 초안",
      memo: "다음에 확인할 내용",
    });
  });

  it("preserves a dirty current memo when another window changes it", async () => {
    const timer = widget("focus-timer", {
      status: "running",
      mode: "focus",
      memo: "원문",
      durationMs: 1500000,
      remainingMs: 1500000,
      deadline: Date.now() + 1500000,
    });
    const view = render(<TimerTool widget={timer} widgets={[]} act={action} />);
    await click("노트", "tab");
    fireEvent.change(screen.getByLabelText("이번 집중 메모"), {
      target: { value: "작성 중인 초안" },
    });
    view.rerender(
      <TimerTool
        widget={{
          ...timer,
          revision: 2,
          data: { ...(timer.data as DataRecord), memo: "다른 창의 저장" },
        }}
        widgets={[]}
        act={action}
      />,
    );
    expect(screen.getByLabelText("이번 집중 메모")).toHaveProperty("value", "작성 중인 초안");
    expect(screen.getByRole("button", { name: "메모 저장" })).toHaveProperty("disabled", true);
    expect(action).not.toHaveBeenCalled();
  });
});
