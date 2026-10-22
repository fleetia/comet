import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import { updateAnalyticsConsent } from "../analytics";
import { useAnalyticsConsent } from "../hooks/useAnalyticsConsent";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn(() => true), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../analytics", () => ({ updateAnalyticsConsent: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});

it("subscribes before reading and keeps withdrawal over a stale initial grant", async () => {
  let receive: (event: Event<boolean>) => void = () => {};
  let resolveListener: (cleanup: () => void) => void = () => {};
  let resolveInitial: (value: boolean) => void = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(listen).mockImplementation((_name, callback) => {
    receive = callback as typeof receive;
    return new Promise((resolve) => {
      resolveListener = resolve;
    });
  });
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
  const { unmount } = renderHook(useAnalyticsConsent);
  expect(listen).toHaveBeenCalledWith("analytics-consent", expect.any(Function));
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => resolveListener(unsubscribe));
  expect(invoke).toHaveBeenCalledWith("get_analytics_consent");
  act(() => receive({ event: "analytics-consent", id: 1, payload: false }));
  await act(async () => resolveInitial(true));
  expect(updateAnalyticsConsent).toHaveBeenCalledExactlyOnceWith(false);
  act(() => receive({ event: "analytics-consent", id: 2, payload: true }));
  expect(updateAnalyticsConsent).toHaveBeenLastCalledWith(true);
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  act(() => receive({ event: "analytics-consent", id: 3, payload: false }));
  expect(updateAnalyticsConsent).toHaveBeenCalledTimes(2);
});

it("applies initial consent when no event arrived", async () => {
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(invoke).mockResolvedValue(true);
  renderHook(useAnalyticsConsent);
  await waitFor(() => expect(updateAnalyticsConsent).toHaveBeenCalledExactlyOnceWith(true));
});

it("cleans up late registration without starting the read after unmount", async () => {
  let resolveListener: (cleanup: () => void) => void = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(listen).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveListener = resolve;
      }),
  );
  const { unmount } = renderHook(useAnalyticsConsent);
  unmount();
  await act(async () => resolveListener(unsubscribe));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

it("ignores a pending initial read after unmount", async () => {
  let resolveInitial: (value: boolean) => void = () => {};
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
  );
  const { unmount } = renderHook(useAnalyticsConsent);
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  unmount();
  await act(async () => resolveInitial(true));
  expect(updateAnalyticsConsent).not.toHaveBeenCalled();
});

it.each(["listen", "read"])("fails closed when %s fails", async (failure) => {
  if (failure === "listen") vi.mocked(listen).mockRejectedValue(new Error("offline"));
  else {
    vi.mocked(listen).mockResolvedValue(vi.fn());
    vi.mocked(invoke).mockRejectedValue(new Error("offline"));
  }
  renderHook(useAnalyticsConsent);
  await waitFor(() => expect(updateAnalyticsConsent).toHaveBeenCalledWith(false));
});

it("does not subscribe in browser previews", () => {
  vi.mocked(isTauri).mockReturnValue(false);
  renderHook(useAnalyticsConsent);
  expect(listen).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
