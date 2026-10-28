import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Icon } from "@comet/icon";
import { Button, Checkbox, FormField, SegmentedControl, Select, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import {
  localDay,
  number,
  record,
  rows,
  text,
  type DataRecord,
  type ToolAction,
} from "../toolData";
import type { WidgetView } from "../types";
import { clockLabel, eventEnd, eventStart, moveDay, ruleOf } from "../Planner/plannerData";
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { FrequencyRecordAction } from "./FrequencyRecordAction";
import { FocusTimerCalendar } from "./FocusTimerCalendar";
import { FocusTimerAppUsage } from "./FocusTimerAppUsage";
import { FocusTimerNotes } from "./FocusTimerNotes";
import { FocusTimerQueue } from "./FocusTimerQueue";
import { FocusTimerStats } from "./FocusTimerStats";
import { FocusTimerView } from "./FocusTimerView";
import { countdown, elapsedWithin, focusDuration, focusSessions } from "./FocusTimerData";
import * as s from "./FocusTimer.css";

type Draft = {
  title: string;
  minutes: string;
  todoId: string;
  eventRef: DataRecord | null;
  noteRef: DataRecord | null;
  memo: string;
};
type RecordNoteOrigin = { widgetId: string; sessionId: string };
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
function pendingMemo(widget: WidgetView): { memo: string; base: string; owner: string } | null {
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
      value.draft.memo === value.memoBase
    )
      return null;
    const data = record(widget.data);
    if (
      value.memoOwner === currentMemoOwner(data) ||
      !rows(data.sessions).some((session) => session.id === value.memoOwner)
    )
      return null;
    return { memo: value.draft.memo, base: value.memoBase, owner: value.memoOwner };
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

export function TimerTool({
  widget,
  widgets,
  act,
  onClose,
  busy: hostBusy = false,
  embedded = false,
  active = true,
  onCollapse,
  companionRows,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  headerActionsTarget?: HTMLElement | null;
  onClose?: () => Promise<void>;
  busy?: boolean;
  embedded?: boolean;
  active?: boolean;
  onCollapse?: () => void;
  companionRows?: (now: number) => ReactNode;
}): ReactElement {
  const busy = hostBusy || !active;
  const data = record(widget.data);
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState(() => readDraft(widget));
  const [memoBase, setMemoBase] = useState(() => readMemoBase(widget));
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
  const presentation = data.presentation === "digits" ? "digits" : "dial";
  const [custom, setCustom] = useState(() => ![15, 25, 50].includes(Number(draft.minutes)));
  const [expanded, setExpanded] = useState(!embedded);
  const [collapsed, setCollapsed] = useState(false);
  const [usagePickerOpen, setUsagePickerOpen] = useState(false);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizing = useRef(false);
  const context = useRef<HTMLElement>(null);
  const host = useRef<HTMLElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const lastFit = useRef<{ key: string; height: number } | null>(null);
  const [tab, setTab] = useState("stats");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [requestedNote, setRequestedNote] = useState<DataRecord | null>(null);
  const recordNoteOrigin = useRef<RecordNoteOrigin | null>(null);
  const recordNoteButton = useRef<HTMLButtonElement | null>(null);
  const [restoreRecordFocus, setRestoreRecordFocus] = useState<RecordNoteOrigin | null>(null);
  const [error, setError] = useState("");
  const [completingTodo, setCompletingTodo] = useState(false);
  const completingTodoLock = useRef<string | null>(null);
  const previous = useRef({ id: widget.id, draft: savedDraft(widget) });
  const saved = savedDraft(widget);
  const savedKey = JSON.stringify(saved);
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
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const next = savedDraft(widget);
    if (previous.current.id !== widget.id) {
      setDraft(readDraft(widget));
      setMemoBase(next.memo);
      setCustom(![15, 25, 50].includes(Number(next.minutes)));
    } else {
      const before = previous.current.draft;
      if (draft.memo === before.memo) setMemoBase(next.memo);
      setDraft((current) => ({
        title: current.title === before.title ? next.title : current.title,
        minutes: current.minutes === before.minutes ? next.minutes : current.minutes,
        todoId: current.todoId === before.todoId ? next.todoId : current.todoId,
        eventRef: sameReference(current.eventRef, before.eventRef)
          ? next.eventRef
          : current.eventRef,
        noteRef: sameReference(current.noteRef, before.noteRef) ? next.noteRef : current.noteRef,
        memo: current.memo === before.memo ? next.memo : current.memo,
      }));
    }
    previous.current = { id: widget.id, draft: next };
  }, [widget.id, savedKey]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `comet.focus.draft:${widget.id}`,
        JSON.stringify({ base: savedKey, draft, memoBase, memoOwner: memoOwner.current }),
      );
    } catch {
      /* Explicit save actions remain available when draft storage is unavailable. */
    }
  }, [widget.id, savedKey, draft, memoBase]);
  const status = text(data.status) || "idle";
  const idle = status === "idle";
  const completionPending = data.completedFocusPending === true;
  const rest = data.mode === "rest";
  const todo = widgets.find((item) => item.kind === "todo" && item.installed && item.enabled);
  const calendar = widgets.find(
    (item) => item.kind === "calendar" && item.installed && item.enabled,
  );
  const allTasks = rows(record(todo?.data).items);
  const tasks = allTasks.filter((item) => item.completedAt === null);
  const selectedTodoId = tasks.some((item) => item.id === draft.todoId) ? draft.todoId : "";
  const linked = allTasks.find((item) => item.id === data.todoId);
  const todoCompletionKey = `${todo?.id}:${todo?.revision}:${text(linked?.id)}`;
  const remaining = Math.max(
    0,
    idle
      ? Math.round(Number(draft.minutes) * 60000) || 0
      : status === "running"
        ? Math.min(number(data.remainingMs), number(data.deadline) - now)
        : number(data.remainingMs),
  );
  const duration = idle ? Math.round(Number(draft.minutes) * 60000) : number(data.durationMs);
  const progress = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  const sessions = focusSessions(data, now);
  const owner = currentMemoOwner(data);
  if (draft.memo === memoBase && !memoSave.current) memoOwner.current = owner;
  const previousMemoPending =
    draft.memo !== memoBase && Boolean(memoOwner.current) && memoOwner.current !== owner;
  const previousMemoSession = rows(data.sessions).find(
    (session) => session.id === memoOwner.current,
  );
  const restDuration = number(record(data.settings).restDurationMs) || 300000;
  const longRestDuration = number(record(data.settings).longRestDurationMs) || 900000;
  const queue = rows(data.queue);
  const statusLabel =
    status === "running"
      ? rest
        ? "휴식 중"
        : "집중 중"
      : status === "paused"
        ? rest
          ? "휴식 일시정지"
          : "집중 일시정지"
        : status === "finished"
          ? rest
            ? "쉬는 시간이 끝났어요."
            : "집중 시간이 끝났어요."
          : queue.length
            ? `다음 집중 '${text(queue[0].title)}'가 기다리고 있어요.`
            : "시작할 준비가 됐어요.";
  const lastSession = sessions.at(-1);
  const today = localDay(new Date(now));
  const dayStart = new Date(`${today}T00:00:00`).getTime();
  const dayEnd = new Date(`${moveDay(today, 1)}T00:00:00`).getTime();
  const todayDurations = sessions
    .map((session) => elapsedWithin(session, dayStart, dayEnd))
    .filter((elapsed) => elapsed > 0);
  const activeRestDuration = rest ? number(data.durationMs) : restDuration;
  const phase = completionPending
    ? "complete"
    : idle
      ? "ready"
      : status === "finished"
        ? rest
          ? "rest-complete"
          : "complete"
        : rest
          ? "rest"
          : "running";
  const timeDescription =
    phase === "complete"
      ? `${clockLabel(lastSession?.startedAt || now)} – ${clockLabel(lastSession?.endedAt || now)} · ${focusDuration(lastSession?.elapsedMs || 0)} 집중`
      : phase === "rest-complete"
        ? `쉬는 시간 ${focusDuration(number(data.durationMs))}이 끝났어요`
        : status === "paused"
          ? "준비되면 다시 시작해요"
          : idle
            ? `${clockLabel(now)} → ${clockLabel(now + remaining)}`
            : `${clockLabel(number(data.deadline) || now + remaining)}에 끝나요`;
  const validDuration = Number.isFinite(duration) && duration >= 1000 && duration <= 86400000;

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
        if (await act(action, { ...input, memo: draft.memo, expectedMemo: memoBase }))
          setMemoBase(draft.memo);
        else setError("메모와 타이머 변경을 저장하지 못했어요. 입력한 초안은 남아 있어요.");
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
      setMemoBase(current);
      setDraft((value) => ({ ...value, memo: current }));
      return;
    }
    setDraft((value) => ({ ...value, memo }));
  }
  async function resize(nextExpanded: boolean, nextCollapsed = false): Promise<void> {
    if (resizing.current) return;
    const animate = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    resizing.current = true;
    setResizeWidth(556);
    setExpanded(nextExpanded);
    setCollapsed(nextCollapsed);
    setError("");
    try {
      if (isDesktop() && !embedded) {
        const timerHeight =
          phase === "ready"
            ? 464
            : phase === "complete"
              ? 423
              : phase === "rest"
                ? 383
                : phase === "rest-complete"
                  ? 376
                  : 455;
        await command("set_focus_expanded", {
          id: widget.id,
          expanded: nextExpanded,
          collapsed: nextCollapsed,
          height: nextCollapsed
            ? 56
            : nextExpanded
              ? Math.max(tab === "notes" ? 547 : 580, timerHeight)
              : timerHeight,
          animate,
        });
      } else if (animate) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      }
    } catch (cause: unknown) {
      setExpanded(expanded);
      setCollapsed(collapsed);
      setError(errorText(cause));
    } finally {
      resizing.current = false;
      setResizeWidth(null);
    }
  }
  function expand(): Promise<void> {
    return resize(!expanded);
  }
  useEffect(() => {
    if (!active || embedded || collapsed || !isDesktop() || typeof ResizeObserver === "undefined")
      return;
    const element = layout.current;
    if (!element) return;
    let alive = true;
    let scheduled: number | undefined;
    function fit(): void {
      if (!alive || resizing.current || !element || !host.current) return;
      const offset = element.getBoundingClientRect().top - host.current.getBoundingClientRect().top;
      const height = Math.ceil(
        Math.max(
          expanded ? (tab === "notes" ? 547 : 580) : 376,
          offset + host.current.scrollTop + element.scrollHeight,
        ),
      );
      const key = `${widget.id}:${expanded}:${height}`;
      const allocated = lastFit.current;
      const canShrink = allocated && Math.abs(window.innerHeight - allocated.height) < 2;
      if (
        height === window.innerHeight ||
        (height < window.innerHeight && !canShrink) ||
        allocated?.key === key
      )
        return;
      lastFit.current = { key, height };
      void command("set_focus_expanded", {
        id: widget.id,
        expanded,
        collapsed: false,
        height,
        animate: false,
        autoFit: true,
      }).catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      });
    }
    const schedule = (): void => {
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      scheduled = window.setTimeout(fit, 0);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (context.current) observer.observe(context.current);
    schedule();
    return () => {
      alive = false;
      observer.disconnect();
      if (scheduled !== undefined) window.clearTimeout(scheduled);
    };
  }, [active, embedded, collapsed, expanded, tab, phase, usagePickerOpen, resizeWidth, widget.id]);
  function openSettings(): void {
    setError("");
    void command("open_planner_settings", { kind: "focus-timer" }).catch((cause: unknown) =>
      setError(errorText(cause)),
    );
  }
  return (
    <section
      ref={host}
      className={s.root}
      aria-label="집중 타이머"
      data-window-resizing={resizeWidth !== null}
    >
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
      <div
        ref={layout}
        className={s.layout}
        data-expanded={expanded}
        data-embedded={embedded}
        data-collapsed={collapsed}
        data-resizing={resizeWidth !== null}
      >
        <div className={s.timer}>
          <FocusTimerView
            wide={expanded || embedded}
            busy={busy}
            collapsed={collapsed}
            resizing={resizeWidth !== null}
            recordsOpen={expanded}
            custom={custom}
            pickerOpen={usagePickerOpen}
            onCollapse={() => {
              if (onCollapse) onCollapse();
              else void resize(expanded, true);
            }}
            onExpand={() => void resize(false)}
            onRecords={() => void expand()}
            onSettings={openSettings}
            onCloseWidget={onClose ? () => void onClose() : undefined}
            aria-label="타이머 조작"
            phase={phase}
            presentation={presentation}
            task={
              idle ? draft.title : text(data.title) || text(linked?.title) || "나만의 집중 시간"
            }
            time={countdown(remaining)}
            timeDescription={timeDescription}
            progress={progress}
            duration={Number(draft.minutes)}
            startDisabled={!validDuration && !(phase === "rest-complete" && queue.length > 0)}
            paused={status === "paused"}
            onTaskChange={(title) => setDraft({ ...draft, title })}
            onDurationChange={(minutes) => {
              if (minutes === 0) {
                setCustom(true);
                return;
              }
              setDraft({ ...draft, minutes: String(minutes) });
              setCustom(false);
            }}
            onStart={() => {
              if (idle) void start();
              else void transition("continue");
            }}
            onPause={() => void act(status === "paused" ? "resume" : "pause")}
            onStop={() => void transition("cancel")}
            onContinue={() => void transition("continue")}
            onSkipRest={() => void transition("continue")}
            onRest={
              phase === "complete" && !completionPending ? () => void transition("rest") : undefined
            }
            restLabel={`${focusDuration(restDuration)} 쉬기`}
            onLongRest={
              phase === "complete" && !completionPending
                ? () => void transition("rest", { kind: "long" })
                : undefined
            }
            longRestLabel={`길게 쉬기 (${focusDuration(longRestDuration)})`}
            nextTitle={text(queue[0]?.title)}
            note={draft.memo}
            noteLabel={previousMemoPending ? "이전 집중 메모" : "완료한 집중 메모"}
            onNoteChange={changeMemo}
            setup={
              <>
                <details className={s.sessionOptions}>
                  <summary>이번 집중 연결</summary>
                  <div>
                    {todo && (
                      <FormField label="연결할 할 일" className={s.inlineField}>
                        <Select
                          fill
                          value={selectedTodoId}
                          disabled={busy}
                          onChange={(event) => setDraft({ ...draft, todoId: event.target.value })}
                        >
                          <option value="">연결하지 않음</option>
                          {tasks.map((task) => (
                            <option key={text(task.id)} value={text(task.id)}>
                              {text(task.title)}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    )}
                    <div className={s.row}>
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setTab("calendar");
                          if (!expanded) void expand();
                        }}
                      >
                        캘린더 일정 연결
                      </Button>
                      <Button
                        variant="ghost"
                        size="small"
                        disabled={busy}
                        onClick={() => setUsagePickerOpen(true)}
                      >
                        프로그램 사용 시간
                      </Button>
                    </div>
                  </div>
                </details>
                {custom && (
                  <FormField label="집중 시간 (분)" className={s.inlineField}>
                    <TextInput
                      fill
                      type="number"
                      min="0.02"
                      max="1440"
                      step="0.01"
                      value={draft.minutes}
                      onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
                    />
                  </FormField>
                )}
              </>
            }
            linked={
              idle ? (
                <>
                  {draft.eventRef ? (
                    <div className={s.linkedChip}>
                      <Icon name="calendar" size={13} />
                      <span>일정 · {text(draft.eventRef.title)}</span>
                      <Button
                        variant="ghost"
                        size="small"
                        aria-label="일정 연결 해제"
                        onClick={async () => {
                          if (await configure({ eventRef: null }))
                            setDraft({ ...draft, eventRef: null });
                        }}
                      >
                        ×
                      </Button>
                    </div>
                  ) : selectedTodoId ? (
                    <div className={s.linkedChip}>
                      <Icon name="todo" size={13} />
                      <span>{text(tasks.find((task) => task.id === selectedTodoId)?.title)}</span>
                      <Button
                        variant="ghost"
                        size="small"
                        aria-label="할 일 연결 해제"
                        onClick={() => setDraft({ ...draft, todoId: "" })}
                      >
                        ×
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : undefined
            }
            completion={
              phase === "complete" && linked && todo ? (
                ruleOf(linked).mode === "frequency" ? (
                  <FrequencyRecordAction
                    key={`${todo.id}:${text(linked.id)}:${text(ruleOf(linked).timeZone)}`}
                    item={linked}
                    todo={todo}
                    now={now}
                    act={act}
                  />
                ) : (
                  <Checkbox
                    label={`${text(linked.title)} 완료로 표시`}
                    checked={typeof linked.completedAt === "number"}
                    disabled={
                      completingTodo ||
                      completingTodoLock.current === todoCompletionKey ||
                      typeof linked.completedAt === "number"
                    }
                    onChange={async (event) => {
                      if (
                        !event.currentTarget.checked ||
                        event.currentTarget.disabled ||
                        typeof linked.completedAt === "number" ||
                        completingTodoLock.current === todoCompletionKey
                      ) {
                        return;
                      }
                      completingTodoLock.current = todoCompletionKey;
                      setCompletingTodo(true);
                      setError("");
                      let saved = false;
                      try {
                        saved = await act("complete", { id: text(linked.id) }, todo);
                        if (!saved) {
                          setError("할 일을 완료로 표시하지 못했어요. 다시 시도해 주세요.");
                        }
                      } catch (cause: unknown) {
                        setError(errorText(cause));
                      } finally {
                        if (!saved && completingTodoLock.current === todoCompletionKey) {
                          completingTodoLock.current = null;
                        }
                        setCompletingTodo(false);
                      }
                    }}
                  />
                )
              ) : undefined
            }
            summary={
              completionPending ? (
                <Button
                  className={s.restSummary}
                  variant="ghost"
                  onClick={() => void transition("show-rest")}
                >
                  휴식 {focusDuration(activeRestDuration)} 시작 ·{" "}
                  {clockLabel(number(data.deadline) || now + remaining)}까지
                </Button>
              ) : phase === "rest-complete" ? (
                <div className={s.todaySummary}>
                  <span>오늘 집중</span>
                  <span className={s.todaySummaryValue}>
                    {todayDurations.length}번 ·{" "}
                    {focusDuration(todayDurations.reduce((total, elapsed) => total + elapsed, 0))}
                  </span>
                </div>
              ) : undefined
            }
            afterControls={
              <>
                {previousMemoPending && (
                  <div className={s.row}>
                    <p className={s.quiet}>이전 집중의 저장하지 않은 메모가 있어요.</p>
                    <Button variant="ghost" size="small" onClick={() => void saveMemo()}>
                      이전 집중 메모 저장
                    </Button>
                  </div>
                )}
                {status !== "running" && queue.length > 0 && (
                  <p className={s.quiet}>다음 집중 '{text(queue[0].title)}'가 기다리고 있어요.</p>
                )}
                <p className={s.timerStatus} role="status">
                  {statusLabel}
                </p>
                <FocusTimerAppUsage
                  key={widget.id}
                  data={data}
                  act={act}
                  onPickerChange={setUsagePickerOpen}
                  pickerOpen={usagePickerOpen}
                  hideUnconfigured
                />
              </>
            }
          />
          {expanded && !collapsed && !embedded && companionRows && (
            <fieldset className={s.companionRows} disabled={busy} aria-label="다른 바탕화면 위젯">
              {companionRows(now)}
            </fieldset>
          )}
        </div>
        <aside
          ref={context}
          className={s.context}
          aria-label="일정과 집중 기록"
          tabIndex={-1}
          inert={!expanded}
        >
          <fieldset disabled={busy} className={s.controlFields}>
            <SegmentedControl
              label="집중 패널"
              value={tab}
              options={[
                { value: "calendar", label: "일정" },
                { value: "stats", label: "기록" },
                { value: "notes", label: "노트" },
                { value: "queue", label: "다음 집중" },
              ]}
              onValueChange={setTab}
            />
            {tab === "queue" && (
              <FocusTimerQueue data={data} tasks={tasks} act={act} defaultMinutes={draft.minutes} />
            )}
            {tab === "calendar" && (
              <div className={s.tabPanel}>
                <Button variant="ghost" size="small" onClick={() => setTab("stats")}>
                  집중 기록으로
                </Button>
                <FocusTimerCalendar
                  calendar={calendar}
                  act={act}
                  canPrepare={idle}
                  title={draft.title}
                  durationMs={Math.round(Number(draft.minutes) * 60000)}
                  noteRef={draft.noteRef}
                  linkedEvent={draft.eventRef}
                  sessions={sessions}
                  onPrepare={prepareEvent}
                  onSession={(session) => {
                    setSelectedSession(session.id);
                    setTab("stats");
                  }}
                />
              </div>
            )}
            {tab === "stats" && (
              <div className={s.tabPanel}>
                <FocusTimerStats
                  hideTabs
                  sessions={sessions}
                  day={localDay(new Date(now))}
                  selectedId={selectedSession}
                  noteButtonRef={recordNoteButton}
                  onSelect={setSelectedSession}
                  onNotes={() => setTab("notes")}
                  onClose={() => void resize(false)}
                  onOpenTimeline={() =>
                    void command("open_planner_view", { tab: "time" }).catch((cause: unknown) =>
                      setError(errorText(cause)),
                    )
                  }
                  act={act}
                  onOpenNote={(ref) => {
                    recordNoteOrigin.current = selectedSession
                      ? { widgetId: widget.id, sessionId: selectedSession }
                      : null;
                    setRestoreRecordFocus(null);
                    setRequestedNote(ref);
                    setTab("notes");
                  }}
                />
              </div>
            )}
            {tab === "notes" && (
              <div className={s.tabPanel}>
                <FocusTimerNotes
                  hideTabs
                  active={active}
                  widgets={widgets}
                  noteRef={draft.noteRef}
                  memo={draft.memo}
                  memoBase={memoBase}
                  sessionLabel={previousMemoPending ? "이전 집중" : undefined}
                  sessionTitle={
                    previousMemoPending
                      ? text(previousMemoSession?.title)
                      : idle
                        ? draft.title
                        : text(data.title)
                  }
                  sessionTime={previousMemoPending ? undefined : countdown(remaining)}
                  act={act}
                  onClose={() => void resize(false)}
                  memoConflict={
                    draft.memo !== memoBase &&
                    (previousMemoPending
                      ? !previousMemoSession || text(previousMemoSession.memo) !== memoBase
                      : text(data.memo) !== memoBase)
                  }
                  onReloadMemo={() => {
                    const memo = text(data.memo);
                    setDraft({ ...draft, memo });
                    setMemoBase(memo);
                    if (previousMemoPending) memoOwner.current = owner;
                    setError("");
                  }}
                  canConnect={idle && active}
                  requested={requestedNote}
                  onRequestedHandled={() => setRequestedNote(null)}
                  onRequestedNoteClose={() => {
                    const origin = recordNoteOrigin.current;
                    recordNoteOrigin.current = null;
                    if (origin?.widgetId !== widget.id || origin.sessionId !== selectedSession) {
                      return;
                    }
                    setTab("stats");
                    setRestoreRecordFocus(origin);
                  }}
                  onConnect={connectNote}
                  onMemoChange={changeMemo}
                  onSaveMemo={saveMemo}
                  onRecords={() => setTab("stats")}
                />
              </div>
            )}
          </fieldset>
        </aside>
      </div>
    </section>
  );
}
