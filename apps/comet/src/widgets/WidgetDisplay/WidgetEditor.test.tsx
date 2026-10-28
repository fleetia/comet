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
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 5,
      input: {
        mode: "stack",
        order: ["clock", "focus"],
        anchor: "bottom-left",
        width: 370,
        overlapped: true,
        oneExpanded: true,
        snapToGrid: false,
        showGuides: true,
      },
    }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "자유 배치" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_desktop", {
      expectedRevision: 6,
      input: expect.objectContaining({ mode: "freeform" }),
    }),
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
  fireEvent.click(add.getByRole("button", { name: "메모 바탕화면에 놓기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("add_widget_desktop_item", { id: "memo" }),
  );
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
  render(<WidgetEditor />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_desktop"));
  await select("focus");
  expect(screen.queryByRole("tablist", { name: "위젯 꾸미기" })).toBeNull();
  const look = within(screen.getByRole("group", { name: "모아두기 꾸미기" }));
  const theme = look.getByRole("switch", { name: "테마에 따르기" });
  expect(theme).toHaveProperty("checked", true);
  expect(look.getByLabelText("배경 색상")).toHaveProperty("disabled", true);
  fireEvent.change(look.getByRole("slider", { name: "배경 투명도" }), { target: { value: "35" } });
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
