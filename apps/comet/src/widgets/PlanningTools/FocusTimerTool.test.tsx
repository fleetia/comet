import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimerTool } from "./FocusTimerTool";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { command } from "../../hooks/useSnapshot";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
}));

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
  it("lets the embedded timer track shrink while preserving standalone widths", async () => {
    // jsdom has no layout engine; actual 330px clipping is checked in a browser fixture.
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: string, encoding: "utf8"): string;
    }>("node:fs");
    const styles = readFileSync("src/widgets/PlanningTools/FocusTimer.css.ts", "utf8");
    expect(styles).toContain(
      'globalStyle(`${layout}[data-embedded="true"][data-expanded="false"]`, {\n  gridTemplateColumns: "minmax(0, 370px)",',
    );
    expect(styles).toContain('gridTemplateColumns: "556px 370px"');
    expect(styles).toContain(
      `'&[data-expanded="false"]': { gridTemplateColumns: "310px", justifyContent: "end" }`,
    );
    render(
      <TimerTool
        widget={widget("focus-timer", { status: "idle" })}
        widgets={[]}
        act={action}
        embedded
      />,
    );
    const layout = screen.getByLabelText("집중 타이머").querySelector('[data-embedded="true"]');
    expect(layout?.getAttribute("data-expanded")).toBe("false");
    fireEvent.change(screen.getByLabelText("집중할 일"), {
      target: { value: "좁은 스택에서 쓰기" },
    });
    await click("집중 시작");
    expect(action).toHaveBeenLastCalledWith(
      "start",
      expect.objectContaining({ title: "좁은 스택에서 쓰기" }),
    );
    await click("기록과 노트");
    expect(layout?.getAttribute("data-expanded")).toBe("true");
  });

  it("leaves companion rows to the surrounding desktop stack when embedded", async () => {
    const companions = vi.fn(() => <button type="button">다른 시계</button>);
    render(
      <TimerTool
        widget={widget("focus-timer", { status: "idle" })}
        widgets={[]}
        act={action}
        embedded
        companionRows={companions}
      />,
    );
    await click("기록과 노트");
    expect(screen.queryByRole("group", { name: "다른 바탕화면 위젯" })).toBeNull();
    expect(companions).not.toHaveBeenCalled();
  });

  it("keeps the running timer and note draft when folded into a summary card", async () => {
    const timer = widget("focus-timer", {
      status: "running",
      mode: "focus",
      durationMs: 1500000,
      remainingMs: 1500000,
      deadline: Date.now() + 1500000,
    });
    render(<TimerTool widget={timer} widgets={[]} act={action} />);
    await click("노트", "radio");
    const memo = screen.getByLabelText("이번 집중 메모");
    fireEvent.compositionStart(memo);
    fireEvent.change(memo, { target: { value: "아직 조합 중인 초안" } });
    await click("접기");
    expect(screen.getByRole("button", { name: "펼쳐 보기" }).textContent).toContain("25:00");
    await reactAct(async () => vi.advanceTimersByTimeAsync(1300));
    expect(screen.getByRole("button", { name: "펼쳐 보기" }).textContent).toContain("24:59");
    await click("펼쳐 보기");
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:59");
    expect(screen.getByLabelText("이번 집중 메모")).toBe(memo);
    expect(memo).toHaveProperty("value", "아직 조합 중인 초안");
    expect(action).not.toHaveBeenCalled();
  });

  it("follows the saved presentation and opens the settings detail instead of a second copy", async () => {
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
    await click("집중 설정");
    expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "focus-timer" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("휴식 시간 (분)")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "타이머 표시 방식" })).toBeNull();
    expect(action).not.toHaveBeenCalled();
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
    await click("캘린더 일정 연결");
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
    await click("노트", "radio");
    fireEvent.change(screen.getByLabelText("이번 집중 메모"), {
      target: { value: "다음에 확인할 내용" },
    });
    view.unmount();
    render(<TimerTool widget={timer} widgets={[]} act={action} />);
    expect(screen.getByLabelText("집중할 일")).toHaveProperty("value", "작업 초안");
    await click("노트", "radio");
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
    await click("노트", "radio");
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
    expect(screen.getByRole("alert").textContent).toContain("다른 화면에서 집중 메모가 바뀌었어요");
    await reactAct(async () => vi.advanceTimersByTimeAsync(600));
    expect(action).not.toHaveBeenCalled();
  });
});

it("shows automatic rest behind the focus completion card and keeps todo completion explicit", async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const timer = widget("focus-timer", {
    status: "running",
    mode: "rest",
    completedFocusPending: true,
    title: "기획서",
    todoId: "task",
    durationMs: 300000,
    remainingMs: 300000,
    deadline: Date.now() + 300000,
    focusDurationMs: 1500000,
    settings: { restDurationMs: 300000, autoStartRest: true },
    sessions: [
      {
        id: "session",
        startedAt: Date.now() - 1500000,
        endedAt: Date.now(),
        elapsedMs: 1500000,
        memo: "",
        segments: [],
      },
    ],
  });
  const todo = widget("todo", {
    items: [{ id: "task", title: "기획서 마무리", completedAt: null }],
  });
  const view = render(<TimerTool widget={timer} widgets={[todo]} act={action} />);
  expect(screen.getByText("집중 시간이 끝났어요")).toBeTruthy();
  expect(action).not.toHaveBeenCalled();
  await user.click(screen.getByRole("checkbox", { name: "기획서 마무리 완료로 표시" }));
  expect(action).toHaveBeenCalledExactlyOnceWith("complete", { id: "task" }, todo);
  view.rerender(
    <TimerTool
      widget={timer}
      widgets={[
        {
          ...todo,
          revision: 2,
          data: { items: [{ id: "task", title: "기획서 마무리", completedAt: Date.now() }] },
        },
      ]}
      act={action}
    />,
  );
  const completed = screen.getByRole("checkbox", { name: "기획서 마무리 완료로 표시" });
  expect(completed).toHaveProperty("checked", true);
  expect(completed).toHaveProperty("disabled", true);
  await user.click(completed);
  fireEvent.click(completed);
  expect(action).toHaveBeenCalledTimes(1);
  await reactAct(async () =>
    fireEvent.click(screen.getByRole("button", { name: /휴식 5분 시작/ })),
  );
  expect(action).toHaveBeenLastCalledWith("show-rest");
  view.rerender(
    <TimerTool
      widget={{
        ...timer,
        revision: 2,
        data: { ...(timer.data as DataRecord), completedFocusPending: false },
      }}
      widgets={[todo]}
      act={action}
    />,
  );
  expect(screen.getByText("잠깐 쉬어 가요")).toBeTruthy();
  await click("휴식 건너뛰기");
  expect(action).toHaveBeenLastCalledWith("continue");
});

it("submits todo completion once while saving and retries only after a failed attempt", async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const timer = widget("focus-timer", {
    status: "finished",
    mode: "focus",
    todoId: "task",
    durationMs: 1500000,
    remainingMs: 0,
  });
  const todo = widget("todo", {
    items: [{ id: "task", title: "기획서 마무리", completedAt: null }],
  });
  let finishAttempt: (saved: boolean) => void = () => {};
  action.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finishAttempt = resolve;
    }),
  );
  const view = render(<TimerTool widget={timer} widgets={[todo]} act={action} />);
  const checkbox = screen.getByRole("checkbox", { name: "기획서 마무리 완료로 표시" });
  checkbox.focus();
  await user.keyboard(" ");
  expect(action).toHaveBeenCalledExactlyOnceWith("complete", { id: "task" }, todo);
  expect(checkbox).toHaveProperty("disabled", true);
  await user.click(checkbox);
  fireEvent.click(checkbox);
  expect(action).toHaveBeenCalledTimes(1);
  await reactAct(async () => finishAttempt(false));
  expect(checkbox).toHaveProperty("disabled", false);
  expect(screen.getByRole("alert").textContent).toContain("다시 시도");
  await user.click(checkbox);
  expect(action).toHaveBeenCalledTimes(2);
  expect(checkbox).toHaveProperty("disabled", true);
  await user.click(checkbox);
  fireEvent.click(checkbox);
  expect(action).toHaveBeenCalledTimes(2);
  view.rerender(<TimerTool widget={timer} widgets={[{ ...todo, revision: 3 }]} act={action} />);
  expect(checkbox).toHaveProperty("disabled", false);
  await user.click(checkbox);
  expect(action).toHaveBeenCalledTimes(3);
});

it("submits the completion memo and transition atomically while retaining rejected drafts", async () => {
  const timer = widget("focus-timer", {
    status: "finished",
    mode: "focus",
    durationMs: 1500000,
    remainingMs: 0,
    memo: "",
    sessions: [
      {
        id: "session",
        startedAt: Date.now() - 1500000,
        endedAt: Date.now(),
        elapsedMs: 1500000,
        memo: "",
        segments: [],
      },
    ],
  });
  const view = render(<TimerTool widget={timer} widgets={[]} act={action} />);
  fireEvent.change(screen.getByLabelText("완료한 집중 메모"), { target: { value: "다음 단계" } });
  fireEvent.blur(screen.getByLabelText("완료한 집중 메모"));
  expect(action).not.toHaveBeenCalled();
  action.mockResolvedValueOnce(false);
  await click("계속 집중");
  expect(action).toHaveBeenCalledExactlyOnceWith("continue", {
    memo: "다음 단계",
    expectedMemo: "",
  });
  expect(screen.getByRole("alert").textContent).toContain("초안은 남아");
  expect(screen.getByLabelText("완료한 집중 메모")).toHaveProperty("value", "다음 단계");
  view.unmount();
  render(<TimerTool widget={timer} widgets={[]} act={action} />);
  expect(screen.getByLabelText("완료한 집중 메모")).toHaveProperty("value", "다음 단계");
  await click("오늘은 여기까지");
  expect(action).toHaveBeenLastCalledWith("cancel", { memo: "다음 단계", expectedMemo: "" });
});
