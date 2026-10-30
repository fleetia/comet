import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import type { DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import type { FocusTimerLayoutState } from "./useFocusTimerLayout";

type RecordNoteOrigin = { widgetId: string; sessionId: string };

export type FocusTimerContextState = {
  tab: string;
  setTab: Dispatch<SetStateAction<string>>;
  selectedSession: string | null;
  setSelectedSession: Dispatch<SetStateAction<string | null>>;
  requestedNote: DataRecord | null;
  setRequestedNote: Dispatch<SetStateAction<DataRecord | null>>;
  recordNoteButton: RefObject<HTMLButtonElement | null>;
  usagePickerOpen: boolean;
  setUsagePickerOpen: Dispatch<SetStateAction<boolean>>;
  openNote: (ref: DataRecord) => void;
  closeRequestedNote: () => void;
  openSettings: () => void;
  openTimeline: () => void;
};

export function useFocusTimerContext(
  widget: WidgetView,
  active: boolean,
  hostBusy: boolean,
  layout: FocusTimerLayoutState,
  setError: Dispatch<SetStateAction<string>>,
): FocusTimerContextState {
  const { expanded, collapsed, context } = layout;
  const [usagePickerOpen, setUsagePickerOpen] = useState(false);
  const [tab, setTab] = useState("stats");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [requestedNote, setRequestedNote] = useState<DataRecord | null>(null);
  const recordNoteOrigin = useRef<RecordNoteOrigin | null>(null);
  const recordNoteButton = useRef<HTMLButtonElement | null>(null);
  const [restoreRecordFocus, setRestoreRecordFocus] = useState<RecordNoteOrigin | null>(null);
  useEffect(() => {
    if (!restoreRecordFocus || tab !== "stats") {
      return;
    }
    setRestoreRecordFocus(null);
    if (
      restoreRecordFocus.widgetId !== widget.id ||
      restoreRecordFocus.sessionId !== selectedSession ||
      !active ||
      !expanded ||
      collapsed
    ) {
      return;
    }
    const target = hostBusy ? null : recordNoteButton.current;
    (target ?? context.current)?.focus();
  }, [restoreRecordFocus, tab, widget.id, selectedSession, active, expanded, collapsed, hostBusy]);
  function openNote(ref: DataRecord): void {
    recordNoteOrigin.current = selectedSession
      ? { widgetId: widget.id, sessionId: selectedSession }
      : null;
    setRestoreRecordFocus(null);
    setRequestedNote(ref);
    setTab("notes");
  }
  function closeRequestedNote(): void {
    const origin = recordNoteOrigin.current;
    recordNoteOrigin.current = null;
    if (origin?.widgetId !== widget.id || origin.sessionId !== selectedSession) {
      return;
    }
    setTab("stats");
    setRestoreRecordFocus(origin);
  }
  function openSettings(): void {
    setError("");
    void command("open_planner_settings", { kind: "focus-timer" }).catch((cause: unknown) =>
      setError(errorText(cause)),
    );
  }
  function openTimeline(): void {
    void command("open_planner_view", { tab: "time" }).catch((cause: unknown) =>
      setError(errorText(cause)),
    );
  }
  return {
    tab,
    setTab,
    selectedSession,
    setSelectedSession,
    requestedNote,
    setRequestedNote,
    recordNoteButton,
    usagePickerOpen,
    setUsagePickerOpen,
    openNote,
    closeRequestedNote,
    openSettings,
    openTimeline,
  };
}
