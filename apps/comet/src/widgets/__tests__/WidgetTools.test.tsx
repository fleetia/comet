// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { WidgetTool } from "../WidgetTool/WidgetTool";
import { TodoTool } from "../TodoTool/TodoTool";
import { ClockTool, TimerTool } from "../PlanningTools/PlanningTools";
import { ToyTool } from "../ToyTools/ToyTools";
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import { PREVIEW_SNAPSHOT, command } from "../../hooks/useSnapshot";
import type { WidgetValue, WidgetView } from "../types";
import { transparentDocument } from "../../components/companion.css";
const native = vi.hoisted(() => ({
  onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
  startDragging: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../useWidgets", async (load) => ({
  ...(await load<typeof import("../useWidgets")>()),
  useWidgets: vi.fn(),
}));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    reaction: true,
    revision: 8,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
const act = vi.fn<() => Promise<boolean>>();
beforeEach(() => {
  native.onCloseRequested.mockClear();
  act.mockReset();
  act.mockResolvedValue(true);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps focus companion rows usable when character reactions are off", async () => {
  const timer = widget("focus-timer", {
    status: "running",
    mode: "focus",
    durationMs: 1500000,
    remainingMs: 1500000,
    deadline: Date.now() + 1500000,
  });
  const values = [
    timer,
    widget("clock", {
      format: "12h",
      anniversaries: [
        { id: "first", title: "함께 지내기 시작한 날", date: "2026-09-01", countMode: "elapsed" },
      ],
    }),
    widget("weather", {
      status: "ready",
      config: { temperatureUnit: "celsius" },
      observation: { name: "서울", temperature: 23, weatherCode: 2 },
    }),
    widget("music", { observation: { title: "밤의 산책", artist: "별빛정원" } }),
    widget("preparation", { envelopes: [{ id: "trip", title: "가족 여행", checks: [] }] }),
  ];
  const current = {
    snapshot: { ...PREVIEW_WIDGETS, widgets: values },
    error: null,
    reload: vi.fn(),
  };
  vi.mocked(useWidgets).mockReturnValue(current);
  const view = render(<WidgetTool id="focus-timer" />);
  expect(document.documentElement.classList.contains(transparentDocument)).toBe(true);
  expect(screen.queryByRole("button", { name: "위젯 닫기" })).toBeNull();
  const companions = within(screen.getByRole("group", { name: "다른 바탕화면 위젯" }));
  expect(companions.getByText("함께 지내기 시작한 날")).toBeTruthy();
  expect(companions.getByRole("button", { name: /밤의 산책/ })).toBeTruthy();
  expect(companions.getByRole("button", { name: /가족 여행/ })).toBeTruthy();
  expect(companions.getAllByRole("button")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: /위젯 편집/ })).toBeNull();
  fireEvent.click(companions.getByRole("button", { name: /23°C/ }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "weather" }));
  vi.mocked(useWidgets).mockReturnValue({
    ...current,
    snapshot: {
      ...current.snapshot,
      widgets: values.map((item) => (item.id === "weather" ? { ...item, reaction: false } : item)),
    },
  });
  view.rerender(<WidgetTool id="focus-timer" />);
  expect(companions.getByRole("button", { name: /23°C/ })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
  view.unmount();
  expect(document.documentElement.classList.contains(transparentDocument)).toBe(false);
});

it("protects an edited envelope connection from header and native close until explicit discard", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [
        widget("preparation", {
          envelopes: [
            {
              id: "envelope",
              title: "여행",
              eventId: "",
              eventLabel: "",
              checks: [],
              links: [],
              todoIds: [],
            },
          ],
        }),
        widget("calendar", {
          connections: [],
          events: [{ id: "event", title: "떠나는 날", connectionId: "local" }],
        }),
      ],
    },
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetTool id="preparation" />);
  fireEvent.click(screen.getByText("일정 연결 · 변경"));
  fireEvent.change(screen.getByLabelText("봉투에 연결할 일정"), { target: { value: "event" } });
  fireEvent.click(screen.getByRole("button", { name: "위젯 닫기" }));
  expect(command).not.toHaveBeenCalledWith("close_widget", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  const event = { preventDefault: vi.fn() };
  await reactAct(async () => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widget", { id: "preparation" }));
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
});
it.each([
  ["completion-jar", "모은 구슬"],
  ["device", "배터리"],
  ["fishing", "낚시"],
  ["plant", "식물"],
])("opens the revived %s widget as its Figma card", (kind, label) => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [widget(kind, kind === "completion-jar" ? { completed: [] } : {})],
    },
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetTool id={kind} />);
  expect(screen.getByRole("region", { name: label })).toBeTruthy();
  expect(screen.queryByText(/설치되지 않았거나 제거한 도구/)).toBeNull();
});

it.each(["weather", "music", "preparation"])(
  "deep-links the %s tool to its settings detail",
  async (kind) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: { ...PREVIEW_WIDGETS, widgets: [widget(kind, { configured: false })] },
      error: null,
      reload: vi.fn(),
    });
    render(<WidgetTool id={kind} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: {
          preparation: "캘린더 연결 설정",
          weather: "날씨 설정 열기",
          music: "음악 설정 열기",
        }[kind],
      }),
    );
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("open_planner_settings", {
        kind: kind === "preparation" ? "calendar" : kind,
      }),
    );
    expect(command).not.toHaveBeenCalledWith("open_widgets");
    expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
  },
);
it("keeps local dates separate from datetime and shows retained settings after saving", async () => {
  render(
    <TodoTool
      widget={widget("todo", {
        lists: [
          { id: "default", name: "할 일" },
          { id: "work", name: "업무" },
        ],
        items: [],
      })}
      act={act}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^할 일 제목\s*\*?$/), { target: { value: "마감" } });
  fireEvent.click(screen.getByText("메모 · 목록 · 기한 · 반복"));
  fireEvent.change(screen.getByLabelText("기한 종류"), { target: { value: "time" } });
  const options = screen.getByText("메모 · 목록 · 기한 · 반복").closest("details");
  options?.removeAttribute("open");
  fireEvent.invalid(screen.getByLabelText(/^기한\s*\*?$/));
  expect(options).toHaveProperty("open", true);
  fireEvent.change(screen.getByLabelText(/^기한\s*\*?$/), {
    target: { value: "2026-09-16T09:30" },
  });
  fireEvent.change(screen.getByLabelText("반복"), { target: { value: "weekly" } });
  fireEvent.change(screen.getByLabelText("목록"), { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "할 일 추가" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("add", {
      title: "마감",
      memo: "",
      listId: "work",
      repeat: "weekly",
      dueDate: null,
      dueAt: new Date("2026-09-16T09:30").getTime(),
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/^할 일 제목\s*\*?$/)).toHaveProperty("value", ""),
  );
  fireEvent.click(screen.getByText("메모 · 목록 · 기한 · 반복"));
  expect(options).toHaveProperty("open", false);
  expect(options?.querySelector("summary")?.textContent).toContain("업무 · 매주");
});
it("only completes a linked todo after an explicit completion click", async () => {
  const todo = widget("todo", { items: [{ id: "task", title: "읽기", completedAt: null }] });
  render(
    <TimerTool
      widget={widget("focus-timer", { status: "finished", remainingMs: 0, todoId: "task" })}
      widgets={[todo]}
      act={act}
    />,
  );
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "5분 쉬기" }));
  expect(act).toHaveBeenCalledWith("rest", {});
  fireEvent.click(screen.getByRole("checkbox", { name: "읽기 완료로 표시" }));
  expect(act).toHaveBeenCalledWith("complete", { id: "task" }, todo);
});
it.each(["ball", "paper-plane", "bubbles"])(
  "opens and clears %s on the desktop without a panel playground",
  async (kind) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: { ...PREVIEW_WIDGETS, widgets: [widget(kind, {})] },
      error: null,
      reload: vi.fn(),
    });
    let finish: (() => void) | undefined;
    vi.mocked(command).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<WidgetTool id={kind} />);
    expect(screen.queryByLabelText("공 놀이 공간")).toBeNull();
    const open = screen.getByRole("button", { name: "바탕화면에 꺼내기" });
    const clear = screen.getByRole("button", { name: "정리하기" });
    expect(screen.getByRole("region", { name: "장난감" })).toBeTruthy();
    fireEvent.click(open);
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: expect.objectContaining({
        instanceId: kind,
        expectedRevision: 8,
        action: "desktop-open",
      }),
    });
    expect(open.matches(":disabled")).toBe(true);
    expect(clear.matches(":disabled")).toBe(true);
    fireEvent.click(clear);
    expect(command).toHaveBeenCalledTimes(1);
    await reactAct(async () => finish?.());
    fireEvent.click(clear);
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("execute_widget", {
        request: expect.objectContaining({
          instanceId: kind,
          expectedRevision: 8,
          action: "desktop-clear",
        }),
      }),
    );
  },
);
it("uses the actual fishing phase when rendering legacy fishing", () => {
  render(<ToyTool widget={widget("fishing", { phase: "bite", catches: 0 })} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "낚싯줄 거두기" }));
  expect(act).toHaveBeenCalledWith("reel");
});
it("reports only changed anniversary values after opening existing and empty forms", () => {
  const onDirtyChange = vi.fn();
  render(
    <ClockTool
      widget={widget("clock", {
        anniversaries: [{ id: "saved", title: "기존 기념일", date: "2026-01-01", celebrate: true }],
      })}
      widgets={[]}
      act={act}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "수정 기존 기념일" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText("기념일 이름"), { target: { value: "다른 제목" } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.change(screen.getByLabelText("기념일 이름"), { target: { value: "기존 기념일" } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("switch", { name: "그날 친구가 축하하기" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("switch", { name: "그날 친구가 축하하기" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가…" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("switch", { name: "위젯에 보이기" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("switch", { name: "위젯에 보이기" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(act).not.toHaveBeenCalled();
});

it("cancels anniversary edits without reusing the old record for a new anniversary", async () => {
  render(
    <ClockTool
      widget={widget("clock", {
        format: "24h",
        anniversaries: [{ id: "old", title: "옛 기념일", date: "2026-01-01" }],
      })}
      widgets={[]}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "수정 옛 기념일" }));
  expect(screen.getByLabelText("기념일 월")).toHaveProperty("value", "1");
  expect(screen.getByLabelText("기념일 일")).toHaveProperty("value", "1");
  expect(screen.getByLabelText("기념일 반복과 연도")).toHaveProperty("value", "2026");
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(act).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/^기념일 이름\s*\*?$/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가…" }));
  expect(screen.getByLabelText(/^기념일 이름\s*\*?$/)).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText(/^기념일 이름\s*\*?$/), {
    target: { value: "새 기념일" },
  });
  fireEvent.change(screen.getByLabelText("기념일 반복과 연도"), { target: { value: "2026" } });
  fireEvent.change(screen.getByLabelText("기념일 월"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("기념일 일"), { target: { value: "25" } });
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("add", {
      title: "새 기념일",
      date: "2026-12-25",
      repeat: "none",
      countMode: "remaining",
      showOnWidget: false,
      celebrate: true,
    }),
  );
});

it("keeps an anniversary draft visible when another window deletes the record", () => {
  const { rerender } = render(
    <ClockTool
      widget={widget("clock", {
        anniversaries: [{ id: "old", title: "원래 제목", date: "2026-01-01" }],
      })}
      widgets={[]}
      compact
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "수정 원래 제목" }));
  fireEvent.change(screen.getByLabelText(/^기념일 이름\s*\*?$/), {
    target: { value: "작성 중인 제목" },
  });
  rerender(
    <ClockTool widget={widget("clock", { anniversaries: [] })} widgets={[]} compact act={act} />,
  );
  expect(screen.getByLabelText(/^기념일 이름\s*\*?$/)).toHaveProperty("value", "작성 중인 제목");
  expect(screen.getByRole("status").textContent).toContain("다른 창에서");
  expect(screen.getByRole("button", { name: "기념일 변경 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(screen.queryByLabelText(/^기념일 이름\s*\*?$/)).toBeNull();
  expect(screen.getByRole("button", { name: "기념일 추가…" })).toHaveProperty("disabled", false);
  expect(act).not.toHaveBeenCalled();
});

it("preserves edits typed while an earlier anniversary save is still pending", async () => {
  let finish: (value: boolean) => void = () => {};
  act.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  render(<ClockTool widget={widget("clock", { anniversaries: [] })} widgets={[]} act={act} />);
  expect(screen.queryByLabelText("기념일 이름")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가…" }));
  const title = screen.getByLabelText("기념일 이름");
  fireEvent.change(title, { target: { value: "먼저 저장한 제목" } });
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가" }));
  fireEvent.change(title, { target: { value: "이어서 적은 제목" } });
  fireEvent.change(screen.getByLabelText("기념일 월"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("radio", { name: "지난 날" }));
  fireEvent.click(screen.getByRole("switch", { name: "위젯에 보이기" }));
  fireEvent.click(screen.getByRole("switch", { name: "그날 친구가 축하하기" }));
  finish(true);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "기념일 추가" })).toHaveProperty("disabled", false),
  );
  expect(title).toHaveProperty("value", "이어서 적은 제목");
  expect(screen.getByLabelText("기념일 월")).toHaveProperty("value", "12");
  expect(screen.getByRole("radio", { name: "지난 날" })).toHaveProperty("checked", true);
  expect(screen.getByRole("switch", { name: "위젯에 보이기" })).toHaveProperty("checked", true);
  expect(screen.getByRole("switch", { name: "그날 친구가 축하하기" })).toHaveProperty(
    "checked",
    false,
  );
  expect(act).toHaveBeenCalledTimes(1);
});

it("keeps a saved anniversary year selectable outside the default year range", () => {
  render(
    <ClockTool
      widget={widget("clock", {
        anniversaries: [
          { id: "historic", title: "오래된 기록", date: "1800-04-05", repeat: "none" },
        ],
      })}
      widgets={[]}
      compact
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "수정 오래된 기록" }));
  expect(screen.getByLabelText("기념일 반복과 연도")).toHaveProperty("value", "1800");
  expect(act).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps native timer closing available without a full-card close control while loading=%s",
  async (loading) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: loading
        ? null
        : {
            ...PREVIEW_WIDGETS,
            widgets: [widget("focus-timer", { running: true, duration: 1500, remaining: 1500 })],
          },
      error: null,
      reload: vi.fn(),
    });
    render(<WidgetTool id="focus-timer" />);
    if (loading) {
      fireEvent.click(screen.getByRole("button", { name: "위젯 닫기" }));
      await waitFor(() =>
        expect(command).toHaveBeenCalledExactlyOnceWith("close_widget", { id: "focus-timer" }),
      );
    } else {
      expect(screen.queryByRole("button", { name: "위젯 닫기" })).toBeNull();
      const event = { preventDefault: vi.fn() };
      await reactAct(async () => native.onCloseRequested.mock.calls[0][0](event));
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
    }
  },
);

it("keeps a running countdown and memo through a pending focus resize", async () => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T10:00:00"));
  try {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: {
        ...PREVIEW_WIDGETS,
        widgets: [
          widget("focus-timer", {
            status: "running",
            durationMs: 1500000,
            remainingMs: 1500000,
            deadline: Date.now() + 1500000,
          }),
        ],
      },
      error: null,
      reload: vi.fn(),
    });
    let finish: (() => void) | undefined;
    vi.mocked(command).mockImplementation((name) =>
      name === "set_focus_expanded"
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(undefined),
    );
    render(<WidgetTool id="focus-timer" />);
    fireEvent.click(screen.getByRole("radio", { name: "노트" }));
    const memo = screen.getByLabelText("이번 집중 메모");
    fireEvent.change(memo, { target: { value: "집중 중 초안" } });
    await reactAct(async () => vi.advanceTimersByTimeAsync(550));
    const writes = vi.mocked(command).mock.calls.filter(([name]) => name === "execute_widget");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      "execute_widget",
      {
        request: expect.objectContaining({
          action: "update-memo",
          input: { memo: "집중 중 초안", expectedMemo: "" },
        }),
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "기록과 노트" }));
    await reactAct(async () => vi.advanceTimersByTime(2000));
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:58");
    expect(screen.getByRole("button", { name: "일시정지" })).toBeTruthy();
    expect(memo).toHaveProperty("value", "집중 중 초안");
    await reactAct(async () => finish?.());
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:58");
    expect(screen.getByLabelText("이번 집중 메모")).toBe(memo);
    expect(memo).toHaveProperty("value", "집중 중 초안");
    expect(vi.mocked(command).mock.calls.filter(([name]) => name === "execute_widget")).toEqual(
      writes,
    );
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("keeps focus actions in its own card and locks actions while leaving native close available", async () => {
  localStorage.clear();
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [widget("focus-timer", { status: "idle", durationMs: 1500000 })],
    },
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetTool id="focus-timer" />);
  expect(screen.queryByRole("button", { name: "위젯 닫기" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "집중 설정" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "접기" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "집중 설정" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "focus-timer" }),
  );
  expect(screen.queryByRole("dialog", { name: "집중 설정" })).toBeNull();
  expect(screen.queryByRole("button", { name: "설정 저장" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "기록과 노트" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_focus_expanded", {
      id: "focus-timer",
      expanded: false,
      collapsed: false,
      height: 464,
      animate: true,
    }),
  );
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementation((name) =>
    name === "execute_widget"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(undefined),
  );
  fireEvent.click(screen.getByRole("button", { name: "집중 시작" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: expect.objectContaining({ instanceId: "focus-timer", action: "start" }),
    }),
  );
  const controls = [
    screen.getByRole("button", { name: "집중 설정" }),
    screen.getByRole("button", { name: "기록과 노트" }),
    screen.getByRole("button", { name: "접기" }),
  ];
  for (const button of controls) expect(button.matches(":disabled")).toBe(true);
  const event = { preventDefault: vi.fn() };
  await reactAct(async () => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).not.toHaveBeenCalled();
  await reactAct(async () => finish?.());
  for (const button of controls) expect(button.matches(":disabled")).toBe(false);
});

it.each([false, true])(
  "guards a pending focus resize and restores the draft after failure with reduced motion=%s",
  async (reducedMotion) => {
    localStorage.clear();
    const matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion });
    vi.stubGlobal("matchMedia", matchMedia);
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: {
        ...PREVIEW_WIDGETS,
        widgets: [widget("focus-timer", { status: "idle", durationMs: 1500000 })],
      },
      error: null,
      reload: vi.fn(),
    });
    let fail: ((cause: Error) => void) | undefined;
    vi.mocked(command).mockImplementation((name) =>
      name === "set_focus_expanded"
        ? new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
        : Promise.resolve(undefined),
    );
    render(<WidgetTool id="focus-timer" />);
    const title = screen.getByLabelText("집중할 일");
    fireEvent.change(title, { target: { value: "작업 초안" } });
    fireEvent.click(screen.getByRole("radio", { name: "50분" }));
    fireEvent.click(screen.getByRole("radio", { name: "노트" }));
    const memo = screen.getByLabelText("이번 집중 메모");
    fireEvent.change(memo, { target: { value: "남겨 둔 생각" } });
    const timer = screen.getByLabelText("남은 시간");
    const root = screen.getByLabelText("집중 타이머");
    const panel = screen.getByLabelText("일정과 집중 기록");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 432, 600));
    const toggle = screen.getByRole("button", { name: "기록과 노트" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(command).toHaveBeenCalledExactlyOnceWith("set_focus_expanded", {
      id: "focus-timer",
      expanded: false,
      collapsed: false,
      height: 464,
      animate: !reducedMotion,
    });
    expect(screen.getByRole("button", { name: "기록과 노트" })).toHaveProperty("disabled", true);
    expect(root.getAttribute("data-window-resizing")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.style.width).toBe("");
    expect(title).toHaveProperty("value", "작업 초안");
    expect(memo).toHaveProperty("value", "남겨 둔 생각");
    expect(timer.textContent).toBe("50:00");

    await reactAct(async () => fail?.(new Error("창 크기 변경 실패")));
    expect(screen.getByText("창 크기 변경 실패").getAttribute("role")).toBe("alert");
    expect(screen.getByRole("button", { name: "기록과 노트" })).toHaveProperty("disabled", false);
    expect(root.getAttribute("data-window-resizing")).toBe("false");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.style.width).toBe("");
    expect(screen.getByLabelText("집중할 일")).toBe(title);
    expect(screen.getByLabelText("이번 집중 메모")).toBe(memo);
    expect(title).toHaveProperty("value", "작업 초안");
    expect(memo).toHaveProperty("value", "남겨 둔 생각");
    expect(screen.getByLabelText("남은 시간")).toBe(timer);
    expect(timer.textContent).toBe("50:00");
  },
);

it("replaces loading with a retry action after a widget snapshot failure", () => {
  const reload = vi.fn();
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: null, reload });
  const view = render(<WidgetTool id="memo" />);
  expect(screen.getByRole("status")).toHaveProperty("textContent", "도구를 불러오고 있어요.");
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: "조회 실패", reload });
  view.rerender(<WidgetTool id="memo" />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert")).toHaveProperty("textContent", "조회 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

it("keeps a tool usable when reactions are off and reports an absent tool", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [{ ...widget("memo", {}), reaction: false }] },
    error: null,
    reload: vi.fn(),
  });
  const view = render(<WidgetTool id="memo" />);
  expect(screen.queryByText("도구를 찾을 수 없어요.")).toBeNull();
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: PREVIEW_WIDGETS,
    error: null,
    reload: vi.fn(),
  });
  view.rerender(<WidgetTool id="memo" />);
  expect(screen.getByText("도구를 찾을 수 없어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "위젯 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widget", { id: "memo" }));
});
it("offers every friend on the desktop as an interaction target and names the person", () => {
  const third = {
    ...PREVIEW_SNAPSHOT.characters.installed[0],
    id: "third-friend",
    definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "셋째" },
  };
  const characters = {
    installed: [...PREVIEW_SNAPSHOT.characters.installed, third],
    active: [...PREVIEW_SNAPSHOT.characters.active, third.id],
  };
  render(
    <ToyTool
      widget={widget("interaction", { snacks: 6, touches: 0 })}
      act={act}
      characters={characters}
    />,
  );
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.getByRole("option", { name: "C · 셋째" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "함께할 캐릭터" }), {
    target: { value: "C" },
  });
  fireEvent.click(screen.getByRole("button", { name: "쓰다듬기" }));
  expect(act).toHaveBeenLastCalledWith("stroke", { character: "C", owner: "third-friend" });
});
it("shows only the one friend living on the desktop as an interaction target", () => {
  render(
    <ToyTool
      widget={widget("interaction", { snacks: 6, touches: 0 })}
      act={act}
      characters={{
        ...PREVIEW_SNAPSHOT.characters,
        active: PREVIEW_SNAPSHOT.characters.active.slice(0, 1),
      }}
    />,
  );
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "콕 찌르기" }));
  expect(act).toHaveBeenLastCalledWith("poke", {
    character: "A",
    owner: PREVIEW_SNAPSHOT.characters.active[0],
  });
});
it("has no collection renderer for a retired widget", () => {
  render(<ToyTool widget={widget("collection", { items: [], decorations: [] })} act={act} />);
  expect(screen.queryByRole("group", { name: "수집품 배치" })).toBeNull();
  expect(screen.getByText("지원하는 놀이를 선택해 주세요.")).toBeTruthy();
});
