import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDiaryNativeEvents } from "./useDiaryNativeEvents";

const native = vi.hoisted(() => ({
  command: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  close: vi.fn(),
}));
vi.mock("../../hooks/useSnapshot", () => ({
  command: native.command,
  isDesktop: () => true,
  errorText: String,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    native.listeners.set(name, callback);
    return () => undefined;
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: native.close }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
  native.close.mockResolvedValue(() => undefined);
  native.command.mockImplementation(async (name: string) =>
    name === "get_planner_tab" ? "today" : null,
  );
});

it.each(["get_planner_note_target", "get_planner_view_target"])(
  "ignores late %s hydration after newer ordinary tab navigation",
  async (pending) => {
    let resolve!: (value: unknown) => void;
    const response = new Promise((done) => {
      resolve = done;
    });
    native.command.mockImplementation(async (name: string) => {
      if (name === pending) return response;
      return name === "get_planner_tab" ? "today" : null;
    });
    const onNote = vi.fn();
    const onTab = vi.fn();
    const setViewTarget = vi.fn();
    renderHook(() =>
      useDiaryNativeEvents({
        navigateRef: { current: (action) => action() },
        blocking: { current: false },
        close: vi.fn(),
        nativeTab: "today",
        setFailure: vi.fn(),
        setViewTarget,
        onNote,
        onTab,
      }),
    );
    await waitFor(() => expect(native.command).toHaveBeenCalledWith(pending));
    act(() => native.listeners.get("planner-tab")?.({ payload: "todos" }));
    await act(async () =>
      resolve(
        pending === "get_planner_note_target"
          ? "old-note"
          : { entity: "page", targetId: "old-page" },
      ),
    );
    expect(onTab).toHaveBeenLastCalledWith("todos", true);
    expect(onNote).not.toHaveBeenCalled();
    expect(setViewTarget).toHaveBeenLastCalledWith(null);
    expect(setViewTarget).not.toHaveBeenCalledWith({ entity: "page", targetId: "old-page" });
  },
);

it("ignores a native close callback retained after its editor unmounts", async () => {
  const close = vi.fn();
  const navigate = vi.fn((action: () => void) => action());
  const view = renderHook(() =>
    useDiaryNativeEvents({
      navigateRef: { current: navigate },
      blocking: { current: false },
      close,
      nativeTab: "today",
      setFailure: vi.fn(),
      setViewTarget: vi.fn(),
      onNote: vi.fn(),
      onTab: vi.fn(),
    }),
  );
  await waitFor(() => expect(native.close).toHaveBeenCalled());
  const callback = native.close.mock.calls[0][0] as (event: { preventDefault: () => void }) => void;
  view.unmount();
  navigate.mockClear();
  const preventDefault = vi.fn();
  act(() => callback({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
