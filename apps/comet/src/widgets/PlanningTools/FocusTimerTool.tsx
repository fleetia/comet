import { Button, FormField, IconButton, Select, TextField } from "../../ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@comet/icon";
import { Checkbox, FocusTimerWidget, SegmentedControl } from "@comet/ui";
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
import { FocusTimerSettings } from "./FocusTimerSettings";
import { FocusTimerStats } from "./FocusTimerStats";
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
function readDraft(widget: WidgetView): Draft {
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
      return saved;
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

function ToolbarIcon({
  name,
}: {
  name: "bell" | "settings" | "expand" | "collapse";
}): ReactElement {
  return (
    <Icon
      name={
        name === "collapse"
          ? "chevleft"
          : name === "expand"
            ? "chev"
            : name === "settings"
              ? "gear"
              : name
      }
      size={16}
    />
  );
}

export function TimerTool({
  widget,
  widgets,
  act,
  headerActionsTarget,
  onSettingsDirtyChange,
  onSettingsBusyChange,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  headerActionsTarget?: HTMLElement | null;
  onSettingsDirtyChange?: (dirty: boolean) => void;
  onSettingsBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const data = record(widget.data);
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState(() => readDraft(widget));
  const [memoBase, setMemoBase] = useState(() => readMemoBase(widget));
  const memoSave = useRef<{ memo: string; promise: Promise<boolean> } | null>(null);
  const [presentation, setPresentation] = useState<"dial" | "digits">(
    data.presentation === "digits" ? "digits" : "dial",
  );
  const [custom, setCustom] = useState(() => ![15, 25, 50].includes(Number(draft.minutes)));
  const [expanded, setExpanded] = useState(true);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizing = useRef(false);
  const context = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState("stats");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [requestedNote, setRequestedNote] = useState<DataRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [completingTodo, setCompletingTodo] = useState(false);
  const completingTodoLock = useRef<string | null>(null);
  const previous = useRef({ id: widget.id, draft: savedDraft(widget) });
  const saved = savedDraft(widget);
  const savedKey = JSON.stringify(saved);
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
        eventRef:
          JSON.stringify(current.eventRef) === JSON.stringify(before.eventRef)
            ? next.eventRef
            : current.eventRef,
        noteRef:
          JSON.stringify(current.noteRef) === JSON.stringify(before.noteRef)
            ? next.noteRef
            : current.noteRef,
        memo: current.memo === before.memo ? next.memo : current.memo,
      }));
    }
    previous.current = { id: widget.id, draft: next };
  }, [widget.id, savedKey]);
  useEffect(() => {
    setPresentation(data.presentation === "digits" ? "digits" : "dial");
  }, [widget.id, data.presentation]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `comet.focus.draft:${widget.id}`,
        JSON.stringify({ base: savedKey, draft, memoBase }),
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
  const restDuration = number(record(data.settings).restDurationMs) || 300000;
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
    if (draft.memo || text(data.memo)) input.memo = draft.memo;
    await act("start", input);
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
  async function transition(action: string): Promise<void> {
    setError("");
    try {
      if (draft.memo !== memoBase) {
        if (await act(action, { memo: draft.memo, expectedMemo: memoBase }))
          setMemoBase(draft.memo);
        else setError("메모와 타이머 변경을 저장하지 못했어요. 입력한 초안은 남아 있어요.");
      } else {
        await act(action);
      }
    } catch (cause: unknown) {
      setError(errorText(cause));
    }
  }
  async function expand(): Promise<void> {
    if (resizing.current) {
      return;
    }
    const next = !expanded;
    const animate = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    resizing.current = true;
    setResizeWidth(next ? 392 : (context.current?.getBoundingClientRect().width ?? 392));
    setExpanded(next);
    setError("");
    try {
      if (isDesktop()) {
        await command("set_focus_expanded", { id: widget.id, expanded: next, animate });
      } else if (animate) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      }
    } catch (cause: unknown) {
      setExpanded(expanded);
      setError(errorText(cause));
    } finally {
      resizing.current = false;
      setResizeWidth(null);
    }
  }
  async function previewAlarm(): Promise<void> {
    setError("");
    setNotice("");
    try {
      await command("preview_planner_notification");
      setNotice("OS에 미리보기 알림을 보냈어요.");
    } catch (cause: unknown) {
      setError(errorText(cause));
    }
  }
  const headerActions = (
    <div className={s.toolbar}>
      <SegmentedControl
        label="타이머 표시 방식"
        value={presentation}
        options={[
          { value: "dial", label: "고리" },
          { value: "digits", label: "숫자" },
        ]}
        onValueChange={async (mode) => {
          if ((mode === "dial" || mode === "digits") && (await configure({ presentation: mode })))
            setPresentation(mode);
        }}
      />
      <IconButton
        label="알람 미리보기"
        variant="quiet"
        size="compact"
        onClick={() => void previewAlarm()}
      >
        <ToolbarIcon name="bell" />
      </IconButton>
      <IconButton
        label="집중 설정"
        variant="quiet"
        size="compact"
        onClick={() => setSettingsOpen(true)}
      >
        <ToolbarIcon name="settings" />
      </IconButton>
      <Button
        variant="quiet"
        size="compact"
        disabled={resizeWidth !== null}
        onClick={() => void expand()}
      >
        <ToolbarIcon name={expanded ? "collapse" : "expand"} />
        {expanded ? "작게 보기" : "펼쳐 보기"}
      </Button>
    </div>
  );
  return (
    <section
      className={s.root}
      aria-label="집중 타이머"
      data-window-resizing={resizeWidth !== null}
    >
      {headerActionsTarget && createPortal(headerActions, headerActionsTarget)}
      {headerActionsTarget === undefined && headerActions}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notice && <p className={s.notice}>{notice}</p>}
      {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
      <div className={s.layout} data-expanded={expanded} data-resizing={resizeWidth !== null}>
        <FocusTimerWidget
          className={s.timer}
          aria-label="타이머 조작"
          phase={phase}
          presentation={presentation}
          task={idle ? draft.title : text(data.title) || text(linked?.title) || "나만의 집중 시간"}
          taskInputLabel="무엇에 집중할까요?"
          time={countdown(remaining)}
          timeDescription={timeDescription}
          progress={progress}
          duration={Number(draft.minutes)}
          startDisabled={!validDuration}
          paused={status === "paused"}
          onTaskChange={(title) => setDraft({ ...draft, title })}
          onDurationChange={(minutes) => {
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
          note={draft.memo}
          noteLabel="완료한 집중 메모"
          onNoteChange={(memo) => setDraft({ ...draft, memo })}
          customDuration={
            <Button
              variant="quiet"
              size="compact"
              aria-pressed={custom}
              onClick={() => setCustom(true)}
            >
              직접
            </Button>
          }
          setup={
            <>
              {custom && (
                <FormField label="집중 시간 (분)" className={s.inlineField}>
                  <TextField
                    type="number"
                    min="0.02"
                    max="1440"
                    step="0.01"
                    value={draft.minutes}
                    onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
                  />
                </FormField>
              )}
              {todo && (
                <FormField label="연결할 할 일">
                  <Select
                    value={selectedTodoId}
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
            </>
          }
          completion={
            idle ? (
              <>
                {draft.eventRef ? (
                  <div className={s.related}>
                    <span>일정 · {text(draft.eventRef.title)}</span>
                    <Button
                      variant="quiet"
                      size="compact"
                      aria-label="일정 연결 해제"
                      onClick={async () => {
                        if (await configure({ eventRef: null }))
                          setDraft({ ...draft, eventRef: null });
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ) : (
                  <Button
                    className={s.optionalSetup}
                    variant="quiet"
                    size="compact"
                    onClick={() => {
                      setTab("calendar");
                      if (!expanded) void expand();
                    }}
                  >
                    캘린더 일정 연결
                  </Button>
                )}
              </>
            ) : phase === "complete" && linked && todo ? (
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
              <Button variant="quiet" onClick={() => void transition("show-rest")}>
                휴식 {focusDuration(activeRestDuration)} 시작 ·{" "}
                {clockLabel(number(data.deadline) || now + remaining)}까지
              </Button>
            ) : phase === "rest-complete" ? (
              <p className={s.quiet}>
                오늘 집중 · {todayDurations.length}번 ·{" "}
                {focusDuration(todayDurations.reduce((total, elapsed) => total + elapsed, 0))}
              </p>
            ) : undefined
          }
          afterControls={
            <>
              <p className={s.timerStatus} role="status">
                {statusLabel}
              </p>
              <FocusTimerAppUsage key={widget.id} data={data} act={act} />
            </>
          }
        />
        <aside
          ref={context}
          className={s.context}
          aria-label="일정과 집중 기록"
          inert={!expanded}
          style={resizeWidth === null ? undefined : { width: resizeWidth }}
        >
          {tab === "calendar" && (
            <div className={s.tabPanel}>
              <Button variant="quiet" size="compact" onClick={() => setTab("stats")}>
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
                sessions={sessions}
                day={localDay(new Date(now))}
                selectedId={selectedSession}
                onSelect={setSelectedSession}
                onNotes={() => setTab("notes")}
                act={act}
                onOpenNote={(ref) => {
                  setRequestedNote(ref);
                  setTab("notes");
                }}
              />
            </div>
          )}
          {tab === "notes" && (
            <div className={s.tabPanel}>
              <FocusTimerNotes
                widgets={widgets}
                noteRef={draft.noteRef}
                memo={draft.memo}
                memoConflict={draft.memo !== memoBase && text(data.memo) !== memoBase}
                onReloadMemo={() => {
                  setDraft({ ...draft, memo: text(data.memo) });
                  setMemoBase(text(data.memo));
                  setError("");
                }}
                canConnect={idle}
                requested={requestedNote}
                onRequestedHandled={() => setRequestedNote(null)}
                onConnect={connectNote}
                onMemoChange={(memo) => setDraft({ ...draft, memo })}
                onSaveMemo={saveMemo}
                onRecords={() => setTab("stats")}
              />
            </div>
          )}
        </aside>
      </div>
      {settingsOpen && (
        <FocusTimerSettings
          widget={widget}
          calendar={calendar}
          act={act}
          onClose={() => setSettingsOpen(false)}
          onDirtyChange={onSettingsDirtyChange}
          onBusyChange={onSettingsBusyChange}
        />
      )}
    </section>
  );
}
