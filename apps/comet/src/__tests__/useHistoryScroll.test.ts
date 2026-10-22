import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useHistoryScroll } from "../components/Balloon/useHistoryScroll";
import type { ConversationMessages } from "../types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("restores a pending hidden reading position on resize without another render", () => {
  let viewport = 0;
  const log = document.createElement("div");
  const anchor = document.createElement("div");
  anchor.dataset.historyMessage = "saved-message";
  log.append(anchor);
  Object.defineProperties(log, {
    clientHeight: { get: () => viewport },
    scrollHeight: { value: 1000 },
    offsetTop: { value: 80 },
  });
  Object.defineProperties(anchor, {
    offsetTop: { value: 320 },
    offsetHeight: { value: 100 },
  });
  let resize = (): void => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  const observer: ResizeObserver = { observe, unobserve: vi.fn(), disconnect };
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (callback: ResizeObserverCallback) {
      resize = () => callback([], observer);
      return observer;
    }),
  );
  const page: ConversationMessages = {
    messages: [
      {
        id: "saved-message",
        role: "assistant",
        persona: "builtin-a",
        content: "읽던 대화 원문",
        expression: null,
        createdAt: 1760000000000,
        status: "complete",
      },
    ],
    nextBefore: null,
  };
  const saved = {
    anchor: { messageId: "saved-message", offset: 85 },
    followingTail: false,
  };
  const { result, unmount } = renderHook(() => {
    const transcript = useHistoryScroll("first", page, "preview-user");
    transcript.log.current = log;
    return transcript;
  });

  act(() => {
    result.current.restore(saved);
    resize();
  });
  expect(log.scrollTop).toBe(0);
  expect(result.current.capture()).toEqual(saved);

  viewport = 400;
  act(() => resize());

  expect(log.scrollTop).toBe(155);
  expect(result.current.capture()).toEqual(saved);
  expect(observe).toHaveBeenCalledWith(log);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
