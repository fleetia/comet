import { useEffect, useRef, useState, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";

export type DiaryViewTarget = {
  entity: "page" | "event" | "envelope" | "todo" | "habit";
  targetId: string;
};

const NATIVE_TABS = [
  "today",
  "todos",
  "calendar",
  "plans",
  "templates",
  "organizer",
  "habits",
  "ledger",
  "envelopes",
  "time",
];

/**
 * Connects the diary window to native note, tab, view-target and close events,
 * and projects the visible screen back into the native planner tab.
 */
export function useDiaryNativeEvents({
  navigateRef,
  close,
  nativeTab,
  setFailure,
  setViewTarget,
  onNote,
  onTab,
}: {
  navigateRef: RefObject<(action: () => void, closing?: boolean) => void>;
  blocking: RefObject<boolean>;
  close: () => void;
  nativeTab: string;
  setFailure: (failure: string | null) => void;
  setViewTarget: (target: DiaryViewTarget | null) => void;
  onNote: (id: string) => void;
  onTab: (tab: string, resetCollections: boolean) => void;
}): boolean {
  const [navigationReady, setNavigationReady] = useState(false);
  const navigationRevision = useRef(0);
  const closeRef = useRef(close);
  closeRef.current = close;
  const handlers = useRef({ onNote, onTab });
  handlers.current = { onNote, onTab };
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let received = false;
    const initialRevision = navigationRevision.current;
    let cleanup: (() => void) | undefined;
    function select(id: string | null): void {
      if (!active || !id) return;
      navigateRef.current(() => handlers.current.onNote(id));
    }
    void listen<string>("planner-note", (event) => {
      if (!active) return;
      navigationRevision.current += 1;
      received = true;
      select(event.payload);
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        const id = await command<string | null>("get_planner_note_target");
        if (!received && initialRevision === navigationRevision.current) select(id);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const initialRevision = navigationRevision.current;
    const cleanups: (() => void)[] = [];
    const retain = (cleanup: () => void): void => {
      if (active) cleanups.push(cleanup);
      else cleanup();
    };
    const select = (tab: string, resetCollections = true): void => {
      if (!active || !NATIVE_TABS.includes(tab)) return;
      navigateRef.current(() => handlers.current.onTab(tab, resetCollections));
    };
    let received = false;
    let targetReceived = false;
    function receiveTarget(value: unknown): void {
      if (!active || !value) return;
      if (
        typeof value !== "object" ||
        !("entity" in value) ||
        !("targetId" in value) ||
        (value.entity !== "page" && value.entity !== "event" && value.entity !== "envelope" &&
          value.entity !== "todo" && value.entity !== "habit") ||
        typeof value.targetId !== "string" ||
        !value.targetId
      ) {
        setFailure("열 기록의 정보를 확인하지 못했어요.");
        return;
      }
      setViewTarget({ entity: value.entity, targetId: value.targetId });
    }
    void listen("planner-view-target", (event) => {
      if (!active) return;
      navigationRevision.current += 1;
      targetReceived = true;
      receiveTarget(event.payload);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        retain(cleanup);
        const target = await command<unknown>("get_planner_view_target");
        if (!targetReceived && initialRevision === navigationRevision.current)
          receiveTarget(target);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    void listen<string>("planner-tab", (event) => {
      if (!active) return;
      navigationRevision.current += 1;
      received = true;
      setViewTarget(null);
      select(event.payload);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        retain(cleanup);
        const tab = await command<string>("get_planner_tab");
        if (!received && initialRevision === navigationRevision.current) select(tab, false);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      })
      .finally(() => {
        if (active) setNavigationReady(true);
      });
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        if (!active) return;
        navigateRef.current(() => closeRef.current(), true);
      })
      .then(retain)
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
  // Read startup navigation first so an initial "today" render cannot overwrite it.
  useEffect(() => {
    if (!navigationReady || !isDesktop()) return;
    let active = true;
    void command("set_planner_tab", { tab: nativeTab }).catch((cause: unknown) => {
      if (active) setFailure(errorText(cause));
    });
    return () => {
      active = false;
    };
  }, [navigationReady, nativeTab]);
  return navigationReady;
}
