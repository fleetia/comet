import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen, type Event } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { useWidgetRuntime } from "../useWidgetRuntime";
import type { WidgetRuntime, WidgetRuntimeSnapshot } from "../types";

const nativeWindow = vi.hoisted(() => ({ isVisible: vi.fn(), onFocusChanged: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => nativeWindow }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
let receive: ((event: Event<WidgetRuntimeSnapshot>) => void) | undefined;
const unlisten = vi.fn();
const entry: WidgetRuntime = {
  id: "memo-id",
  toolWindow: { state: "visible", shared: null },
  displayWindow: null,
  noteWindows: { open: 3, visible: 2 },
  toys: null,
  queryError: null,
  actionError: null,
};
function emit(snapshot: WidgetRuntimeSnapshot): void {
  act(() => receive?.({ event: "widgets-runtime", id: 1, payload: snapshot }));
}
beforeEach(() => {
  vi.clearAllMocks();
  receive = undefined;
  nativeWindow.isVisible.mockResolvedValue(true);
  nativeWindow.onFocusChanged.mockResolvedValue(() => undefined);
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    receive = callback;
    return unlisten;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("subscribes before querying and rejects an older initial response after a newer native event", async () => {
  let finish: ((value: WidgetRuntimeSnapshot) => void) | undefined;
  vi.mocked(command).mockReturnValue(
    new Promise<WidgetRuntimeSnapshot>((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useWidgetRuntime(true));
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widget_runtime"));
  emit({ sequence: 8, widgets: [entry] });
  await act(async () =>
    finish?.({
      sequence: 2,
      widgets: [{ ...entry, toolWindow: { state: "closed", shared: null } }],
    }),
  );
  expect(result.current.snapshot?.sequence).toBe(8);
  expect(result.current.snapshot?.widgets[0].toolWindow?.state).toBe("visible");
});

it("retains last confirmed note counts on query failure without turning creation errors into stale data", async () => {
  vi.mocked(command).mockResolvedValue({ sequence: 1, widgets: [entry] });
  const { result } = renderHook(() => useWidgetRuntime(true));
  await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
  const actionError = { attemptId: "attempt", message: "창 생성 실패" };
  emit({
    sequence: 2,
    widgets: [
      { ...entry, noteWindows: { open: 0, visible: 0 }, queryError: "조회 실패", actionError },
    ],
  });
  expect(result.current.snapshot?.widgets[0]).toMatchObject({
    noteWindows: { open: 3, visible: 2 },
    queryError: "조회 실패",
    lastConfirmed: true,
    actionError,
  });
  emit({ sequence: 3, widgets: [{ ...entry, noteWindows: { open: 0, visible: 0 }, actionError }] });
  expect(result.current.snapshot?.widgets[0]).toMatchObject({
    noteWindows: { open: 0, visible: 0 },
    queryError: null,
    actionError,
  });
});

it("distinguishes a first failed query from a last confirmed state and suspends queries off the widget page", async () => {
  vi.mocked(command).mockResolvedValue({
    sequence: 1,
    widgets: [{ ...entry, queryError: "조회 실패" }],
  });
  const { result, rerender } = renderHook(({ active }) => useWidgetRuntime(active), {
    initialProps: { active: true },
  });
  await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
  expect(result.current.snapshot?.widgets[0].lastConfirmed).toBe(false);
  rerender({ active: false });
  expect(unlisten).toHaveBeenCalledOnce();
  const calls = vi.mocked(command).mock.calls.length;
  act(() => result.current.reload());
  expect(command).toHaveBeenCalledTimes(calls);
});
