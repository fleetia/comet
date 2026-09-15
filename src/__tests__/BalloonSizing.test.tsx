import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Balloon } from "../components/Balloon";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => true,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
it("resizes native content once per measured height and releases its observer", async () => {
  window.history.replaceState(null, "", "/?view=balloon");
  let height = 218;
  let resized: () => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (callback: () => void) {
      resized = callback;
      return { observe: vi.fn(), disconnect };
    }),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 320, height),
  );
  const { unmount } = render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }} />,
  );
  await waitFor(() => expect(command).toHaveBeenCalledWith("resize_balloon", { height: 218 }));
  act(() => resized());
  expect(command).toHaveBeenCalledTimes(1);
  height = 600;
  act(() => resized());
  await waitFor(() => expect(command).toHaveBeenLastCalledWith("resize_balloon", { height: 520 }));
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
