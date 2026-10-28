import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { ConversationResponse } from "../components/Balloon/ConversationResponse";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "conversation-input" }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => true,
}));
beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.dataset.cometMotion = "reduced";
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.cometMotion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
it("bounds a block-flow input viewport without growing the native balloon", async () => {
  // The test DOM cannot verify visual clipping. Assert the source layout contract here;
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

it("measures the separate input webview without replacing the response measurement", async () => {
  window.history.replaceState(null, "", "/?view=conversation-input");
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 340, 100),
  );
  vi.mocked(command).mockResolvedValue(undefined);
  render(
    <Balloon
      surface="input"
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }}
    />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 340,
      height: 100,
      contentKey: "panel:a:input",
      surface: "input",
    }),
  );
});

it("remeasures the story surface when its variable choices or feedback grow", async () => {
  window.history.replaceState(null, "", "/?view=balloon");
  const resized: (() => void)[] = [];
  let height = 290;
  let viewportHeight = 290;
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (callback: () => void) {
      resized.push(callback);
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 340, this.tagName === "SECTION" ? viewportHeight : 196);
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === "SECTION" ? height : 196;
  });
  vi.mocked(command).mockResolvedValue(undefined);
  render(
    <Balloon
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        story: {
          id: "constellation",
          persona: "a",
          title: "이야기",
          prompt: "어디로 갈까?",
          choices: [
            { id: "one", label: "강가를 따라서" },
            { id: "two", label: "시장 골목으로" },
            { id: "three", label: "오늘은 쉬자" },
          ],
        },
      }}
    />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 340,
      height: 290,
      contentKey: "story:constellation",
    }),
  );
  height = 460;
  viewportHeight = 138;
  act(() => resized.forEach((callback) => callback()));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 340,
      height: 460,
      contentKey: "story:constellation",
    }),
  );
  height = 680;
  act(() => resized.forEach((callback) => callback()));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 340,
      height: 520,
      contentKey: "story:constellation",
    }),
  );
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
      orbitAnchor: { x: 70, y: 24 },
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
    // The test DOM has no layout. Model both natural growth and an already capped bubble,
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

it("preserves wide anchored branches and clears the anchor for an ordinary panel", async () => {
  let width = 320;
  let height = 340;
  window.history.replaceState(null, "", "/?view=balloon");
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-character-orbit-anchor")
      ? new DOMRect(128, 228, 52, 52)
      : new DOMRect(0, 0, width, height);
  });
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [];
    if (name === "resize_balloon")
      return { orbitAnchor: args?.orbitAnchor ? { x: 60, y: 254 } : null };
  });
  const { container, rerender } = render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "menu" } }} />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 320,
      height: 340,
      contentKey: "panel:a:menu",
      orbitAnchor: { x: 154, y: 254 },
    }),
  );
  await waitFor(() => expect(container.querySelector('circle[cx="60"][cy="254"]')).not.toBeNull());
  const previousListener = vi.mocked(listen).mock.calls.at(-1)?.[1];
  width = 600;
  height = 420;
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 600,
      height: 420,
      contentKey: "panel:a:menu",
      orbitAnchor: { x: 154, y: 254 },
    }),
  );
  width = 640;
  height = 500;
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 640,
      height: 500,
      contentKey: "panel:a:menu",
      orbitAnchor: { x: 154, y: 254 },
    }),
  );
  rerender(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 340,
      height: 500,
      contentKey: "panel:a:input",
    }),
  );
  width = 320;
  height = 340;
  rerender(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "b", mode: "menu" } }} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resize_balloon", {
      width: 320,
      height: 340,
      contentKey: "panel:b:menu",
      orbitAnchor: { x: 154, y: 254 },
    }),
  );
  act(() =>
    previousListener?.({
      event: "balloon-orbit-anchor",
      id: 1,
      payload: { contentKey: "panel:a:menu", orbitAnchor: { x: 19, y: 33 } },
    }),
  );
  expect(container.querySelector('circle[cx="19"][cy="33"]')).toBeNull();
});

it("keeps interaction Escape inside the orbit before closing the panel", async () => {
  const dispatch = vi.fn().mockResolvedValue([]);
  render(
    <Balloon
      preview
      dispatch={dispatch}
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "menu" } }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "교감" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "간식 주기" }), { key: "Escape" });
  expect(screen.getByRole("button", { name: "말 걸기" })).toBeDefined();
  expect(dispatch).not.toHaveBeenCalledWith("close_panel");
  await waitFor(() => expect(screen.queryByRole("button", { name: "간식 주기" })).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "말 걸기" })).toHaveProperty("disabled", false),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "말 걸기" }), { key: "Escape" });
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith("close_panel", undefined));
});

it("routes the outer close control through the orbit before dispatching once", async () => {
  const dispatch = vi.fn().mockResolvedValue([]);
  render(
    <Balloon
      preview
      dispatch={dispatch}
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "menu" } }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "교감" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith("close_panel", undefined));
  expect(dispatch.mock.calls.filter(([name]) => name === "close_panel")).toHaveLength(1);
});

it("restores the menu when an action fails after its exit", async () => {
  const dispatch = vi.fn(async (name: string) => {
    if (name === "open_settings") throw new Error("설정을 열지 못했어요.");
  });
  render(
    <Balloon
      preview
      dispatch={dispatch}
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "menu" } }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "설정" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "설정" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "설정을 열지 못했어요.");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "설정" })).toHaveProperty("disabled", false),
  );
});

it.each([{ orbitAnchor: null, conversationTailX: 219 }, { orbitAnchor: null }])(
  "anchors the conversation tail to its current speaker and keeps newer movement ahead of resize reply %j",
  async (stalePlacement) => {
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
    let height = 120;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 340, height),
    );
    let resolveResize: (placement: unknown) => void = () => {};
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "resize_balloon")
        return new Promise((resolve) => {
          resolveResize = resolve;
        });
    });
    const first = { ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" as const } };
    const { rerender } = render(<ConversationResponse snapshot={first} />);
    const host = () => screen.getByLabelText("캐릭터 대답");
    const tail = () => host().style.getPropertyValue("--comet-response-tail-x");
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("resize_balloon", {
        width: 340,
        height: 120,
        contentKey: "panel:a:input",
      }),
    );
    await act(async () => resolveResize({ orbitAnchor: null, conversationTailX: 219 }));
    expect(tail()).toBe("219px");
    const previousListener = vi.mocked(listen).mock.calls.at(-1)?.[1];
    height = 180;
    act(() => resized());
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("resize_balloon", {
        width: 340,
        height: 180,
        contentKey: "panel:a:input",
      }),
    );
    act(() =>
      previousListener?.({
        event: "balloon-orbit-anchor",
        id: 1,
        payload: { contentKey: "panel:a:input", orbitAnchor: null, conversationTailX: 247 },
      }),
    );
    await act(async () => resolveResize(stalePlacement));
    expect(tail()).toBe("247px");
    height = 200;
    act(() => resized());
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("resize_balloon", {
        width: 340,
        height: 200,
        contentKey: "panel:a:input",
      }),
    );
    const staleResize = resolveResize;
    rerender(
      <ConversationResponse snapshot={{ ...first, panel: { persona: "b", mode: "input" } }} />,
    );
    expect(tail()).toBe("");
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("resize_balloon", {
        width: 340,
        height: 200,
        contentKey: "panel:b:input",
      }),
    );
    act(() =>
      previousListener?.({
        event: "balloon-orbit-anchor",
        id: 1,
        payload: { contentKey: "panel:a:input", orbitAnchor: null, conversationTailX: 300 },
      }),
    );
    await act(async () => staleResize({ orbitAnchor: null, conversationTailX: 300 }));
    expect(tail()).toBe("");
    await act(async () => resolveResize({ orbitAnchor: null, conversationTailX: 47 }));
    expect(tail()).toBe("47px");
  },
);

it("keeps a speaker's tail while the next playback waits for its native placement", async () => {
  window.history.replaceState(null, "", "/?view=balloon");
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 340, 120),
  );
  let resolveResize: (placement: unknown) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "resize_balloon")
      return new Promise((resolve) => {
        resolveResize = resolve;
      });
  });
  const first = { ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" as const } };
  const { rerender } = render(<ConversationResponse snapshot={first} />);
  const tail = () =>
    screen.getByLabelText("캐릭터 대답").style.getPropertyValue("--comet-response-tail-x");
  await waitFor(() => expect(command).toHaveBeenCalledWith("resize_balloon", expect.anything()));
  await act(async () => resolveResize({ orbitAnchor: null, conversationTailX: 219 }));
  const previousListener = vi.mocked(listen).mock.calls.at(-1)?.[1];
  rerender(
    <ConversationResponse
      snapshot={{
        ...first,
        playback: {
          id: "next-line",
          persona: "a",
          text: "같은 친구가 다음 대사를 이어 말해요.",
          expression: "평온",
          source: "script",
          endsAt: 1,
          lineIndex: 1,
          lineCount: 2,
        },
      }}
    />,
  );
  expect(tail()).toBe("219px");
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("resize_balloon", {
      width: 340,
      height: 120,
      contentKey: "panel:a:input:playback:next-line",
    }),
  );
  act(() =>
    previousListener?.({
      event: "balloon-orbit-anchor",
      id: 1,
      payload: { contentKey: "panel:a:input", orbitAnchor: null, conversationTailX: 300 },
    }),
  );
  expect(tail()).toBe("219px");
  await act(async () => resolveResize({ orbitAnchor: null, conversationTailX: 247 }));
  expect(tail()).toBe("247px");
});
