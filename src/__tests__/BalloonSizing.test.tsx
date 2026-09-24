import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => true,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
it("sends final width and height with the current content key, deduplicates and disconnects", async () => {
  window.history.replaceState(null, "", "/?view=balloon");
  let height = 218;
  let width = 320;
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
    () => new DOMRect(0, 0, width, height),
  );
  const { unmount } = render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }} />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 320,
      height: 218,
      contentKey: "panel:a:input",
    }),
  );
  act(() => resized());
  expect(command).toHaveBeenCalledTimes(1);
  height = 600;
  width = 160;
  act(() => resized());
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 160,
      height: 520,
      contentKey: "panel:a:input",
    }),
  );
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it("waits for fonts and discards a previous content measurement before acknowledging the next panel", async () => {
  window.history.replaceState(null, "", "/?view=balloon");
  let fontsReady!: () => void;
  const oldFonts = document.fonts;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise<void>((resolve) => {
        fontsReady = resolve;
      }),
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 140, 48),
  );
  try {
    const { rerender, container } = render(
      <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }} />,
    );
    expect(command).not.toHaveBeenCalled();
    expect(container.querySelector("section")?.style.visibility).toBe("hidden");
    rerender(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "b", mode: "menu" } }} />);
    await act(async () => fontsReady());
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 140,
      height: 48,
      contentKey: "panel:b:menu",
    });
  } finally {
    Object.defineProperty(document, "fonts", { configurable: true, value: oldFonts });
  }
});
