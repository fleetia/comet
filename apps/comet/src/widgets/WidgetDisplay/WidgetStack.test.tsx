import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emit, listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetStack } from "./WidgetStack";
import type { DesktopState } from "./desktopState";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(() => undefined),
  }),
}));

function widget(id: string, kind: string, enabled = true): WidgetView {
  return {
    id,
    kind,
    enabled,
    installed: true,
    revision: 3,
    version: 1,
    missing: [],
    packageBytes: 0,
    error: null,
    status: "enabled",
    data:
      kind === "weather"
        ? { status: "ready", observation: { name: "서울", temperature: 21, weatherCode: 0 } }
        : kind === "memo"
          ? { notes: [{ id: "note-1", title: "장보기", body: "우유", isOpen: true }] }
          : {},
  };
}
function setWidgets(widgets: WidgetView[]): void {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { catalog: [], widgets, onboardingDone: true },
    error: null,
    reload: vi.fn(),
  });
}
function listener<T>(name: string): (payload: T) => Promise<void> {
  const handler = vi.mocked(listen).mock.calls.find(([event]) => event === name)![1];
  return async (payload) => act(async () => handler({ event: name, id: 1, payload }));
}

let state: DesktopState;
beforeEach(() => {
  state = {
    revision: 5,
    editing: false,
    mode: "stack",
    order: ["clock", "weather", "disabled", "removed"],
    anchor: "top-right",
    width: "normal",
    overlapped: false,
    oneExpanded: true,
    pinned: [],
    positions: {},
    shapes: {},
    snapToGrid: false,
    showGuides: true,
  };
  vi.mocked(command).mockReset();
  vi.mocked(emit).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => undefined);
  let revision = 5;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_widget_desktop"
      ? state
      : name.endsWith("_widget_desktop") || name.includes("_widget_desktop_")
        ? { ...state, revision: ++revision }
        : undefined,
  );
  setWidgets([
    widget("clock", "clock"),
    widget("weather", "weather"),
    widget("disabled", "memo", false),
  ]);
});
afterEach(cleanup);

it("expands rows in place, opens tools only from the explicit open button, and keeps weather settings", async () => {
  setWidgets([widget("clock", "clock"), widget("weather", "weather"), widget("memo", "memo")]);
  state.order = ["clock", "weather", "memo"];
  render(<WidgetStack />);
  await screen.findByText("21°C");
  expect(screen.queryByRole("button", { name: /바탕화면에서 빼기/ })).toBeNull();
  expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);

  fireEvent.click(screen.getByText("장보기").closest("button")!);
  expect(command).not.toHaveBeenCalledWith("open_memo_note", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "메모 열기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_memo_note", { id: "memo", noteId: "note-1" }),
  );

  fireEvent.click(screen.getByText("21°C").closest("button")!);
  fireEvent.click(screen.getByRole("switch", { name: "날씨 늘 펼쳐 두기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ pinned: ["weather"], order: ["clock", "weather", "memo"] }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "날씨 설정" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "weather" }),
  );
  expect(command).not.toHaveBeenCalledWith("open_widget", expect.anything());
});

it("shows in-place edit affordances only while the desktop is being edited", async () => {
  render(<WidgetStack />);
  await screen.findByText("21°C");
  expect(screen.queryByRole("button", { name: /바탕화면에서 빼기/ })).toBeNull();
  state.editing = true;
  await listener<boolean>("widget-desktop-editing")(true);

  for (const absent of ["자유 배치", "완료", "위젯 추가"])
    expect(screen.queryByRole("button", { name: absent })).toBeNull();
  const clockRow = document.querySelector<HTMLElement>('[data-desktop-widget="clock"]')!;
  fireEvent.click(within(clockRow).getAllByRole("button")[0]);
  expect(emit).toHaveBeenCalledWith("widget-desktop-selection", "clock");
  expect(within(clockRow).getAllByRole("button")[0].getAttribute("aria-pressed")).toBe("true");

  fireEvent.keyDown(clockRow, { key: "ArrowDown", altKey: true });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ order: ["weather", "clock", "disabled", "removed"] }),
    }),
  );
  expect(within(clockRow).queryByRole("switch")).toBeNull();
  fireEvent.click(within(clockRow).getByRole("button", { name: /바탕화면에서 빼기/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_widget_desktop_item", { id: "clock" }),
  );
  expect(emit).toHaveBeenLastCalledWith("widget-desktop-selection", null);
});

function expandRows(): void {
  for (const id of ["clock", "weather"])
    fireEvent.click(
      within(document.querySelector<HTMLElement>(`[data-desktop-widget="${id}"]`)!).getAllByRole(
        "button",
      )[0],
    );
}

it("serializes layout saves so each configure sends the newest revision", async () => {
  state.oneExpanded = false;
  let release!: () => void;
  const first = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return state;
    if (name !== "configure_widget_desktop") return undefined;
    const revision = (args as { expectedRevision: number }).expectedRevision;
    if (revision === 5) await first;
    return { ...state, revision: revision + 1 };
  });
  render(<WidgetStack />);
  await screen.findByText("21°C");
  expandRows();
  const switches = screen.getAllByRole("switch");
  fireEvent.click(switches[0]);
  fireEvent.click(switches[1]);
  await act(async () => release());
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "configure_widget_desktop"),
    ).toEqual([
      ["configure_widget_desktop", expect.objectContaining({ expectedRevision: 5 })],
      ["configure_widget_desktop", expect.objectContaining({ expectedRevision: 6 })],
    ]),
  );
});

it("retries a stale configure once on the latest revision from another window", async () => {
  state.oneExpanded = false;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return state;
    if (name !== "configure_widget_desktop") return undefined;
    if ((args as { expectedRevision: number }).expectedRevision === 5) {
      state = { ...state, revision: 8, width: "wide" };
      throw new Error("다른 화면에서 배치를 바꿨어요.");
    }
    return { ...state, revision: 9 };
  });
  render(<WidgetStack />);
  await screen.findByText("21°C");
  expandRows();
  fireEvent.click(screen.getAllByRole("switch")[0]);
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("configure_widget_desktop", {
      expectedRevision: 8,
      input: expect.objectContaining({ pinned: ["clock"], width: "wide" }),
    }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("sizes the stack window to its measured content", async () => {
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ width: 394.2, height: 210.5 } as DOMRect);
  render(<WidgetStack />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("fit_widget_stack", { width: 395, height: 211 }),
  );
  expect(command).not.toHaveBeenCalledWith("open_widget_stack", expect.anything());
  rect.mockRestore();
});

it("folds into the live capsule and restores it after an inline focus card closes", async () => {
  state.order = ["clock", "focus", "disabled"];
  state.overlapped = true;
  setWidgets([
    widget("clock", "clock"),
    {
      ...widget("focus", "focus-timer"),
      data: { status: "idle", remainingMs: 1500000, settings: { restDurationMs: 300000 } },
    },
    widget("disabled", "weather", false),
  ]);
  render(<WidgetStack />);
  const capsule = within(await screen.findByRole("group", { name: "접어 둔 위젯" }));
  expect(capsule.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(capsule.getByRole("button", { name: /집중/ }));
  expect(screen.queryByRole("group", { name: "접어 둔 위젯" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "접기" }));
  expect(await screen.findByRole("group", { name: "접어 둔 위젯" })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("open_widget", { id: "focus" });
});

it("enters desktop editing from the stack toolbar", async () => {
  render(<WidgetStack />);
  await screen.findByText("21°C");
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 위젯 편집" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: true }),
  );
});

it("routes the embedded timer lifecycle to its current widget revision", async () => {
  localStorage.clear();
  let timer = {
    ...widget("focus", "focus-timer"),
    data: { status: "idle", mode: "focus", durationMs: 60000, remainingMs: 60000 },
  } as WidgetView;
  state.order = [timer.id];
  setWidgets([timer]);
  const view = render(<WidgetStack />);
  await screen.findByText("01:00");
  fireEvent.click(document.querySelector('[data-desktop-widget="focus"] button')!);
  fireEvent.change(screen.getByLabelText("집중할 일"), { target: { value: "스택 집중" } });
  for (const [label, actionName, status] of [
    ["집중 시작", "start", "running"],
    ["일시정지", "pause", "paused"],
    ["다시 시작", "resume", "running"],
    ["그만하기", "cancel", "idle"],
  ]) {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
    expect(command).toHaveBeenLastCalledWith("execute_widget", {
      request: {
        requestId: expect.any(String),
        instanceId: timer.id,
        expectedRevision: timer.revision,
        action: actionName,
        input:
          actionName === "start" ? { durationMs: 60000, todoId: null, title: "스택 집중" } : {},
      },
    });
    timer = {
      ...timer,
      revision: timer.revision + 1,
      data: {
        ...(timer.data as object),
        status,
        title: "스택 집중",
        deadline: status === "running" ? Date.now() + 60000 : null,
      },
    };
    setWidgets([timer]);
    view.rerender(<WidgetStack />);
  }
  expect(screen.getByRole("button", { name: "집중 시작" })).toBeTruthy();
});

it("binds embedded configure to the timer and preserves explicit linked todo targets", async () => {
  localStorage.clear();
  const timer = {
    ...widget("focus", "focus-timer"),
    data: {
      status: "idle",
      mode: "focus",
      durationMs: 60000,
      remainingMs: 60000,
    },
  };
  const calendar = {
    ...widget("calendar", "calendar"),
    data: {
      events: [
        {
          id: "event",
          title: "원고 쓰기",
          startAt: Date.now() + 60000,
          endAt: Date.now() + 31 * 60000,
          allDay: false,
          cancelled: false,
          connectionId: "local",
          sourceId: "local",
          occurrenceId: "event",
        },
      ],
      connections: [],
    },
  };
  const todo = {
    ...widget("todo", "todo"),
    revision: 9,
    data: {
      items: [{ id: "task", title: "원고 마무리", completedAt: null }],
    },
  };
  state.order = [timer.id];
  setWidgets([timer, calendar, todo]);
  const view = render(<WidgetStack />);
  await screen.findByText("01:00");
  fireEvent.click(document.querySelector('[data-desktop-widget="focus"] button')!);
  fireEvent.click(screen.getByRole("button", { name: "캘린더 일정 연결" }));
  fireEvent.click(screen.getByRole("button", { name: "원고 쓰기 일정 상세" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "이 일정으로 집중 준비" })),
  );
  expect(command).toHaveBeenCalledWith("execute_widget", {
    request: expect.objectContaining({
      instanceId: timer.id,
      expectedRevision: timer.revision,
      action: "configure",
      input: expect.objectContaining({ title: "원고 쓰기", durationMs: 1800000 }),
    }),
  });
  expect(screen.getByLabelText("집중할 일")).toHaveProperty("value", "원고 쓰기");
  setWidgets([
    {
      ...timer,
      revision: 4,
      data: {
        status: "finished",
        mode: "focus",
        todoId: "task",
        durationMs: 60000,
        remainingMs: 0,
      },
    },
    calendar,
    todo,
  ]);
  view.rerender(<WidgetStack />);
  await act(async () =>
    fireEvent.click(screen.getByRole("checkbox", { name: "원고 마무리 완료로 표시" })),
  );
  expect(command).toHaveBeenLastCalledWith("execute_widget", {
    request: expect.objectContaining({
      instanceId: todo.id,
      expectedRevision: 9,
      action: "complete",
      input: { id: "task" },
    }),
  });
});

it("surfaces rejected embedded timer commands without losing its input", async () => {
  localStorage.clear();
  state.order = ["focus"];
  setWidgets([
    {
      ...widget("focus", "focus-timer"),
      data: { status: "idle", durationMs: 60000, remainingMs: 60000 },
    },
  ]);
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "execute_widget") throw new Error("다른 화면에서 타이머가 바뀌었어요.");
  });
  render(<WidgetStack />);
  await screen.findByText("01:00");
  fireEvent.click(document.querySelector('[data-desktop-widget="focus"] button')!);
  fireEvent.change(screen.getByLabelText("집중할 일"), { target: { value: "남겨둘 초안" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "집중 시작" })));
  expect(screen.getByRole("alert").textContent).toContain("다른 화면에서 타이머가 바뀌었어요.");
  expect(screen.getByLabelText("집중할 일")).toHaveProperty("value", "남겨둘 초안");
});
