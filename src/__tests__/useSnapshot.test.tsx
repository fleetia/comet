import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import { PREVIEW_SNAPSHOT, useSnapshot } from "../hooks/useSnapshot";
import type { Snapshot } from "../types";
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps newer emitted state over a late initial snapshot and unsubscribes", async () => {
  let receive: (event: Event<Snapshot>) => void = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    receive = callback as typeof receive;
    return unsubscribe;
  });
  let resolveInitial: (value: Snapshot) => void = () => {};
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
  const { result, unmount } = renderHook(useSnapshot);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_snapshot", undefined));
  const newer = { ...PREVIEW_SNAPSHOT, preparedCount: 3 };
  act(() => receive({ event: "app-state", id: 1, payload: newer }));
  await act(async () => resolveInitial(PREVIEW_SNAPSHOT));
  expect(result.current.snapshot?.preparedCount).toBe(3);
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("releases a listener that completes registration after unmount", async () => {
  const unsubscribe = vi.fn();
  let resolveListener: (cleanup: () => void) => void = () => {};
  vi.mocked(listen).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveListener = resolve;
      }),
  );
  const { unmount } = renderHook(useSnapshot);
  unmount();
  await act(async () => resolveListener(unsubscribe));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});
