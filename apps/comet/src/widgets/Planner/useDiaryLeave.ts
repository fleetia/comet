import { useRef, useState, type RefObject } from "react";

export type DiaryLeave = { action: () => void; closing: boolean };

export type DiaryLeaveGuard = {
  leave: DiaryLeave | null;
  setLeave: (leave: DiaryLeave | null) => void;
  navigate: (action: () => void, closing?: boolean) => void;
  navigateRef: RefObject<(action: () => void, closing?: boolean) => void>;
  blocking: RefObject<boolean>;
};

export function useDiaryLeave({
  saving,
  unsaved,
  closingUnsaved,
}: {
  saving: boolean;
  /** Drafts that a move inside the diary would discard. */
  unsaved: boolean;
  /** Drafts that stay mounted while moving but are lost when the window closes. */
  closingUnsaved: boolean;
}): DiaryLeaveGuard {
  const [leave, setLeave] = useState<DiaryLeave | null>(null);
  const blocking = useRef(false);
  blocking.current = saving || unsaved || closingUnsaved;
  function navigate(action: () => void, closing = false): void {
    if (saving) return;
    if (unsaved || (closing && closingUnsaved)) setLeave({ action, closing });
    else action();
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  return { leave, setLeave, navigate, navigateRef, blocking };
}
