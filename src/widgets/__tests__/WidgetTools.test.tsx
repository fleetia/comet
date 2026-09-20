import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WidgetTool } from "../WidgetTool/WidgetTool";
import { TodoTool } from "../TodoTool/TodoTool";
import { ClockTool, TimerTool } from "../PlanningTools/PlanningTools";
import { ToyTool } from "../ToyTools/ToyTools";
import { JournalTool } from "../JournalTool/JournalTool";
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import { command } from "../../hooks/useSnapshot";
import type { WidgetValue, WidgetView } from "../types";
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
    installed: true,
    enabled: true,
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
  act.mockReset();
  act.mockResolvedValue(true);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("executes one explicit intent with the observed revision and never exposes a guessing answer", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [
        widget("guessing", {
          mode: "cups",
          answer: 2,
          playing: true,
          hint: "골라 보세요",
          attempts: 0,
        }),
      ],
    },
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetTool id="guessing" />);
  expect(screen.queryByText(/정답.*2/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "1번 컵" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: {
        requestId: expect.any(String),
        instanceId: "guessing",
        expectedRevision: 8,
        action: "guess",
        input: { value: 1 },
      },
    }),
  );
});
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
  expect(act).toHaveBeenCalledWith("rest");
  fireEvent.click(screen.getByRole("button", { name: "읽기 완료하기" }));
  expect(act).toHaveBeenCalledWith("complete", { id: "task" }, todo);
});
it.each(["ball", "paper-plane", "bubbles", "pet"])(
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
    expect(open.closest("footer")).not.toBeNull();
    fireEvent.click(open);
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: expect.objectContaining({
        instanceId: kind,
        expectedRevision: 8,
        action: "desktop-open",
      }),
    });
    expect(open).toHaveProperty("disabled", true);
    expect(clear).toHaveProperty("disabled", true);
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
it("locks collection footer cleanup and item actions together while clearing", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [
        widget("collection", {
          items: [{ itemId: "sock", name: "양말", quantity: 1 }],
          decorations: [],
        }),
      ],
    },
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
  render(<WidgetTool id="collection" />);
  const clear = screen.getByRole("button", { name: "소품 모두 넣기" });
  expect(clear.closest("footer")).not.toBeNull();
  fireEvent.click(clear);
  expect(clear).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "꺼내 놓기" }).matches(":disabled")).toBe(true);
  expect(command).toHaveBeenCalledWith("execute_widget", {
    request: expect.objectContaining({
      instanceId: "collection",
      expectedRevision: 8,
      action: "clear",
    }),
  });
  await reactAct(async () => finish?.());
  expect(clear).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "꺼내 놓기" }).matches(":disabled")).toBe(false);
});
it("uses actual fishing phases and acquired inventory limits", () => {
  const rendered = render(
    <ToyTool widget={widget("fishing", { phase: "bite", catches: 0 })} act={act} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "낚싯줄 거두기" }));
  expect(act).toHaveBeenCalledWith("reel");
  rendered.rerender(
    <ToyTool
      widget={widget("collection", {
        items: [{ itemId: "sock", name: "양말", quantity: 1 }],
        decorations: [{ id: 1, itemId: "sock", x: 50, y: 50 }],
      })}
      act={act}
    />,
  );
  expect(screen.getByRole("button", { name: "꺼내 놓기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "양말 소품 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "선택한 소품 가운데로" }));
  expect(act).toHaveBeenCalledWith("move", { id: 1, x: 50, y: 50 });
});
it("paginates real journal events using the last received sequence", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce([
      [25, { id: "one", text: "물고기 획득", createdAt: 100, widgetKind: "fishing" }],
    ])
    .mockResolvedValueOnce([]);
  render(<JournalTool widget={widget("journal", {})} />);
  await screen.findByText("물고기 획득");
  fireEvent.click(screen.getByRole("button", { name: "이전 사건 더 보기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_journal", { before: 25 }));
});

it("restores the active guessing mode when reopening a number game", () => {
  render(
    <ToyTool
      widget={widget("guessing", {
        mode: "number",
        playing: true,
        hint: "더 큰 숫자예요.",
        attempts: 2,
      })}
      act={act}
    />,
  );
  expect(screen.getByLabelText("놀이")).toHaveProperty("value", "number");
  const guess = screen.getByRole("spinbutton", { name: "예상 숫자" });
  expect(guess).toHaveProperty("required", true);
  fireEvent.change(guess, { target: { value: "" } });
  expect(guess).toHaveProperty("validity.valueMissing", true);
  expect(screen.queryByRole("button", { name: "1번 컵" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  expect(screen.getByLabelText(/^기념일 날짜\s*\*?$/)).toHaveProperty("value", "2026-01-01");
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(act).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^기념일 이름\s*\*?$/)).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText(/^기념일 이름\s*\*?$/), {
    target: { value: "새 기념일" },
  });
  fireEvent.change(screen.getByLabelText(/^기념일 날짜\s*\*?$/), {
    target: { value: "2026-12-25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "기념일 추가" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("add", { title: "새 기념일", date: "2026-12-25" }),
  );
});

it.each([false, true])(
  "closes a timer window without disabling its timer while loading=%s",
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
    fireEvent.click(screen.getByRole("button", { name: "위젯 닫기" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledExactlyOnceWith("close_widget", { id: "focus-timer" }),
    );
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

it("directs unavailable tools to the body menu and closes without disabling the widget", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [{ ...widget("memo", {}), enabled: false }] },
    error: null,
    reload: vi.fn(),
  });
  const view = render(<WidgetTool id="memo" />);
  expect(screen.getByText("꺼진 도구입니다. 본체 메뉴의 위젯 관리에서 켜 주세요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "위젯 관리" })).toBeNull();
  expect(screen.queryByRole("button", { name: "+ 새 메모" })).toBeNull();
  expect(screen.queryByText("생활 도구")).toBeNull();
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: PREVIEW_WIDGETS,
    error: null,
    reload: vi.fn(),
  });
  view.rerender(<WidgetTool id="memo" />);
  expect(
    screen.getByText(
      "설치되지 않았거나 제거한 도구입니다. 본체 메뉴의 위젯 관리에서 설치해 주세요.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "위젯 관리" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "위젯 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widget", { id: "memo" }));
  expect(vi.mocked(command).mock.calls).toEqual([["close_widget", { id: "memo" }]]);
});
