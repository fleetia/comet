import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { errorText } from "../../hooks/useSnapshot";
import { number, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { eventEnd, eventStart } from "../Planner/plannerData";
import { focusTimerState, type Draft, type FocusTimerState } from "./focusTimerState";

function sameReference(left: DataRecord | null, right: DataRecord | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
  );
}
function savedDraft(widget: WidgetView): Draft {
  const data = record(widget.data);
  const duration =
    number(data.focusDurationMs) || (data.mode !== "rest" ? number(data.durationMs) : 0) || 1500000;
  return {
    title: text(data.title),
    minutes: String(duration / 60000),
    todoId: text(data.todoId),
    eventRef: text(record(data.eventRef).id) ? record(data.eventRef) : null,
    noteRef: text(record(data.noteRef).id) ? record(data.noteRef) : null,
    memo: text(data.memo),
  };
}
function pendingMemo(
  widget: WidgetView,
): { memo: string; base: string; owner: string; show: boolean } | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`comet.focus.draft:${widget.id}`) || "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("draft" in value) ||
      !value.draft ||
      typeof value.draft !== "object" ||
      !("memo" in value.draft) ||
      typeof value.draft.memo !== "string" ||
      !("memoBase" in value) ||
      typeof value.memoBase !== "string" ||
      !("memoOwner" in value) ||
      typeof value.memoOwner !== "string" ||
      !value.memoOwner ||
      (value.draft.memo === value.memoBase &&
        !("showPreviousMemo" in value && value.showPreviousMemo === true))
    )
      return null;
    const data = record(widget.data);
    if (
      value.memoOwner === currentMemoOwner(data) ||
      !rows(data.sessions).some((session) => session.id === value.memoOwner)
    )
      return null;
    return {
      memo: value.draft.memo,
      base: value.memoBase,
      owner: value.memoOwner,
      show: "showPreviousMemo" in value && value.showPreviousMemo === true,
    };
  } catch {
    return null;
  }
}
export function readDraft(widget: WidgetView): Draft {
  const saved = savedDraft(widget);
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`comet.focus.draft:${widget.id}`) || "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("base" in value) ||
      value.base !== JSON.stringify(saved) ||
      !("draft" in value) ||
      !value.draft ||
      typeof value.draft !== "object"
    )
      return { ...saved, memo: pendingMemo(widget)?.memo ?? saved.memo };
    const draft = value.draft;
    if (
      !("title" in draft) ||
      typeof draft.title !== "string" ||
      !("minutes" in draft) ||
      typeof draft.minutes !== "string" ||
      !("todoId" in draft) ||
      typeof draft.todoId !== "string" ||
      !("memo" in draft) ||
      typeof draft.memo !== "string"
    )
      return saved;
    return {
      ...saved,
      title: draft.title,
      minutes: draft.minutes,
      todoId: draft.todoId,
      memo: draft.memo,
    };
  } catch {
    return saved;
  }
}
function readMemoBase(widget: WidgetView): string {
  const pending = pendingMemo(widget);
  if (pending) return pending.base;
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`comet.focus.draft:${widget.id}`) || "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "base" in value &&
      value.base === JSON.stringify(savedDraft(widget)) &&
      "memoBase" in value &&
      typeof value.memoBase === "string"
    )
      return value.memoBase;
  } catch {
    /* The current source is the fallback baseline. */
  }
  return text(record(widget.data).memo);
}
function currentMemoOwner(data: DataRecord): string {
  return data.status === "idle"
    ? ""
    : text(record(data.activeSession).id) || text(rows(data.sessions).at(-1)?.id);
}
function readMemoOwner(widget: WidgetView): string {
  const pending = pendingMemo(widget);
  if (pending) return pending.owner;
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`comet.focus.draft:${widget.id}`) || "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "base" in value &&
      value.base === JSON.stringify(savedDraft(widget)) &&
      "memoOwner" in value &&
      typeof value.memoOwner === "string"
    )
      return value.memoOwner;
  } catch {
    /* The current session is the fallback owner. */
  }
  return currentMemoOwner(record(widget.data));
}

export type FocusTimerSession = {
  data: DataRecord;
  now: number;
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  memoBase: string;
  custom: boolean;
  setCustom: Dispatch<SetStateAction<boolean>>;
  timer: FocusTimerState;
  previousMemoPending: boolean;
  previousMemoSession: DataRecord | undefined;
  configure: (patch: DataRecord) => Promise<boolean>;
  start: () => Promise<void>;
  prepareEvent: (event: DataRecord) => Promise<boolean>;
  connectNote: (noteRef: DataRecord | null) => Promise<boolean>;
  saveMemo: () => Promise<boolean>;
  transition: (action: string, input?: DataRecord) => Promise<void>;
  changeMemo: (memo: string) => void;
  reloadMemo: () => void;
};

export function useFocusTimerSession(
  widget: WidgetView,
  widgets: WidgetView[],
  act: ToolAction,
  now: number,
  setError: Dispatch<SetStateAction<string>>,
): FocusTimerSession {
  const data = record(widget.data);
  const [draft, setDraft] = useState(() => readDraft(widget));
  const [memoBase, setMemoBase] = useState(() => readMemoBase(widget));
  const [showPreviousMemo, setShowPreviousMemo] = useState(
    () => pendingMemo(widget)?.show ?? false,
  );
  const memoSave = useRef<{ memo: string; promise: Promise<boolean> } | null>(null);
  const memoOwner = useRef(readMemoOwner(widget));
  const memoWidget = useRef(widget.id);
  if (memoWidget.current !== widget.id) {
    memoWidget.current = widget.id;
    memoOwner.current = readMemoOwner(widget);
  }
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const latestData = useRef(data);
  latestData.current = data;
  const [custom, setCustom] = useState(() => ![15, 25, 50].includes(Number(draft.minutes)));
  const previous = useRef({ id: widget.id, draft: savedDraft(widget) });
  const saved = savedDraft(widget);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    const next = savedDraft(widget);
    if (previous.current.id !== widget.id) {
      setDraft(readDraft(widget));
      setMemoBase(readMemoBase(widget));
      setShowPreviousMemo(pendingMemo(widget)?.show ?? false);
      setCustom(![15, 25, 50].includes(Number(next.minutes)));
    } else {
      const before = previous.current.draft;
      if (!showPreviousMemo && draft.memo === before.memo) setMemoBase(next.memo);
      setDraft((current) => ({
        title: current.title === before.title ? next.title : current.title,
        minutes: current.minutes === before.minutes ? next.minutes : current.minutes,
        todoId: current.todoId === before.todoId ? next.todoId : current.todoId,
        eventRef: sameReference(current.eventRef, before.eventRef)
          ? next.eventRef
          : current.eventRef,
        noteRef: sameReference(current.noteRef, before.noteRef) ? next.noteRef : current.noteRef,
        memo: !showPreviousMemo && current.memo === before.memo ? next.memo : current.memo,
      }));
    }
    previous.current = { id: widget.id, draft: next };
  }, [widget.id, savedKey]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `comet.focus.draft:${widget.id}`,
        JSON.stringify({
          base: savedKey,
          draft,
          memoBase,
          memoOwner: memoOwner.current,
          showPreviousMemo,
        }),
      );
    } catch {
      /* Explicit save actions remain available when draft storage is unavailable. */
    }
  }, [widget.id, savedKey, draft, memoBase, showPreviousMemo]);
  const timer = focusTimerState(data, draft, now, widgets);
  const { idle, calendar, selectedTodoId } = timer;
  const owner = currentMemoOwner(data);
  if (draft.memo === memoBase && !memoSave.current && !showPreviousMemo) memoOwner.current = owner;
  const previousMemoPending =
    (draft.memo !== memoBase || showPreviousMemo) &&
    Boolean(memoOwner.current) &&
    memoOwner.current !== owner;
  const previousMemoSession = rows(data.sessions).find(
    (session) => session.id === memoOwner.current,
  );

  async function configure(patch: DataRecord): Promise<boolean> {
    setError("");
    try {
      return await act("configure", patch);
    } catch (cause: unknown) {
      setError(errorText(cause));
      return false;
    }
  }
  async function start(): Promise<void> {
    const input: DataRecord = {
      durationMs: Math.round(Number(draft.minutes) * 60000),
      todoId: selectedTodoId || null,
    };
    if (draft.title || text(data.title)) input.title = draft.title;
    if (draft.eventRef || data.eventRef) input.eventRef = draft.eventRef;
    if (draft.noteRef || data.noteRef) input.noteRef = draft.noteRef;
    if (!previousMemoPending && (draft.memo || text(data.memo))) input.memo = draft.memo;
    if ((await act("start", input)) && !previousMemoPending) setMemoBase(draft.memo);
  }
  async function prepareEvent(event: DataRecord): Promise<boolean> {
    if (!idle || !calendar) return false;
    const startAt = eventStart(event),
      endAt = eventEnd(event);
    const minutes = event.allDay
      ? Number(draft.minutes)
      : Math.max(1, Math.ceil((endAt - Math.max(now, startAt)) / 60000));
    const eventRef: DataRecord = {
      calendarWidgetId: calendar.id,
      id: text(event.id),
      title: text(event.title),
      startAt: typeof event.startAt === "number" ? event.startAt : null,
      endAt: typeof event.endAt === "number" ? event.endAt : null,
      connectionId: text(event.connectionId),
      sourceId: text(event.sourceId),
      occurrenceId: text(event.occurrenceId),
    };
    const noteRef = text(record(event.noteRef).id) ? record(event.noteRef) : null;
    const patch = {
      title: text(event.title),
      durationMs: Math.min(1440, minutes) * 60000,
      eventRef,
      noteRef,
    };
    if (!(await configure(patch))) return false;
    setDraft((current) => ({
      ...current,
      title: text(event.title),
      minutes: String(Math.min(1440, minutes)),
      eventRef,
      noteRef,
    }));
    setCustom(![15, 25, 50].includes(minutes));
    return true;
  }
  async function connectNote(noteRef: DataRecord | null): Promise<boolean> {
    if (!idle || !(await configure({ noteRef }))) return false;
    setDraft((current) => ({ ...current, noteRef }));
    return true;
  }
  async function saveMemo(): Promise<boolean> {
    if (memoSave.current) {
      if (memoSave.current.memo !== draft.memo) return false;
      return memoSave.current.promise;
    }
    if (previousMemoPending) {
      if (!memoOwner.current) {
        setError("이전 집중의 메모를 저장할 기록을 찾을 수 없어요. 초안은 남아 있어요.");
        return false;
      }
      const promise = (async (): Promise<boolean> => {
        try {
          const ok = await act("update-session-memo", {
            id: memoOwner.current,
            memo: draft.memo,
            expectedMemo: memoBase,
          });
          if (memoWidget.current !== widget.id) return ok;
          if (ok) {
            if (latestDraft.current.memo === draft.memo) {
              const nextMemo = text(latestData.current.memo);
              setDraft((current) => ({ ...current, memo: nextMemo }));
              setMemoBase(nextMemo);
              memoOwner.current = currentMemoOwner(latestData.current);
              setShowPreviousMemo(false);
            } else {
              setMemoBase(draft.memo);
            }
            setError("");
          } else setError("이전 집중 메모를 저장하지 못했어요. 입력한 초안은 남아 있어요.");
          return ok;
        } catch (cause: unknown) {
          setError(errorText(cause));
          return false;
        } finally {
          memoSave.current = null;
        }
      })();
      memoSave.current = { memo: draft.memo, promise };
      return promise;
    }
    if (draft.memo !== memoBase && text(data.memo) !== memoBase) {
      setError("다른 화면에서 집중 메모가 바뀌었어요. 입력한 초안은 남아 있어요.");
      return false;
    }
    const promise = (async (): Promise<boolean> => {
      try {
        const ok = idle
          ? await configure({ memo: draft.memo })
          : await act("update-memo", { memo: draft.memo, expectedMemo: memoBase });
        if (ok) setMemoBase(draft.memo);
        return ok;
      } catch (cause: unknown) {
        setError(errorText(cause));
        return false;
      } finally {
        memoSave.current = null;
      }
    })();
    memoSave.current = { memo: draft.memo, promise };
    return promise;
  }
  async function transition(action: string, input: DataRecord = {}): Promise<void> {
    setError("");
    try {
      if (previousMemoPending) {
        await act(action, input);
      } else if (draft.memo !== memoBase) {
        if (await act(action, { ...input, memo: draft.memo, expectedMemo: memoBase })) {
          if (
            action === "continue" &&
            rows(data.queue).length > 0 &&
            latestDraft.current.memo === draft.memo
          ) {
            setDraft((current) => ({ ...current, memo: "" }));
            setMemoBase("");
          } else {
            setMemoBase(draft.memo);
          }
        } else setError("메모와 타이머 변경을 저장하지 못했어요. 입력한 초안은 남아 있어요.");
      } else {
        await act(action, input);
      }
    } catch (cause: unknown) {
      setError(errorText(cause));
    }
  }
  function changeMemo(memo: string): void {
    if (previousMemoPending && memo === memoBase) {
      const current = text(data.memo);
      memoOwner.current = owner;
      setShowPreviousMemo(false);
      setMemoBase(current);
      setDraft((value) => ({ ...value, memo: current }));
      return;
    }
    setDraft((value) => ({ ...value, memo }));
  }
  function reloadMemo(): void {
    if (previousMemoPending && !previousMemoSession) {
      setError("이전 집중 기록을 찾지 못했어요. 입력한 초안은 남아 있어요.");
      return;
    }
    const memo = previousMemoPending ? text(previousMemoSession?.memo) : text(data.memo);
    setDraft({ ...draft, memo });
    setMemoBase(memo);
    setShowPreviousMemo(previousMemoPending);
    setError("");
  }

  return {
    data,
    now,
    draft,
    setDraft,
    memoBase,
    custom,
    setCustom,
    timer,
    previousMemoPending,
    previousMemoSession,
    configure,
    start,
    prepareEvent,
    connectNote,
    saveMemo,
    transition,
    changeMemo,
    reloadMemo,
  };
}
