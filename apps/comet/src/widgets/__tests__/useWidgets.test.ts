import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen, type Event } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import type { WidgetSnapshot } from "../types";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
it("subscribes first and does not overwrite a newer event with the initial read", async () => {
  let receive: ((event: Event<WidgetSnapshot>) => void) | undefined;
  let resolveInitial: ((snapshot: WidgetSnapshot) => void) | undefined;
  const unlisten = vi.fn();
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    if (name === "widgets-state") receive = callback;
    return unlisten;
  });
  vi.mocked(command).mockReturnValue(
    new Promise<WidgetSnapshot>((resolve) => {
      resolveInitial = resolve;
    }),
  );
  const { result, unmount } = renderHook(useWidgets);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widgets"));
  const newest = { ...PREVIEW_WIDGETS, onboardingDone: true };
  act(() => receive?.({ event: "widgets-state", id: 1, payload: newest }));
  await act(async () => resolveInitial?.(PREVIEW_WIDGETS));
  expect(result.current.snapshot).toEqual(newest);
  unmount();
  expect(unlisten).toHaveBeenCalledTimes(2);
});

it("merges single widget updates by id and preserves newer revisions during initial load", async () => {
  const callbacks = new Map<string, (event: Event<never>) => void>();
  let resolveInitial: ((snapshot: WidgetSnapshot) => void) | undefined;
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    callbacks.set(name, callback as (event: Event<never>) => void);
    return vi.fn<() => void>();
  });
  vi.mocked(command).mockReturnValue(new Promise<WidgetSnapshot>((resolve) => { resolveInitial = resolve; }));
  const entry = { id: "music", kind: "music", version: 1, revision: 1, data: {}, error: null, status: "enabled" as const, reaction: true, missing: [], packageBytes: 0 };
  const other = { ...entry, id: "other" };
  const { result } = renderHook(useWidgets);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_widgets"));
  const updated = { ...entry, revision: 2, data: { status: "ready" } };
  act(() => callbacks.get("widget-state")?.({ event: "widget-state", id: 1, payload: updated } as Event<never>));
  await act(async () => resolveInitial?.({ ...PREVIEW_WIDGETS, widgets: [entry, other] }));
  expect(result.current.snapshot?.widgets).toEqual([updated, other]);
  act(() => callbacks.get("widget-state")?.({ event: "widget-state", id: 2, payload: entry } as Event<never>));
  expect(result.current.snapshot?.widgets).toEqual([updated, other]);
});
