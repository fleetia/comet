import {
  Button,
  FormField,
  IconButton,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
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
import { clockLabel, eventEnd, eventStart, ruleOf } from "../Planner/plannerData";
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { FrequencyRecordAction } from "./FrequencyRecordAction";
import { FocusTimerCalendar } from "./FocusTimerCalendar";
import { FocusTimerAppUsage } from "./FocusTimerAppUsage";
import { FocusTimerNotes } from "./FocusTimerNotes";
import { FocusTimerSettings } from "./FocusTimerSettings";
import { FocusTimerStats } from "./FocusTimerStats";
import { countdown, focusDuration, focusSessions } from "./FocusTimerData";
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
  const paths = {
    bell: "M6 8a4 4 0 0 1 8 0v3l2 3H4l2-3V8M8 16a2 2 0 0 0 4 0",
    settings: "M3 5h14M3 10h14M3 15h14M7 3v4M13 8v4M8 13v4",
    expand: "M7 3H3v4M13 3h4v4M3 13v4h4M17 13v4h-4",
    collapse: "M3 7h4V3M17 7h-4V3M7 17v-4H3M13 17v-4h4",
  };
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TimerTool({
  widget,
  widgets,
  act,
  headerActionsTarget,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  headerActionsTarget?: HTMLElement | null;
}): ReactElement {
  const data = record(widget.data);
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState(() => readDraft(widget));
  const [memoBase, setMemoBase] = useState(() => readMemoBase(widget));
  const [presentation, setPresentation] = useState(
    data.presentation === "digits" ? "digits" : "dial",
  );
  const [custom, setCustom] = useState(() => ![15, 25, 50].includes(Number(draft.minutes)));
  const [expanded, setExpanded] = useState(true);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizing = useRef(false);
  const context = useRef<HTMLElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState("calendar");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [requestedNote, setRequestedNote] = useState<DataRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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
  const rest = data.mode === "rest";
  const todo = widgets.find((item) => item.kind === "todo" && item.installed && item.enabled);
  const calendar = widgets.find(
    (item) => item.kind === "calendar" && item.installed && item.enabled,
  );
  const tasks = rows(record(todo?.data).items).filter((item) => item.completedAt === null);
  const selectedTodoId = tasks.some((item) => item.id === draft.todoId) ? draft.todoId : "";
  const linked = tasks.find((item) => item.id === data.todoId);
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
  const phase = idle ? "집중 시간" : rest ? "휴식 시간" : "남은 집중 시간";
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
    if (draft.memo !== memoBase && text(data.memo) !== memoBase) {
      setError("다른 화면에서 집중 메모가 바뀌었어요. 입력한 초안은 남아 있어요.");
      return false;
    }
    const ok = idle
      ? await configure({ memo: draft.memo })
      : await act("update-memo", { memo: draft.memo, expectedMemo: memoBase });
    if (ok) setMemoBase(draft.memo);
    return ok;
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
        <section className={s.timer} aria-label="타이머 조작">
          <div className={s.timerTop}>
            <span className={s.eyebrow}>FOCUS TIMER</span>
            <div className={s.modes} role="group" aria-label="타이머 표시 방식">
              {(["dial", "digits"] as const).map((mode) => (
                <Button
                  key={mode}
                  size="compact"
                  variant="quiet"
                  className={s.mode}
                  aria-pressed={presentation === mode}
                  onClick={async () => {
                    if (await configure({ presentation: mode })) setPresentation(mode);
                  }}
                >
                  {mode === "dial" ? "다이얼" : "숫자"}
                </Button>
              ))}
            </div>
          </div>
          <div className={s.focusSetup}>
            {idle ? (
              <FormField label="무엇에 집중할까요?" className={s.focusField}>
                <TextField
                  aria-label="집중할 일"
                  className={s.title}
                  placeholder="이번에 집중할 일"
                  value={draft.title}
                  maxLength={500}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </FormField>
            ) : (
              <h1 className={s.title}>
                {text(data.title) ||
                  text(linked?.title) ||
                  (rest ? "잠깐 쉬어가요" : "나만의 집중 시간")}
              </h1>
            )}
            {draft.eventRef && (
              <div className={s.related}>
                <span>일정 · {text(draft.eventRef.title)}</span>
                {idle && (
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
                )}
              </div>
            )}
            {!draft.eventRef && idle && (
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
          </div>
          <div className={s.timerReadouts}>
            <div className={s.clock} data-presentation={presentation}>
              {presentation === "dial" && (
                <svg className={s.dial} viewBox="0 0 250 250" aria-hidden="true">
                  <g className={s.ticks}>
                    {Array.from({ length: 60 }, (_, index) => (
                      <line
                        key={index}
                        x1="125"
                        y1={index % 5 === 0 ? 12 : 15}
                        x2="125"
                        y2={index % 5 === 0 ? 21 : 19}
                        transform={`rotate(${index * 6} 125 125)`}
                      />
                    ))}
                  </g>
                  <circle cx="125" cy="125" r="119" className={s.dialTrack} />
                  <circle
                    cx="125"
                    cy="125"
                    r="119"
                    className={s.dialArc}
                    strokeDasharray={2 * Math.PI * 119}
                    strokeDashoffset={2 * Math.PI * 119 * (1 - progress)}
                  />
                </svg>
              )}
              <div className={s.clockCenter}>
                <span className={s.quiet}>{phase}</span>
                <span className={s.time} role="timer" aria-label="남은 시간">
                  {countdown(remaining)}
                </span>
                <span className={s.quiet}>
                  {status === "paused"
                    ? "준비되면 다시 시작해요"
                    : status === "finished"
                      ? rest
                        ? "다시 집중할 준비가 됐어요"
                        : `실제 집중 ${focusDuration(sessions.at(-1)?.elapsedMs || 0)}`
                      : idle
                        ? `${clockLabel(now)} → ${clockLabel(now + remaining)}`
                        : `${clockLabel(number(data.deadline) || now + remaining)} 종료 예정`}
                </span>
              </div>
              {presentation === "digits" && (
                <div
                  className={s.progress}
                  role="progressbar"
                  aria-label="남은 집중 시간"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <div className={s.progressFill} style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </div>
            <FocusTimerAppUsage key={widget.id} data={data} act={act} />
          </div>
          <p className={s.timerStatus} role="status">
            {statusLabel}
          </p>
          <div className={s.controls}>
            {idle && (
              <>
                <div className={s.presets} aria-label="집중 시간 선택">
                  {[15, 25, 50].map((minutes) => (
                    <Button
                      key={minutes}
                      variant="quiet"
                      size="compact"
                      className={s.preset}
                      aria-pressed={!custom && Number(draft.minutes) === minutes}
                      onClick={() => {
                        setDraft({ ...draft, minutes: String(minutes) });
                        setCustom(false);
                      }}
                    >
                      {minutes}분
                    </Button>
                  ))}
                  <Button
                    variant="quiet"
                    size="compact"
                    className={s.preset}
                    aria-pressed={custom}
                    onClick={() => setCustom(true)}
                  >
                    직접
                  </Button>
                </div>
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
                  <div className={s.optionalSetup}>
                    <FormField label="연결할 할 일 (선택)" className={s.inlineField}>
                      <Select
                        value={selectedTodoId}
                        onChange={(event) => setDraft({ ...draft, todoId: event.target.value })}
                      >
                        <option value="">연결하지 않음</option>
                        {tasks.map((item) => (
                          <option key={text(item.id)} value={text(item.id)}>
                            {text(item.title)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                )}
                <Button
                  className={s.mainAction}
                  variant="primary"
                  disabled={!validDuration}
                  onClick={() => void start()}
                >
                  집중 시작
                </Button>
              </>
            )}
            {status === "running" && (
              <Button className={s.mainAction} variant="primary" onClick={() => void act("pause")}>
                일시정지
              </Button>
            )}
            {status === "paused" && (
              <Button className={s.mainAction} variant="primary" onClick={() => void act("resume")}>
                다시 시작
              </Button>
            )}
            {status === "finished" && (
              <>
                <Button className={s.mainAction} variant="primary" onClick={() => void act("rest")}>
                  {focusDuration(restDuration)} 쉬기
                </Button>
                <Button variant="quiet" onClick={() => void act("continue")}>
                  계속 집중
                </Button>
                {linked && todo && ruleOf(linked).mode !== "frequency" && (
                  <Button
                    variant="secondary"
                    onClick={() => void act("complete", { id: text(linked.id) }, todo)}
                  >
                    {text(linked.title)} 완료하기
                  </Button>
                )}
              </>
            )}
            {!idle && (
              <Button variant="quiet" onClick={() => void act("cancel")}>
                {status === "finished" ? "마치기" : "그만하기"}
              </Button>
            )}
          </div>
          {status === "finished" && linked && todo && ruleOf(linked).mode === "frequency" && (
            <FrequencyRecordAction
              key={`${todo.id}:${text(linked.id)}:${text(ruleOf(linked).timeZone)}`}
              item={linked}
              todo={todo}
              now={now}
              act={act}
            />
          )}
          <p className={s.timerHelp}>
            {status === "running" && !rest
              ? "집중 중에는 캐릭터 대화가 잠시 쉬어요."
              : "할 일 완료와 횟수 기록은 직접 선택해요."}
          </p>
        </section>
        <aside
          ref={context}
          className={s.context}
          aria-label="일정과 집중 기록"
          inert={!expanded}
          style={resizeWidth === null ? undefined : { width: resizeWidth }}
        >
          <Tabs className={s.tabs} value={tab} onValueChange={setTab}>
            <TabList className={s.tabList} aria-label="집중 보조 화면 선택">
              <Tab value="calendar">일정</Tab>
              <Tab value="stats">집중 기록</Tab>
              <Tab value="notes">노트</Tab>
            </TabList>
            <TabPanel className={s.tabPanel} value="calendar">
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
            </TabPanel>
            <TabPanel className={s.tabPanel} value="stats">
              <FocusTimerStats
                sessions={sessions}
                day={localDay(new Date(now))}
                selectedId={selectedSession}
                onSelect={setSelectedSession}
                act={act}
                onOpenNote={(ref) => {
                  setRequestedNote(ref);
                  setTab("notes");
                }}
              />
            </TabPanel>
            <TabPanel className={s.tabPanel} value="notes">
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
              />
            </TabPanel>
          </Tabs>
        </aside>
      </div>
      {settingsOpen && (
        <FocusTimerSettings
          widget={widget}
          calendar={calendar}
          act={act}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}
