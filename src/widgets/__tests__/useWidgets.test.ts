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
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    receive = callback;
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
  expect(unlisten).toHaveBeenCalledOnce();
});
