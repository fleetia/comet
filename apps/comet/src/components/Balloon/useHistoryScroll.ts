import { useLayoutEffect, useRef } from "react";
import type { ConversationMessages } from "../../types";

type Position = {
  sessionId: string;
  firstId: string | undefined;
  firstTop: number;
  top: number;
  height: number;
  viewport: number;
  pinned: boolean;
  reloading: boolean;
};

const BOTTOM_MARGIN = 24;

/** Follow a live tail without taking the reader away from older messages. */
export function useHistoryScroll(sessionId: string | undefined, page: ConversationMessages | null) {
  const log = useRef<HTMLDivElement>(null);
  const position = useRef<Position | null>(null);

  function firstMessage(id: string | undefined): HTMLElement | undefined {
    return Array.from(
      log.current?.querySelectorAll<HTMLElement>("[data-history-message]") ?? [],
    ).find((message) => message.dataset.historyMessage === id);
  }

  function remember(): void {
    const element = log.current;
    if (!element || !sessionId || !page) return;
    const firstId = page.messages[0]?.id;
    position.current = {
      sessionId,
      firstId,
      firstTop: (firstMessage(firstId)?.offsetTop ?? element.offsetTop) - element.offsetTop,
      top: element.scrollTop,
      height: element.scrollHeight,
      viewport: element.clientHeight,
      pinned: element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_MARGIN,
      reloading: false,
    };
  }

  function followTail(): void {
    const saved = position.current;
    if (!log.current || !saved || saved.sessionId !== sessionId) return;
    saved.pinned = true;
    log.current.scrollTop = log.current.scrollHeight;
    remember();
  }

  // Measure after each committed layout, including composer/loading-height changes.
  // Snapshot churn with unchanged geometry does not write the scroll position.
  useLayoutEffect(() => {
    const element = log.current;
    if (!element || !sessionId) {
      position.current = null;
      return;
    }
    const previous = position.current;
    if (previous && previous.sessionId !== sessionId) {
      element.scrollTop = 0;
      position.current = null;
    }
    if (!page) {
      if (position.current) position.current.reloading = true;
      return;
    }
    const saved = position.current;
    if (saved) {
      const anchor = firstMessage(saved.firstId);
      const firstTop = anchor ? anchor.offsetTop - element.offsetTop : undefined;
      if (!saved.pinned && firstTop !== undefined && firstTop !== saved.firstTop) {
        // Anchor to the old first message, not total height: a reply can arrive
        // while older messages load, and must not shift an older reading position.
        element.scrollTop = saved.top + firstTop - saved.firstTop;
      } else if (
        saved.pinned &&
        (saved.reloading ||
          saved.height !== element.scrollHeight ||
          saved.viewport !== element.clientHeight)
      ) {
        element.scrollTop = element.scrollHeight;
      } else if (saved.reloading) {
        element.scrollTop = saved.top;
      }
    }
    remember();
  });

  return { log, onScroll: remember, followTail };
}
