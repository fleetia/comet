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
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import { PREVIEW_SNAPSHOT, command } from "../../hooks/useSnapshot";
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
it.each(["completion-jar", "device", "guessing", "fishing", "plant", "pet"])(
  "does not reopen the retired %s tool from a stale snapshot",
  (kind) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: { ...PREVIEW_WIDGETS, widgets: [widget(kind, { answer: 2 })] },
      error: null,
      reload: vi.fn(),
    });
    render(<WidgetTool id={kind} />);
    expect(screen.getByText(/설치되지 않았거나 제거한 도구/)).toBeTruthy();
    expect(screen.queryByText(/정답.*2/)).toBeNull();
    expect(command).not.toHaveBeenCalled();
  },
);

it.each(["weather", "music", "preparation"])(
  "opens the existing settings flow from the %s tool",
  async (kind) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: { ...PREVIEW_WIDGETS, widgets: [widget(kind, { configured: false })] },
      error: null,
      reload: vi.fn(),
    });
    render(<WidgetTool id={kind} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "preparation" ? "캘린더 연결 설정" : "위젯 설정 열기",
      }),
    );
    await waitFor(() => {
      if (kind === "preparation") {
        expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "calendar" });
      } else {
        expect(command).toHaveBeenCalledWith("open_widgets");
      }
    });
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
  expect(act).toHaveBeenCalledWith("rest");
  fireEvent.click(screen.getByRole("button", { name: "읽기 완료하기" }));
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
it("uses the actual fishing phase when rendering legacy fishing", () => {
  render(<ToyTool widget={widget("fishing", { phase: "bite", catches: 0 })} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "낚싯줄 거두기" }));
  expect(act).toHaveBeenCalledWith("reel");
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
