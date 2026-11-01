import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { emit, listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetEditor } from "./WidgetEditor";
import type { DesktopState } from "./desktopState";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn().mockResolvedValue(undefined) }),
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
    data: {},
  };
}

let state: DesktopState;
beforeEach(() => {
  state = {
    revision: 5,
    editing: true,
    mode: "stack",
    order: ["clock", "focus"],
    anchor: "top-right",
    width: 370,
    overlapped: true,
    oneExpanded: true,
    positions: { clock: { x: 10, y: 20 } },
    shapes: {},
    snapToGrid: false,
    showGuides: true,
  };
  vi.mocked(command).mockReset();
  vi.mocked(emit).mockReset().mockResolvedValue(undefined);
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => undefined);
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_widget_desktop"
      ? state
      : name === "get_widget_desktop_snapshot"
        ? { ...state, mode: "freeform", order: ["clock"] }
        : name === "configure_widget_appearance"
          ? undefined
          : { ...state, revision: state.revision + 1 },
  );
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      catalog: [
        { id: "clock", name: "시계·기념일" },
        { id: "focus-timer", name: "집중 타이머" },
        { id: "memo", name: "메모" },
        { id: "fishing", name: "낚시" },
      ].map((entry) => ({
        ...entry,
        description: "",
        category: "",
        version: 1,
        required: [],
        connection: null,
      })),
      widgets: [
        widget("clock", "clock"),
        widget("focus", "focus-timer"),
        widget("memo", "memo"),
        widget("fishing", "fishing"),
        widget("todo", "todo", false),
      ],
      onboardingDone: true,
    },
    error: null,
    reload: vi.fn(),
  });
});
afterEach(cleanup);

async function select(id: string | null): Promise<void> {
  const handler = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "widget-desktop-selection")![1];
  await act(async () => handler({ event: "widget-desktop-selection", id: 1, payload: id }));
}

it("changes layout mode and stack options live with the current revision", async () => {
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  expect(screen.getByRole("heading", { name: "바탕화면 위젯 편집" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "왼쪽 아래" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("reset_widget_desktop_position", { anchor: "bottom-left" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "자유 배치" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 6,
      input: expect.objectContaining({ mode: "freeform" }),
    }),
  );
});

it("keeps layout controls focusable and ignores input while a save is pending", async () => {
  let finish: (value: DesktopState) => void = () => undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    return new Promise<DesktopState>((resolve) => { finish = resolve; });
  });
  render(<WidgetEditor />);
  const anchor = await screen.findByRole("button", { name: "왼쪽 아래" });
  anchor.focus();
  fireEvent.click(anchor);
  await waitFor(() => expect(anchor.getAttribute("aria-disabled")).toBe("true"));
  expect(document.activeElement).toBe(anchor);
  expect(anchor).toHaveProperty("disabled", false);
  fireEvent.click(anchor);
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "reset_widget_desktop_position")).toHaveLength(1);
  await act(async () => finish({ ...state, revision: 6 }));
});

it("clears the anchor selection for a dragged stack and resets the same anchor", async () => {
  state.stackPosition = { x: 100, y: 200 };
  render(<WidgetEditor />);
  const anchor = await screen.findByRole("button", { name: "오른쪽 위" });
  await waitFor(() => expect(anchor).toHaveProperty("disabled", false));
  expect(anchor.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(anchor);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("reset_widget_desktop_position", { anchor: "top-right" }),
  );
});

it("shows freeform snapping options and lists only unplaced supported widgets to add", async () => {
  state.mode = "freeform";
  render(<WidgetEditor />);
  const snap = await screen.findByRole("checkbox", { name: "다른 위젯에 맞추기" });
  expect(screen.getByRole("checkbox", { name: "격자에 맞추기" })).toBeTruthy();
  fireEvent.click(snap);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ showGuides: false }),
    }),
  );
  const add = within(screen.getByRole("region", { name: "위젯 추가" }));
  expect(add.queryByText("낚시")).toBeNull();
  expect(add.queryByText("시계·기념일")).toBeNull();
  fireEvent.click(add.getByRole("button", { name: "메모 바탕화면에 꺼내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("add_widget_desktop_item", { id: "memo" }),
  );
});

it("selects, moves and removes a placed widget from the editor", async () => {
  state.mode = "freeform";
  render(<WidgetEditor />);
  const placed = within(await screen.findByRole("region", { name: "놓인 위젯" }));
  fireEvent.click(placed.getByRole("button", { name: "시계·기념일 선택" }));
  expect(emit).toHaveBeenCalledWith("widget-desktop-selection", "clock");
  const move = screen.getByRole("group", { name: "시계·기념일 위치 이동" });
  fireEvent.keyDown(within(move).getByRole("button", { name: "위로 이동" }), { key: "ArrowRight" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_position", { id: "clock", dx: 8, dy: 0 }));
  await screen.findByText("시계·기념일 위치를 이동했어요.");
  fireEvent.click(placed.getByRole("button", { name: "시계·기념일 바탕화면에서 빼기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("remove_widget_desktop_item", { id: "clock" }));
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-desktop-selection", null));
});

it("edits the selected widget's shape immediately without a save step", async () => {
  state.mode = "freeform";
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  const tabs = screen.getByRole("tablist", { name: "위젯 꾸미기" });
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["모양"]);
  fireEvent.click(screen.getByRole("button", { name: "좌우" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_desktop_shape", {
      id: "focus",
      shape: expect.objectContaining({ flipX: true, width: 156, height: 168 }),
    }),
  );
  expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
  expect(screen.getAllByLabelText("모양 너비")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /점 편집/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "직접 그리기" }));
  expect(screen.getAllByRole("button", { name: /점 편집/ })).toHaveLength(1);
  expect(screen.getAllByLabelText("모양 너비")).toHaveLength(1);
});

it("waits until drawing ends and keeps the draft available after a failed save", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  state.mode = "freeform";
  let attempts = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "set_widget_desktop_shape" && attempts++ === 0) throw new Error("저장 실패");
    return { ...state, revision: state.revision + 1 };
  });
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.click(screen.getByRole("radio", { name: "직접 그리기" }));
  const canvas = screen.getByRole("img", { name: "모양 그리기 영역" });
  canvas.setPointerCapture = vi.fn();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 240 } as DOMRect);
  fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(command).not.toHaveBeenCalledWith("set_widget_desktop_shape", expect.anything());
  fireEvent.pointerMove(canvas, { clientX: 100, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(canvas);
  await screen.findByText("저장 실패");
  expect(screen.getByRole("button", { name: "마지막 획 취소" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await act(async () => Promise.resolve());
  expect(command).not.toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false });
  await select("clock");
  expect(screen.getByRole("group", { name: "위젯 모양" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "모양 다시 저장" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "set_widget_desktop_shape")[1][1]).toEqual({
    id: "focus",
    shape: expect.objectContaining({ strokes: [[{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 10 }]] }),
  });
  vi.unstubAllGlobals();
});

it("finishes editing after resetting a shape whose save failed", async () => {
  state.mode = "freeform";
  let attempts = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "set_widget_desktop_shape" && attempts++ === 0) throw new Error("저장 실패");
    return { ...state, revision: state.revision + 1 };
  });
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.click(screen.getByRole("button", { name: "좌우" }));
  await screen.findByText("저장 실패");
  expect(screen.getByRole("button", { name: "모양 다시 저장" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "원래 모양으로" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_shape", {
    id: "focus", shape: null,
  }));
  expect(screen.queryByRole("button", { name: "모양 다시 저장" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false }));
});

it("discards an incomplete stroke without switching away from the previous shape", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  state.mode = "freeform";
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.click(screen.getByRole("radio", { name: "직접 그리기" }));
  const canvas = screen.getByRole("img", { name: "모양 그리기 영역" });
  canvas.setPointerCapture = vi.fn();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 240 } as DOMRect);
  fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(canvas);
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_shape", {
    id: "focus", shape: expect.objectContaining({ source: "preset", strokes: [] }),
  }));
  vi.unstubAllGlobals();
});

it("saves a newer shape before finishing when a previous save is still running", async () => {
  state.mode = "freeform";
  let finishSave: (value: DesktopState) => void = () => undefined;
  let attempts = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "set_widget_desktop_shape" && attempts++ === 0)
      return new Promise<DesktopState>((resolve) => { finishSave = resolve; });
    return { ...state, revision: state.revision + 1 };
  });
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.click(screen.getByRole("button", { name: "좌우" }));
  await waitFor(() => expect(attempts).toBe(1));
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  fireEvent.click(screen.getByRole("button", { name: "상하" }));
  await act(async () => finishSave({ ...state, revision: 6 }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false }));
  const calls = vi.mocked(command).mock.calls;
  const saves = calls.filter(([name]) => name === "set_widget_desktop_shape");
  expect(saves).toHaveLength(2);
  expect(saves[1][1]).toEqual({ id: "focus", shape: expect.objectContaining({ flipX: true, flipY: true }) });
  expect(calls.findIndex(([name]) => name === "set_widget_desktop_editing")).toBeGreaterThan(calls.indexOf(saves[1]));
});

it("saves colors and text placement for appearance kinds without an explicit save", async () => {
  state.mode = "freeform";
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("clock");
  fireEvent.click(screen.getByRole("tab", { name: "색상·글자" }));
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
      name: "오른쪽 아래",
    }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_appearance", {
      id: "clock",
      expectedRevision: 3,
      input: expect.objectContaining({ textPosition: "bottom-right" }),
    }),
  );
  expect(screen.queryByText(/먼저 저장/)).toBeNull();
});

it("asks before removing a background image and leaves it untouched on cancel", async () => {
  state.mode = "freeform";
  const snapshot = vi.mocked(useWidgets)().snapshot;
  const clock = snapshot?.widgets.find((item) => item.id === "clock");
  if (!clock) throw new Error("시계 위젯이 없어요.");
  clock.backgroundUpdatedAt = 1;
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("clock");
  expect(screen.getByText(/색상·글자와 배경 이미지는 복원하지 않아요/)).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "이미지로" }));
  fireEvent.click(screen.getByRole("button", { name: "이미지 제거" }));
  expect(screen.getByText(/저장된 이미지가 제거되며/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(command).not.toHaveBeenCalledWith("remove_widget_background", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "이미지 제거" }));
  fireEvent.click(screen.getByRole("button", { name: "제거" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("remove_widget_background", {
    id: "clock", expectedRevision: 3,
  }));
});

it("sets the stack width in pixels and clamps typed values on blur", async () => {
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  expect(screen.queryByRole("radio", { name: "넓게" })).toBeNull();
  const width = screen.getByLabelText("모아두기 너비(px)");
  expect(width).toHaveProperty("value", "370");
  fireEvent.click(screen.getByRole("button", { name: "너비 늘리기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: expect.objectContaining({ width: 380 }),
    }),
  );
  vi.mocked(command).mockClear();
  fireEvent.change(width, { target: { value: "9" } });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(command).not.toHaveBeenCalledWith("configure_widget_desktop", expect.anything());
  fireEvent.change(width, { target: { value: "9000" } });
  fireEvent.blur(width);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 6,
      input: expect.objectContaining({ width: 600 }),
    }),
  );
});

it("edits a stack-only look per widget with theme following, opacity and corners", async () => {
  state.stackStyles = {
    focus: {
      followTheme: true,
      backgroundColor: "#FFFFFF",
      textColor: "#1F2340",
      opacity: 100,
      radius: 20,
    },
  };
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  expect(screen.queryByRole("tablist", { name: "위젯 꾸미기" })).toBeNull();
  const look = within(screen.getByRole("group", { name: "모아두기 꾸미기" }));
  const theme = look.getByRole("switch", { name: "테마에 따르기" });
  expect(theme).toHaveProperty("checked", true);
  expect(look.getByLabelText("배경 색상")).toHaveProperty("disabled", true);
  expect(look.getByRole("slider", { name: "모서리" })).toHaveProperty("max", "9");
  expect(look.getByRole("slider", { name: "모서리" })).toHaveProperty("value", "9");
  expect(state.stackStyles.focus.radius).toBe(20);
  fireEvent.change(look.getByRole("slider", { name: "배경 투명도" }), { target: { value: "35" } });
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-stack-style-preview", {
    id: "focus", style: expect.objectContaining({ opacity: 35 }), revision: expect.any(Number),
  }));
  expect(look.getByText(/바탕화면에 따라 글자가 읽기 어려울 수/)).toBeTruthy();
  fireEvent.change(look.getByRole("slider", { name: "모서리" }), { target: { value: "6" } });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_stack_style", {
      id: "focus",
      style: {
        followTheme: true,
        backgroundColor: "#FFFFFF",
        textColor: "#1F2340",
        opacity: 35,
        radius: 6,
      },
    }),
  );
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "set_widget_stack_style"),
  ).toHaveLength(1);
  fireEvent.click(theme);
  expect(look.getByLabelText("배경 색상")).toHaveProperty("disabled", false);
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("set_widget_stack_style", {
      id: "focus",
      style: expect.objectContaining({ followTheme: false, opacity: 35 }),
    }),
  );
});

it("cancels an unsaved style preview before restoring the edit snapshot", async () => {
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.change(screen.getByRole("slider", { name: "배경 투명도" }), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("restore_widget_desktop", expect.anything()));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  expect(command).not.toHaveBeenCalledWith("set_widget_stack_style", expect.anything());
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-stack-style-preview", { id: null, style: null }));
});

it("warns when custom text and background colors have insufficient contrast", async () => {
  state.stackStyles = {
    focus: { followTheme: false, backgroundColor: "#FFFFFF", textColor: "#FFFFFF", opacity: 100, radius: 9 },
  };
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  expect(screen.getByText(/글자와 배경의 대비가 낮아/)).toBeTruthy();
});

it.each([
  { textColor: "#1F2340", warns: false },
  { textColor: "#666666", warns: true },
])("checks contrast using the secondary text color for $textColor", async ({ textColor, warns }) => {
  state.stackStyles = {
    focus: { followTheme: false, backgroundColor: "#FFFFFF", textColor, opacity: 100, radius: 9 },
  };
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  expect(Boolean(screen.queryByText(/글자와 배경의 대비가 낮아/))).toBe(warns);
});

it("flushes a pending stack style before finishing the edit session", async () => {
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.change(screen.getByRole("slider", { name: "배경 투명도" }), { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false }));
  const calls = vi.mocked(command).mock.calls.map(([name]) => name);
  expect(calls.indexOf("set_widget_stack_style")).toBeLessThan(calls.indexOf("set_widget_desktop_editing"));
});

it("clears only the completed style revision after a newer preview is sent", async () => {
  let finishSave: (value: DesktopState) => void = () => undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "set_widget_stack_style") {
      return new Promise<DesktopState>((resolve) => { finishSave = resolve; });
    }
    return state;
  });
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  const slider = screen.getByRole("slider", { name: "배경 투명도" });
  fireEvent.change(slider, { target: { value: "20" } });
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_widget_stack_style", expect.objectContaining({ style: expect.objectContaining({ opacity: 20 }) })));
  fireEvent.change(slider, { target: { value: "40" } });
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-stack-style-preview", expect.objectContaining({ revision: 2, style: expect.objectContaining({ opacity: 40 }) })));
  await act(async () => finishSave({ ...state, revision: 6 }));
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-stack-style-preview", { id: "focus", revision: 1, clear: true }));
});

it("clears the preview and shows an error if saving the style fails", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return state;
    if (name === "set_widget_stack_style") throw new Error("저장 실패");
    return state;
  });
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  fireEvent.change(screen.getByRole("slider", { name: "배경 투명도" }), { target: { value: "20" } });
  await screen.findByRole("alert");
  await waitFor(() => expect(emit).toHaveBeenCalledWith("widget-stack-style-preview", { id: "focus", revision: 1, clear: true }));
  expect(screen.getByRole("slider", { name: "배경 투명도" })).toHaveProperty("value", "100");
});

it("restores the edit-start snapshot and finishes editing", async () => {
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("restore_widget_desktop", {
      expectedRevision: 5,
      layout: expect.objectContaining({ mode: "freeform", order: ["clock"] }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "완료" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false }),
  );
  vi.mocked(command).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "편집 끝내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: false }),
  );
});
