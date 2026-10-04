import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("bounds a block-flow input viewport without growing the native balloon", async () => {
  // jsdom cannot verify visual clipping. Assert the source layout contract here;
  // expanded-history and failed-send geometry still requires native acceptance.
  const { readFileSync } = await vi.importActual<{
    readFileSync(path: string, encoding: "utf8"): string;
  }>("node:fs");
  const companionStyles = readFileSync("src/components/companion.css.ts", "utf8");
  const viewport = companionStyles.match(
    /export const inputContents = style\(\{([\s\S]*?)\}\);/,
  )?.[1];
  expect(viewport).toBeDefined();
  expect(viewport).toContain('display: "block"');
  expect(viewport).toContain('flex: "1 1 auto"');
  expect(viewport).toContain("minHeight: 0");
  expect(viewport).toContain('overflowY: "auto"');
  const balloon = companionStyles.match(/export const balloon = style\(\{([\s\S]*?)\}\);/)?.[1];
  expect(balloon).toContain("maxWidth: 320");
  expect(balloon).toContain("maxHeight: 520");
  expect(balloon).toContain('overflow: "hidden"');
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
    await waitFor(() =>
      expect(
        vi.mocked(command).mock.calls.filter(([name]) => name === "resize_balloon"),
      ).toHaveLength(1),
    );
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 140,
      height: 48,
      contentKey: "panel:b:menu",
    });
  } finally {
    Object.defineProperty(document, "fonts", { configurable: true, value: oldFonts });
  }
});

it.each([
  ["one failing test. one small fix.", 355, 428],
  ["same hero new line. surprise me with a scene.", 387, 460],
  ["a long previous reply ".repeat(30), 520, 520],
])(
  "keeps failed-send feedback first while measuring the same input panel: %s",
  async (reply, previousHeight, failedHeight) => {
    window.history.replaceState(null, "", "/?view=balloon");
    let resized: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (callback: () => void) {
        resized = callback;
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    // jsdom has no layout. Model both natural growth and an already capped bubble,
    // and verify the hook's native sizing contract independently of DOM ordering.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(
        0,
        0,
        320,
        this.querySelector('[role="alert"]') ? failedHeight : previousHeight,
      );
    });
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "send_message") throw new Error("설정에서 로컬 모델을 먼저 다운로드해 주세요.");
    });
    render(
      <Balloon
        snapshot={{
          ...PREVIEW_SNAPSHOT,
          panel: { persona: "builtin-a", mode: "input" },
          conversation: {
            session: {
              id: "wrapped-reply",
              userId: "preview-user",
              participants: ["builtin-a"],
              status: "active",
              title: "test",
              createdAt: 1,
              updatedAt: 1,
              draft: "tell me something new",
              continuedFrom: null,
            },
            messages: [
              {
                id: "wordbook-reply",
                role: "assistant",
                persona: "builtin-a",
                content: reply,
                expression: "평온",
                status: "complete",
                createdAt: 1,
              },
            ],
            nextBefore: null,
          },
        }}
      />,
    );
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("resize_balloon", {
        width: 320,
        height: previousHeight,
        contentKey: "panel:builtin-a:input",
      }),
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    const alert = await screen.findByRole("alert");
    act(() => resized());
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("resize_balloon", {
        width: 320,
        height: failedHeight,
        contentKey: "panel:builtin-a:input",
      }),
    );
    const previousReply = screen.getByText(reply, { exact: true, normalizer: (value) => value });
    expect(
      alert.compareDocumentPosition(previousReply) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "tell me something new");
  },
);
