import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { PlannerToolState } from "./Planner";
import type { PlannerFailure } from "./usePlannerActions";

export type PlannerLeave = {
  confirmClose: boolean;
  closeWindow: () => Promise<void>;
  returnToDiary: () => void;
  keepWriting: () => void;
  discardAndLeave: () => Promise<void>;
  onConfirmOpenChange: (open: boolean) => void;
};

/**
 * Reports unsaved planner work to the embedding diary and, in its own window,
 * follows native tab events and confirms closing over unsaved work.
 */
export function usePlannerLeave({
  embedded,
  initialTab,
  state,
  onStateChange,
  onBack,
  isTab,
  setTab,
  setFailure,
}: {
  embedded: boolean;
  initialTab: string | undefined;
  state: PlannerToolState;
  onStateChange: ((state: PlannerToolState) => void) | undefined;
  onBack: (() => void) | undefined;
  isTab: (value: string) => boolean;
  setTab: (value: string) => void;
  setFailure: (failure: PlannerFailure | null) => void;
}): PlannerLeave {
  const { dirty, busy, blocking } = state;
  const [confirmClose, setConfirmClose] = useState(false);
  const leaving = useRef(false);
  const returning = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const report = useRef(onStateChange);
  report.current = onStateChange;
  const selectTab = useRef({ isTab, setTab });
  selectTab.current = { isTab, setTab };
  useEffect(() => {
    report.current?.({ dirty, busy, blocking });
  }, [dirty, busy, blocking]);
  useEffect(() => () => report.current?.({ dirty: false, busy: false, blocking: false }), []);
  useEffect(() => {
    if (embedded || !isDesktop()) return;
    let active = true;
    let tabCleanup: (() => void) | undefined, closeCleanup: (() => void) | undefined;
    let received = false;
    const select = (value: string): void => {
      if (active && selectTab.current.isTab(value)) selectTab.current.setTab(value);
    };
    void listen<string>("planner-tab", (e) => {
      received = true;
      select(e.payload);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        tabCleanup = cleanup;
        const latest = await command<string>("get_planner_tab");
        if (!received && !initialTab) select(latest);
      })
      .catch((cause: unknown) => {
        if (active) setFailure({ message: errorText(cause), saving: false });
      });
    void getCurrentWindow()
      .onCloseRequested((e) => {
        if (!leaving.current && dirtyRef.current) {
          e.preventDefault();
          setConfirmClose(true);
        }
      })
      .then((cleanup) => {
        if (active) closeCleanup = cleanup;
        else cleanup();
      })
      .catch((cause: unknown) => {
        if (active) setFailure({ message: errorText(cause), saving: false });
      });
    return () => {
      active = false;
      tabCleanup?.();
      closeCleanup?.();
    };
  }, [embedded]);

  async function closeWindow(): Promise<void> {
    if (dirtyRef.current && !leaving.current) {
      setConfirmClose(true);
      return;
    }
    if (returning.current && onBack) onBack();
    else if (isDesktop()) await getCurrentWindow().destroy();
  }
  return {
    confirmClose,
    closeWindow,
    returnToDiary: () => {
      returning.current = true;
      void closeWindow();
    },
    keepWriting: () => {
      returning.current = false;
      setConfirmClose(false);
    },
    discardAndLeave: async () => {
      leaving.current = true;
      await closeWindow();
    },
    onConfirmOpenChange: (open) => {
      if (!open) returning.current = false;
      setConfirmClose(open);
    },
  };
}
