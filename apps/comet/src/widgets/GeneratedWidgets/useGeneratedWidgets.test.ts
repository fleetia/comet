import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { useGeneratedWidgets } from "./useGeneratedWidgets";
import type { Workshop } from "./types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const EMPTY: Workshop = {
  widgets: [],
  automatic: true,
  runtime: "javascript",
  generationEligibility: {
    allowed: true,
    reason: "allowed",
    model: "12B",
    parameterBillions: 12,
    source: "catalog",
  },
};
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function changed(): void {
  const callback = vi.mocked(listen).mock.calls.at(-1)?.[1];
  if (!callback) throw new Error("listener missing");
  callback({ event: "generated-widgets-changed", id: 1, payload: null });
}
beforeEach(() => {
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(command).mockReset();
});
afterEach(cleanup);

it("ignores queued callbacks from the previous subscription after reload", async () => {
  const current = deferred<Workshop>();
  vi.mocked(command).mockResolvedValueOnce(EMPTY).mockReturnValueOnce(current.promise);
  const { result } = renderHook(useGeneratedWidgets);
  await waitFor(() => expect(result.current.workshop.generationEligibility.allowed).toBe(true));
  const stale = vi.mocked(listen).mock.calls[0]?.[1];
  if (!stale) throw new Error("listener missing");
  act(() => result.current.reload());
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  act(() => stale({ event: "generated-widgets-changed", id: 1, payload: null }));
  await act(async () => current.resolve({ ...EMPTY, automatic: false }));
  expect(command).toHaveBeenCalledTimes(2);
  expect(result.current.workshop.automatic).toBe(false);
});

it("keeps the latest event snapshot when initial reads resolve late and hides removed records", async () => {
  const initial = deferred<Workshop>();
  const newer = deferred<Workshop>();
  vi.mocked(command).mockReturnValueOnce(initial.promise).mockReturnValueOnce(newer.promise);
  const { result } = renderHook(useGeneratedWidgets);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  act(changed);
  await act(async () =>
    newer.resolve({
      ...EMPTY,
      automatic: false,
      widgets: [
        {
          id: "gone",
          definition: { name: "removed", description: "", source: "", initialState: {} },
          state: {},
          revision: 1,
          installed: false,
          enabled: false,
          status: "ready",
          error: null,
          installation: null,
          updatedAt: null,
        },
      ],
    }),
  );
  expect(result.current.workshop.automatic).toBe(false);
  expect(result.current.workshop.widgets).toEqual([]);
  await act(async () => initial.resolve(EMPTY));
  expect(result.current.workshop.automatic).toBe(false);
});

it("reports refresh failures, recovers on reload, and cleans up a late listener after unmount", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("read failed")).mockResolvedValue(EMPTY);
  const view = renderHook(useGeneratedWidgets);
  await waitFor(() => expect(view.result.current.error).toBe("read failed"));
  act(() => view.result.current.reload());
  await waitFor(() => expect(view.result.current.error).toBeNull());
  view.unmount();
  const listener = deferred<() => void>();
  const stop = vi.fn();
  vi.mocked(listen).mockReturnValueOnce(listener.promise);
  const late = renderHook(useGeneratedWidgets);
  const reads = vi.mocked(command).mock.calls.length;
  late.unmount();
  await act(async () => listener.resolve(stop));
  expect(stop).toHaveBeenCalledOnce();
  expect(command).toHaveBeenCalledTimes(reads);
});
