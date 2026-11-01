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

function widget(id: string, kind: string, reaction = true): WidgetView {
  return {
    id,
    kind,
    reaction,
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
const CATALOG = Object.entries({
  clock: "시계",
  weather: "날씨",
  memo: "메모",
  "focus-timer": "집중 타이머",
}).map(([id, name]) => ({
  id,
  name,
  description: "",
  category: "",
  version: 1,
  required: [],
  connection: null,
}));
function setWidgets(widgets: WidgetView[]): void {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { catalog: CATALOG, widgets, onboardingDone: true },
    error: null,
    reload: vi.fn(),
  });
}
function listener<T>(name: string): (payload: T) => Promise<void> {
  const handler = vi.mocked(listen).mock.calls.find(([event]) => event === name)![1];
  return async (payload) => act(async () => handler({ event: name, id: 1, payload }));
}

let state: DesktopState;
let pendingReveal: [number, string] | null;
beforeEach(() => {
  pendingReveal = null;
  state = {
    revision: 5,
    editing: false,
    mode: "stack",
    order: ["clock", "weather", "disabled", "removed"],
    anchor: "top-right",
    width: 370,
    overlapped: false,
    oneExpanded: true,
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
      : name === "take_widget_stack_reveal"
        ? (() => { const value = pendingReveal; pendingReveal = null; return value; })()
      : name === "get_widgets"
        ? vi.mocked(useWidgets).mock.results.at(-1)?.value.snapshot
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

it("expands rows in place and moves settings and open actions to the hover toolbar", async () => {
  setWidgets([widget("clock", "clock"), widget("weather", "weather"), widget("memo", "memo")]);
  state.order = ["clock", "weather", "memo"];
  render(<WidgetStack />);
  await screen.findByText("21°C");
  expect(screen.queryByRole("button", { name: /바탕화면에서 빼기/ })).toBeNull();
  expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
  expect(screen.queryByRole("switch")).toBeNull();
  // Collapsed rows offer only the reorder handle.
  expect(screen.queryByRole("button", { name: "메모 열기" })).toBeNull();
  expect(screen.getByRole("button", { name: "메모 순서 바꾸기" })).toBeTruthy();

  fireEvent.click(screen.getByText("장보기").closest("button")!);
  expect(command).not.toHaveBeenCalledWith("open_memo_note", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "메모 열기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_memo_note", { id: "memo", noteId: "note-1" }),
  );

  fireEvent.click(screen.getByText("21°C").closest("button")!);
  expect(screen.queryByRole("button", { name: "메모 열기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "날씨 설정" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "weather" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "날씨 접기" }));
  expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
  expect(command).not.toHaveBeenCalledWith("open_widget", expect.anything());
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "configure_widget_desktop"),
    ).toHaveLength(3),
  );
  const configureCalls = vi
    .mocked(command)
    .mock.calls.filter(([name]) => name === "configure_widget_desktop");
  expect(configureCalls.map(([, args]) => args?.input)).toEqual(
    [["memo"], ["weather"], []].map((expanded) => ({
      mode: state.mode,
      order: state.order,
      anchor: state.anchor,
      width: state.width,
      overlapped: state.overlapped,
      oneExpanded: state.oneExpanded,
      snapToGrid: state.snapToGrid,
      showGuides: state.showGuides,
      expanded,
    })),
  );
});

it("restores saved expanded rows when the stack window opens", async () => {
  Object.assign(state, { expanded: ["weather"] });
  render(<WidgetStack />);
  await screen.findByRole("button", { name: "날씨 접기" });
  expect(screen.getByRole("button", { name: "날씨 접기" })).toBeTruthy();
});

it("reveals the requested row or its capsule bubble", async () => {
  state.order = ["clock", "weather"];
  const view = render(<WidgetStack />);
  await screen.findByText("21°C");
  await waitFor(() =>
    expect(listen).toHaveBeenCalledWith("widget-stack-reveal", expect.any(Function)),
  );
  pendingReveal = [1, "weather"];
  await listener<string>("widget-stack-reveal")("weather");
  expect(screen.getByRole("button", { name: "날씨 접기" })).toBeTruthy();
  view.unmount();
  vi.mocked(listen).mockClear();
  state.overlapped = true;
  render(<WidgetStack />);
  await screen.findByRole("button", { name: /21°C/ });
  await waitFor(() =>
    expect(listen).toHaveBeenCalledWith("widget-stack-reveal", expect.any(Function)),
  );
  pendingReveal = [2, "weather"];
  await listener<string>("widget-stack-reveal")("weather");
  expect(screen.getByRole("dialog", { name: "날씨" })).toBeTruthy();
});

it("retains a reveal event received before the desktop layout loads", async () => {
  state.order = ["weather"];
  let finish: ((value: DesktopState) => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return new Promise<DesktopState>((resolve) => { finish = resolve; });
    if (name === "configure_widget_desktop") return state;
    if (name === "take_widget_stack_reveal") {
      const value = pendingReveal;
      pendingReveal = null;
      return value;
    }
  });
  pendingReveal = [1, "weather"];
  render(<WidgetStack />);
  await waitFor(() => expect(listen).toHaveBeenCalledWith("widget-stack-reveal", expect.any(Function)));
  await waitFor(() => expect(command).toHaveBeenCalledWith("take_widget_stack_reveal"));
  await act(async () => finish?.(state));
  expect(await screen.findByRole("button", { name: "날씨 접기" })).toBeTruthy();
  expect(vi.mocked(listen).mock.calls.filter(([name]) => name === "widget-stack-reveal")).toHaveLength(1);
});

it("ignores an older consumed reveal that returns after a newer request", async () => {
  state.order = ["clock", "weather"];
  let finishOld: ((value: [number, string]) => void) | undefined;
  let takes = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "configure_widget_desktop") return state;
    if (name === "take_widget_stack_reveal") {
      takes += 1;
      if (takes === 1) return new Promise<[number, string]>((resolve) => { finishOld = resolve; });
      return [2, "clock"];
    }
  });
  render(<WidgetStack />);
  await waitFor(() => expect(takes).toBe(1));
  await listener<string>("widget-stack-reveal")("clock");
  await screen.findByRole("button", { name: "시계 접기" });
  await act(async () => finishOld?.([1, "weather"]));
  expect(screen.getByRole("button", { name: "시계 접기" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "날씨 접기" })).toBeNull();
});

it("locks a timer action while it is pending in the capsule bubble", async () => {
  const timer = {
    ...widget("focus", "focus-timer"),
    data: { status: "idle", durationMs: 60000, remainingMs: 60000 },
  };
  state.order = ["focus"];
  state.overlapped = true;
  setWidgets([timer]);
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "execute_widget")
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    if (name === "get_widgets")
      return { catalog: CATALOG, widgets: [{ ...timer, revision: 4 }], onboardingDone: true };
  });
  render(<WidgetStack />);
  fireEvent.click(await screen.findByRole("button", { name: /집중 준비/ }));
  const start = screen.getByRole("button", { name: "집중 시작" });
  fireEvent.click(start);
  fireEvent.click(start);
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "execute_widget"),
    ).toHaveLength(1),
  );
  expect(start).toHaveProperty("disabled", true);
  await act(async () => finish?.());
});

it("serializes different envelope checks using the revision returned after the first action", async () => {
  const preparation = {
    ...widget("preparation", "preparation"),
    data: {
      envelopes: [
        {
          id: "env",
          title: "여행",
          checks: [
            { id: "a", text: "여권", done: false },
            { id: "b", text: "표", done: false },
          ],
        },
      ],
    },
  };
  state.order = [preparation.id];
  setWidgets([preparation]);
  let finish: (() => void) | undefined;
  let requests = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "execute_widget" && ++requests === 1)
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    if (name === "get_widgets")
      return { catalog: CATALOG, widgets: [{ ...preparation, revision: 4 }], onboardingDone: true };
  });
  render(<WidgetStack />);
  fireEvent.click((await screen.findByText("여행")).closest("button")!);
  fireEvent.click(screen.getByRole("checkbox", { name: "여권" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "표" }));
  await waitFor(() => expect(requests).toBe(1));
  await act(async () => finish?.());
  await waitFor(() => expect(requests).toBe(2));
  const calls = vi.mocked(command).mock.calls.filter(([name]) => name === "execute_widget");
  expect(
    calls.map(([, args]) => (args?.request as { expectedRevision: number } | undefined)?.expectedRevision),
  ).toEqual([3, 4]);
});

it("saves an expanded row in the desktop layout", async () => {
  render(<WidgetStack />);
  await screen.findByText("21°C");
  fireEvent.click(screen.getByText("21°C").closest("button")!);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ expanded: ["weather"] }),
    }),
  );
});

it("reorders stack rows from the hover handle by dragging or arrow keys", async () => {
  render(<WidgetStack />);
  await screen.findByText("21°C");
  const transfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(screen.getByRole("button", { name: "날씨 순서 바꾸기" }), {
    dataTransfer: transfer,
  });
  fireEvent.dragOver(document.querySelector('[data-desktop-widget="clock"]')!);
  fireEvent.drop(document.querySelector('[data-desktop-widget="clock"]')!);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ order: ["weather", "clock", "disabled", "removed"] }),
    }),
  );
  expect(transfer.setDragImage).toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button", { name: "시계 순서 바꾸기" }), { key: "ArrowDown" });
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "configure_widget_desktop"),
    ).toHaveLength(2),
  );
});

it("does not save or announce keyboard moves beyond either end of the order", async () => {
  state.order = ["clock", "weather"];
  render(<WidgetStack />);
  await screen.findByText("21°C");
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "시계 순서 바꾸기" }), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("button", { name: "날씨 순서 바꾸기" }), { key: "ArrowDown" });
  });
  expect(command).not.toHaveBeenCalledWith("configure_widget_desktop", expect.anything());
  expect(screen.queryByText(/순서 \d+번째/)).toBeNull();
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

function moveDown(label: string): void {
  fireEvent.keyDown(screen.getByRole("button", { name: `${label} 순서 바꾸기` }), {
    key: "ArrowDown",
  });
}

it("keeps remove buttons focusable during queued moves and ignores removal while busy", async () => {
  state.editing = true;
  state.order = ["clock", "weather", "memo"];
  setWidgets([widget("clock", "clock"), widget("weather", "weather"), widget("memo", "memo")]);
  let release!: () => void;
  const first = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return state;
    if (name !== "configure_widget_desktop") return undefined;
    const { expectedRevision, input } = args as { expectedRevision: number; input: DesktopState };
    if (expectedRevision === 5) await first;
    return { ...state, ...input, revision: expectedRevision + 1 };
  });
  render(<WidgetStack />);
  const clockRemove = await screen.findByRole("button", { name: "시계 바탕화면에서 빼기" });
  clockRemove.focus();
  fireEvent.keyDown(clockRemove, { key: "ArrowDown", altKey: true });
  expect(clockRemove.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(clockRemove);
  fireEvent.click(clockRemove);

  const weatherRemove = screen.getByRole("button", { name: "날씨 바탕화면에서 빼기" });
  weatherRemove.focus();
  expect(document.activeElement).toBe(weatherRemove);
  fireEvent.click(weatherRemove);
  clockRemove.focus();
  fireEvent.keyDown(clockRemove, { key: "ArrowDown", altKey: true });
  expect(command).not.toHaveBeenCalledWith("remove_widget_desktop_item", expect.anything());

  await act(async () => release());
  await waitFor(() => {
    const calls = vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "configure_widget_desktop");
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(
      expect.objectContaining({
        expectedRevision: 6,
        input: expect.objectContaining({ order: ["weather", "memo", "clock"] }),
      }),
    );
  });
  expect(document.activeElement).toBe(clockRemove);
  expect(clockRemove.hasAttribute("aria-disabled")).toBe(false);
});

it("keeps a completed break labeled as finished after repeatedly unfolding and folding", async () => {
  state.order = ["focus"];
  state.overlapped = true;
  setWidgets([
    {
      ...widget("focus", "focus-timer"),
      data: {
        status: "finished",
        mode: "rest",
        durationMs: 60000,
        remainingMs: 0,
        deadline: null,
      },
    },
  ]);
  render(<WidgetStack />);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    fireEvent.click(await screen.findByRole("button", { name: "휴식 끝 00:00" }));
    expect(screen.getByText("쉬는 시간 1분이 끝났어요")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "접기" }));
  }
  expect(screen.getByRole("button", { name: "휴식 끝 00:00" })).toBeTruthy();
  expect(screen.queryByText("쉬는 중 00:00")).toBeNull();
});

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
  moveDown("시계");
  moveDown("날씨");
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
      state = { ...state, revision: 8, width: 410 };
      throw new Error("다른 화면에서 배치를 바꿨어요.");
    }
    return { ...state, revision: 9 };
  });
  render(<WidgetStack />);
  await screen.findByText("21°C");
  moveDown("시계");
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("configure_widget_desktop", {
      expectedRevision: 8,
      input: expect.objectContaining({
        order: ["weather", "clock", "disabled", "removed"],
        width: 410,
      }),
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
    expect(command).toHaveBeenCalledWith("fit_widget_stack", {
      width: 395,
      height: 211,
      lead: { x: 0, y: 0 },
    }),
  );
  expect(command).not.toHaveBeenCalledWith("open_widget_stack", expect.anything());
  rect.mockRestore();
});

it("opens a folded widget as a bubble beside the capsule bar and closes it from outside", async () => {
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
  const capsule = within(await screen.findByRole("group", { name: "접어 둔 모아두기" }));
  expect(capsule.getAllByRole("button")).toHaveLength(3);
  fireEvent.click(capsule.getByRole("button", { name: /집중/ }));
  // The capsule bar stays; only the chosen widget opens below it.
  expect(screen.getByRole("group", { name: "접어 둔 모아두기" })).toBeTruthy();
  const bubble = screen.getByRole("dialog");
  expect(bubble.getAttribute("data-placement")).toBe("below");
  expect(bubble.compareDocumentPosition(capsule.getAllByRole("button")[0])).toBe(
    Node.DOCUMENT_POSITION_PRECEDING,
  );
  expect(capsule.getByRole("button", { name: /집중/ }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(within(bubble).getByRole("button", { name: "접기" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(capsule.getAllByRole("button")[0]);
  const clock = screen.getByRole("dialog");
  expect(within(clock).getByRole("button", { name: "시계 설정" })).toBeTruthy();
  expect(within(clock).queryByRole("button", { name: /순서 바꾸기|접기/ })).toBeNull();
  fireEvent.pointerDown(clock);
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(capsule.getAllByRole("button")[0]);
  act(() => window.dispatchEvent(new Event("blur")));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(command).not.toHaveBeenCalledWith("open_widget", { id: "focus" });
});

async function openFocusBubble(): Promise<HTMLSelectElement> {
  localStorage.clear();
  state.order = ["focus"];
  state.overlapped = true;
  setWidgets([
    {
      ...widget("focus", "focus-timer"),
      data: { status: "idle", durationMs: 60000, remainingMs: 60000 },
    },
    {
      ...widget("todo", "todo"),
      data: { items: [{ id: "task", title: "원고 마무리", completedAt: null }] },
    },
  ]);
  render(<WidgetStack />);
  const capsule = within(await screen.findByRole("group", { name: "접어 둔 모아두기" }));
  fireEvent.click(capsule.getByRole("button", { name: /집중/ }));
  fireEvent.click(screen.getByText("이번 집중 연결"));
  return screen.getByLabelText("연결할 할 일") as HTMLSelectElement;
}

async function openFocusNotes(): Promise<void> {
  await openFocusBubble();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "기록과 노트" })));
  fireEvent.click(screen.getByRole("radio", { name: "노트" }));
}

it("keeps the focus bubble open when typing in its portaled note editor", async () => {
  await openFocusNotes();
  fireEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
  const editor = screen.getByRole("dialog", { name: "새 다이어리 메모" });
  const title = within(editor).getByLabelText(/노트 제목/);
  expect(editor.parentElement).toBe(document.body);
  fireEvent.pointerDown(title, { button: 0 });
  expect(screen.getByRole("dialog", { name: "새 다이어리 메모" })).toBe(editor);
  fireEvent.change(title, { target: { value: "QA packing note" } });
  expect(title).toHaveProperty("value", "QA packing note");
  const body = within(editor).getByLabelText("노트 내용");
  fireEvent.pointerDown(body, { button: 0 });
  fireEvent.change(body, { target: { value: "Pack the cable." } });
  expect(body).toHaveProperty("value", "Pack the cable.");
  const close = within(editor).getByRole("button", { name: "노트 닫기" });
  fireEvent.pointerDown(close, { button: 0 });
  fireEvent.click(close);
  expect(screen.queryByRole("dialog", { name: "새 다이어리 메모" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "집중 타이머" })).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the focus bubble open while searching its portaled note picker", async () => {
  await openFocusNotes();
  fireEvent.click(screen.getByRole("button", { name: "다른 메모 연결하기" }));
  const picker = screen.getByRole("dialog", { name: "다른 메모 연결하기" });
  const search = within(picker).getByLabelText("연결할 노트 검색");
  fireEvent.pointerDown(search, { button: 0 });
  fireEvent.change(search, { target: { value: "packing" } });
  expect(screen.getByRole("dialog", { name: "다른 메모 연결하기" })).toBe(picker);
  expect(search).toHaveProperty("value", "packing");
});

it("dismisses only the note editor on its modal backdrop and can reopen it", async () => {
  await openFocusNotes();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    fireEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
    const editor = screen.getByRole("dialog", { name: "새 다이어리 메모" });
    // Native dialog backdrops retarget their pointer/click events to the dialog.
    fireEvent.pointerDown(editor, { button: 0 });
    fireEvent.click(editor);
    expect(screen.queryByRole("dialog", { name: "새 다이어리 메모" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "집중 타이머" })).toBeTruthy();
  }
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["outside", "blur"])(
  "retains %s dismissal while the focus note editor is open",
  async (dismissal) => {
    await openFocusNotes();
    fireEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
    const title = screen.getByLabelText(/노트 제목/);
    fireEvent.pointerDown(title, { button: 0 });
    if (dismissal === "outside") fireEvent.pointerDown(document.body);
    else if (dismissal === "blur") fireEvent.blur(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("does not treat an unrelated body dialog as owned by the focus bubble", async () => {
  await openFocusBubble();
  const unrelated = document.createElement("dialog");
  unrelated.open = true;
  const input = document.createElement("input");
  unrelated.append(input);
  document.body.append(unrelated);
  try {
    fireEvent.pointerDown(input, { button: 0 });
    expect(screen.queryByRole("dialog", { name: "집중 타이머" })).toBeNull();
  } finally {
    unrelated.remove();
  }
});

// The test DOM does not open an operating-system select popup. Model only the native
// :open state; all widget rendering, task selection, and dismissal remain real.
function nativePopup(select: HTMLSelectElement): { open: boolean } {
  const popup = { open: false };
  const bubble = screen.getByRole("dialog");
  const query = bubble.querySelector.bind(bubble);
  vi.spyOn(bubble, "querySelector").mockImplementation((selector: string) =>
    selector === "select:open" ? (popup.open ? select : null) : query(selector),
  );
  return popup;
}

it("keeps the focus bubble mounted while a native task select takes focus", async () => {
  const select = await openFocusBubble();
  const popup = nativePopup(select);
  for (const value of ["task", "", "task"]) {
    select.focus();
    fireEvent.pointerDown(select, { button: 0 });
    // WebKitGTK can deliver pointerup before it transfers focus to the popup.
    fireEvent.pointerUp(select, { button: 0 });
    popup.open = true;
    fireEvent.blur(window);
    expect(screen.getByRole("dialog")).toBeTruthy();
    popup.open = false;
    fireEvent.change(select, { target: { value } });
    fireEvent.focus(window);
    expect(screen.getByLabelText("연결할 할 일")).toBe(select);
    expect(select.value).toBe(value);
  }
  // A still-focused select must not exempt a later, real window deactivation.
  fireEvent.blur(window);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([" ", "ArrowDown"])("keeps a keyboard-opened native select alive for %j", async (key) => {
  const select = await openFocusBubble();
  const popup = nativePopup(select);
  select.focus();
  fireEvent.keyDown(select, { key, altKey: key === "ArrowDown" });
  fireEvent.keyUp(select, { key });
  popup.open = true;
  fireEvent.blur(window);
  expect(screen.getByRole("dialog")).toBeTruthy();
  popup.open = false;
  fireEvent.focus(window);
  fireEvent.keyDown(select, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("does not exempt window deactivation just because a select was pressed", async () => {
  const select = await openFocusBubble();
  nativePopup(select);
  select.focus();
  fireEvent.pointerDown(select, { button: 0 });
  fireEvent.pointerUp(select, { button: 0 });
  fireEvent.blur(window);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each(["outside", "Escape"])(
  "keeps %s dismissal while a native select is open",
  async (dismissal) => {
    const select = await openFocusBubble();
    nativePopup(select).open = true;
    fireEvent.blur(window);
    expect(screen.getByRole("dialog")).toBeTruthy();
    if (dismissal === "outside") fireEvent.pointerDown(document.body);
    else fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("retains blur dismissal when a WebView does not recognize the open selector", async () => {
  await openFocusBubble();
  vi.spyOn(screen.getByRole("dialog"), "querySelector").mockImplementation(() => {
    throw new DOMException("Unsupported selector", "SyntaxError");
  });
  fireEvent.blur(window);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens window widgets straight from the capsule bar and bubbles above bottom anchors", async () => {
  setWidgets([widget("memo", "memo"), widget("weather", "weather")]);
  state.order = ["memo", "weather"];
  state.overlapped = true;
  state.anchor = "bottom-left";
  render(<WidgetStack />);
  const capsule = within(await screen.findByRole("group", { name: "접어 둔 모아두기" }));
  fireEvent.click(capsule.getByRole("button", { name: /장보기/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_memo_note", { id: "memo", noteId: "note-1" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(capsule.getByRole("button", { name: /21°C/ }));
  const bubble = screen.getByRole("dialog");
  expect(bubble.getAttribute("data-placement")).toBe("above");
  expect(bubble.compareDocumentPosition(capsule.getAllByRole("button")[0])).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it.each([
  { radius: 8, expectedRadius: "8px" },
  { radius: 20, expectedRadius: "9px" },
])(
  "applies stack radius $radius through theme tokens without changing saved values",
  async ({ radius, expectedRadius }) => {
    state.stackStyles = {
      weather: {
        followTheme: false,
        backgroundColor: "#223344",
        textColor: "#FFFFFF",
        opacity: 40,
        radius,
      },
      clock: {
        followTheme: true,
        backgroundColor: "#000000",
        textColor: "#000000",
        opacity: 0,
        radius: 0,
      },
    };
    render(<WidgetStack />);
    await screen.findByText("21°C");
    const weather = document.querySelector<HTMLElement>('[data-desktop-widget="weather"]')!;
    const clock = document.querySelector<HTMLElement>('[data-desktop-widget="clock"]')!;
    expect(weather.style.getPropertyValue("--comet-color-glass-panel")).toBe(
      "color-mix(in srgb, #223344 40%, transparent)",
    );
    expect(weather.style.getPropertyValue("--comet-color-ink")).toBe("#FFFFFF");
    expect(weather.style.getPropertyValue("--comet-color-ink-3")).toBe(
      "color-mix(in srgb, #FFFFFF 70%, transparent)",
    );
    expect(weather.style.getPropertyValue("--comet-stack-radius")).toBe(expectedRadius);
    expect(state.stackStyles.weather.radius).toBe(radius);
    expect(clock.style.getPropertyValue("--comet-color-glass-panel")).toBe(
      "color-mix(in srgb, var(--comet-stack-theme-fill) 0%, transparent)",
    );
    expect(clock.style.getPropertyValue("--comet-color-ink")).toBe("");
  },
);

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
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", expect.anything()),
  );
  fireEvent.change(screen.getByLabelText("집중할 일"), { target: { value: "스택 집중" } });
  for (const [label, actionName, status] of [
    ["집중 시작", "start", "running"],
    ["일시정지", "pause", "paused"],
    ["계속", "resume", "running"],
    ["그만하기", "cancel", "idle"],
  ]) {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
    expect(command).toHaveBeenCalledWith("execute_widget", {
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
  const eventStart = Date.now() + 60000;
  const calendar = {
    ...widget("calendar", "calendar"),
    data: {
      events: [
        {
          id: "event",
          title: "원고 쓰기",
          startAt: eventStart,
          endAt: eventStart + 30 * 60000,
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
  expect(command).toHaveBeenCalledWith("execute_widget", {
    request: expect.objectContaining({
      instanceId: todo.id,
      expectedRevision: 9,
      action: "complete",
      input: { id: "task" },
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "집중 타이머" }).getAttribute("data-window-resizing"),
    ).toBe("false"),
  );
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

it("moves focus into a bubble and returns it to its capsule on Escape", async () => {
  state.order = ["weather"];
  state.overlapped = true;
  render(<WidgetStack />);
  const capsule = await screen.findByRole("button", { name: /21°C/ });
  capsule.focus();
  fireEvent.click(capsule);
  const bubble = screen.getByRole("dialog", { name: "날씨" });
  expect(document.activeElement).toBe(bubble);
  expect(capsule.getAttribute("aria-haspopup")).toBe("dialog");
  expect(capsule.getAttribute("aria-pressed")).toBeNull();
  fireEvent.keyDown(bubble, { key: "Escape" });
  expect(document.activeElement).toBe(capsule);
  expect(capsule.getAttribute("aria-expanded")).toBe("false");
});

it("keeps the bubble open for composing, prevented and dialog Escape", async () => {
  await openFocusNotes();
  fireEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
  const title = screen.getByLabelText(/노트 제목/);
  fireEvent.keyDown(title, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "집중 타이머" })).toBeTruthy();
  const dialog = screen.queryByRole("dialog", { name: "새 다이어리 메모" });
  if (dialog) fireEvent.click(within(dialog).getByRole("button", { name: "노트 닫기" }));
  const bubble = screen.getByRole("dialog", { name: "집중 타이머" });
  fireEvent.keyDown(bubble, { key: "Escape", isComposing: true });
  fireEvent.keyDown(bubble, { key: "Escape", keyCode: 229 });
  const prevented = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  prevented.preventDefault();
  fireEvent(bubble, prevented);
  expect(screen.getByRole("dialog", { name: "집중 타이머" })).toBeTruthy();
});

it("returns focus to the same row after expanding and collapsing", async () => {
  render(<WidgetStack />);
  const collapsed = (await screen.findByText("21°C")).closest("button")!;
  collapsed.focus();
  fireEvent.click(collapsed);
  const expanded = screen.getByRole("button", { expanded: true });
  expect(document.activeElement).toBe(expanded);
  fireEvent.click(expanded);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /21°C/, expanded: false }),
  );
});

it("returns focus to the collapse button when expanding a configured music row", async () => {
  state.order = ["music"];
  setWidgets([
    {
      ...widget("music", "music"),
      data: { configured: true, observation: { title: "봄 노래" } },
    },
  ]);
  render(<WidgetStack />);
  const collapsed = (await screen.findByText("봄 노래")).closest("button")!;
  collapsed.focus();
  fireEvent.click(collapsed);
  const row = document.querySelector<HTMLElement>('[data-desktop-widget="music"]')!;
  const menu = within(row).getByRole("button", { name: "음악 상세 메뉴" });
  const collapse = within(row).getByRole("button", { name: "접기" });
  expect(document.activeElement).toBe(collapse);
  expect(document.activeElement).not.toBe(menu);
});

it("distinguishes a missing snapshot from an empty widget list and offers retry", async () => {
  const reload = vi.fn();
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: null, reload });
  const view = render(<WidgetStack />);
  await screen.findByText("바탕화면 위젯을 불러오고 있어요.");
  expect(screen.queryByText("바탕화면 위젯 편집에서 위젯을 꺼내 주세요.")).toBeNull();
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: "읽기 실패", reload });
  view.rerender(<WidgetStack />);
  expect(screen.getByRole("alert").textContent).toContain("읽기 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.queryByText("바탕화면 위젯 편집에서 위젯을 꺼내 주세요.")).toBeNull();
});

it("uses each completed order for rapid repeated moves", async () => {
  state.order = ["clock", "weather", "memo"];
  setWidgets([widget("clock", "clock"), widget("weather", "weather"), widget("memo", "memo")]);
  let release!: () => void;
  const first = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return state;
    if (name !== "configure_widget_desktop") return undefined;
    const input = args as { input: { order: string[] }; expectedRevision: number };
    if (input.expectedRevision === 5) await first;
    state = { ...state, ...input.input, revision: input.expectedRevision + 1 };
    return state;
  });
  render(<WidgetStack />);
  await screen.findByText("21°C");
  moveDown("시계");
  moveDown("시계");
  await act(async () => release());
  await waitFor(() => expect(state.order).toEqual(["weather", "memo", "clock"]));
  expect(screen.getByRole("status").textContent).toContain("3번째");
});

it("clears a row action error after the next successful action", async () => {
  let fail = true;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "open_planner_settings" && fail) throw new Error("열기 실패");
    if (name === "configure_widget_desktop") return { ...state, revision: 6 };
    return undefined;
  });
  render(<WidgetStack />);
  fireEvent.click((await screen.findByText("21°C")).closest("button")!);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "날씨 설정" })));
  expect(screen.getByRole("alert").textContent).toContain("열기 실패");
  fail = false;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "날씨 설정" })));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps newer style previews when an earlier save finishes", async () => {
  state.editing = true;
  const initial = {
    followTheme: false,
    backgroundColor: "#FFFFFF",
    textColor: "#000000",
    opacity: 50,
    radius: 9,
  };
  render(<WidgetStack />);
  await screen.findByText("21°C");
  const preview = listener<{
    id: string | null;
    style?: typeof initial | null;
    revision?: number;
    clear?: boolean;
  }>("widget-stack-style-preview");
  await preview({ id: "weather", style: initial, revision: 1 });
  await preview({ id: "weather", style: { ...initial, opacity: 80 }, revision: 2 });
  await preview({ id: "weather", revision: 1, clear: true });
  const row = document.querySelector<HTMLElement>('[data-desktop-widget="weather"]')!;
  expect(row.style.getPropertyValue("--comet-color-glass-panel")).toBe(
    "color-mix(in srgb, #FFFFFF 80%, transparent)",
  );
  await listener<boolean>("widget-desktop-editing")(false);
  expect(row.style.getPropertyValue("--comet-color-glass-panel")).toBe("");
});
