import {
  Button,
  Checkbox,
  DateField,
  FormField,
  Select,
  TabPanel,
  TextField,
  externalTabPanels,
} from "../../ui";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "@comet/icon";
import {
  Button as CometButton,
  IconButton,
  MessageInput,
  SelectField,
  TaskRow,
  Dialog,
  Tabs,
} from "@comet/ui";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
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
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { PlannerCalendar } from "./PlannerCalendar";
import { PlannerPreparation } from "./PlannerPreparation";
import { PlannerTemplates } from "./PlannerTemplates";
import { TaskReadOnlyDetails, TodoEditor } from "./TodoEditor";
import { envelopeTitle } from "./DiaryEnvelope";
import {
  clockLabel,
  dayDate,
  dueDay,
  dueLabel,
  deviceTimeZone,
  eventsOn,
  eventTime,
  frequencyRecords,
  inPeriod,
  moveDay,
  movePeriod,
  PERIODS,
  periodAnchor,
  plannedDay,
  repeatLabel,
  ruleOf,
} from "./plannerData";
import { usePlannerActions } from "./usePlannerActions";
import { usePlannerTasks } from "./usePlannerTasks";
import * as s from "./planner.css";

const NAVIGATION = [
  ["today", "오늘"],
  ["plans", "기간 계획"],
  ["calendar", "캘린더"],
  ["templates", "템플릿"],
] as const;

function planScopeLabel(period: string, day: string): string {
  if (period === "inbox") {
    return "수집함 · 날짜 없음";
  }
  if (period === "someday") {
    return "언젠가 계획";
  }
  const names: Record<string, string> = { week: "주간", month: "월간", year: "연간" };
  const name = names[period] ?? "기간";
  return `${name} 계획 · ${periodAnchor(period, day)}–${moveDay(movePeriod(day, period, 1), -1)}`;
}

export type PlannerToolTab = "today" | "plans" | "templates";
export type PlannerToolState = { dirty: boolean; busy: boolean; blocking: boolean };

function PlannerPanel({
  tabs,
  embedded,
  current,
  value,
  children,
}: {
  tabs: string;
  embedded: boolean;
  current: string;
  value: string;
  children: ReactNode;
}): ReactElement {
  if (embedded) {
    return (
      <section
        className={s.embeddedPanel}
        hidden={current !== value}
        aria-label={NAVIGATION.find(([key]) => key === value)?.[1]}
      >
        {children}
      </section>
    );
  }
  return (
    <TabPanel tabs={tabs} value={value} selected={current} className={s.panel}>
      {children}
    </TabPanel>
  );
}

export function Planner({
  onBack,
  initialTab,
  embeddedTab,
  dismissVersion,
  onNavigate,
  onStateChange,
  selectedDay,
  onSelectedDayChange,
  headerActionsTarget,
}: {
  onBack?: () => void;
  initialTab?: string;
  embeddedTab?: PlannerToolTab;
  dismissVersion?: number;
  onNavigate?: (tab: PlannerToolTab) => void;
  onStateChange?: (state: PlannerToolState) => void;
  selectedDay?: string;
  onSelectedDayChange?: (day: string) => void;
  headerActionsTarget?: HTMLElement | null;
} = {}): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const widgets = snapshot?.widgets ?? [];
  const enabled = (kind: string): WidgetView | undefined =>
    widgets.find((w) => w.kind === kind && w.installed && w.enabled);
  const todoInstalled = widgets.some((widget) => widget.kind === "todo" && widget.installed);
  const todo = enabled("todo"),
    calendar = enabled("calendar"),
    preparation = enabled("preparation"),
    timer = enabled("focus-timer");
  const actions = usePlannerActions({ todo, reload });
  const { failure, setFailure, notice, setNotice, busy, run, act } = actions;
  const [internalTab, setInternalTab] = useState(
    initialTab || new URLSearchParams(window.location.search).get("tab") || "today",
  );
  const embedded = embeddedTab !== undefined;
  const tab = embeddedTab ?? internalTab;
  const tabsId = useId();
  function setTab(value: string): void {
    if (embedded) {
      if (value === "today" || value === "plans" || value === "templates") {
        onNavigate?.(value);
      }
    } else {
      setInternalTab(value);
    }
  }
  const selectTab = (next: string): void => {
    setTab(next);
    if (!embedded && isDesktop()) {
      void command("set_planner_tab", { tab: next }).catch((cause: unknown) =>
        setFailure({ message: errorText(cause), saving: false }),
      );
    }
  };
  const [internalDay, setInternalDay] = useState(localDay());
  const day = selectedDay ?? internalDay;
  const [allTasks, setAllTasks] = useState(false);
  useEffect(() => setAllTasks(false), [day]);
  function setDay(value: string): void {
    setAllTasks(false);
    if (onSelectedDayChange) onSelectedDayChange(value);
    else setInternalDay(value);
  }
  const [period, setPeriod] = useState("week");
  const [planDay, setPlanDay] = useState(localDay());
  const [title, setTitle] = useState("");
  const [newTaskList, setNewTaskList] = useState("default");
  const [visibleList, setVisibleList] = useState("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedTask, setSelectedTask] = useState("");
  const dragging = useRef<{ id: string; widgetId: string } | null>(null);
  const [movingTask, setMovingTask] = useState<{ id: string; date: string } | null>(null);
  const [editing, setEditing] = useState<{ item: DataRecord; widget: WidgetView } | null>(null);
  const [wrap, setWrap] = useState(false);
  const [rollIds, setRollIds] = useState<string[]>([]);
  const [rollDate, setRollDate] = useState(moveDay(localDay(), 1));
  const [manageLists, setManageLists] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [preparationDirty, setPreparationDirty] = useState(false);
  const [preparationBusy, setPreparationBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    setEditing(null);
    setManageLists(false);
    setWrap(false);
    setMovingTask(null);
  }, [dismissVersion]);
  const leaving = useRef(false);
  const returning = useRef(false);
  const blocking = Boolean(
    editing || manageLists || wrap || movingTask || preparationDirty || preparationBusy,
  );
  const dirty = Boolean(blocking || title.trim() || templateDirty);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const report = useRef(onStateChange);
  report.current = onStateChange;
  useEffect(() => {
    report.current?.({ dirty, busy: busy || preparationBusy, blocking });
  }, [dirty, busy, preparationBusy, blocking]);
  useEffect(() => () => report.current?.({ dirty: false, busy: false, blocking: false }), []);
  const items = rows(record(todo?.data).items),
    lists = rows(record(todo?.data).lists);
  const connections = rows(record(calendar?.data).connections);
  const events = rows(record(calendar?.data).events).filter(
    (event) =>
      !event.cancelled &&
      (event.connectionId === "local" || connections.some((c) => c.id === event.connectionId)),
  );
  const dailyEvents = eventsOn(events, day);
  const event = dailyEvents.find((e) => e.id === selectedEvent) ?? dailyEvents[0];
  const chosen = items.filter((item) => plannedDay(item) === day);
  const remaining = chosen.filter(
    (item) =>
      typeof item.completedAt !== "number" &&
      !(
        ruleOf(item).mode === "frequency" &&
        rows(item.frequencyRecords).some((entry) => entry.date === day)
      ),
  );
  const displayedTasks = embedded || allTasks ? items : chosen;
  const currentTask = displayedTasks.find(
    (item) =>
      item.id === selectedTask &&
      typeof item.completedAt !== "number" &&
      !(
        ruleOf(item).mode === "frequency" &&
        rows(item.frequencyRecords).some((entry) => entry.date === day)
      ),
  );
  const inboxCount = items.filter(
    (item) => !item.completedAt && inPeriod(item, "inbox", day),
  ).length;
  const planScope = planScopeLabel(period, planDay);
  const lastSuccess = Math.max(0, ...connections.map((c) => number(c.lastSuccessAt)));
  const { completionUndo, check, undoCompletion, moveTaskDate } = usePlannerTasks({
    actions,
    items,
    recordingDay: tab === "plans" ? planDay : day,
    reload,
  });

  useEffect(() => {
    if (embedded || !isDesktop()) return;
    let active = true;
    let tabCleanup: (() => void) | undefined, closeCleanup: (() => void) | undefined;
    let received = false;
    const select = (value: string): void => {
      if (active && NAVIGATION.some(([key]) => key === value)) setTab(value);
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

  function openSettings(kind = "calendar"): void {
    if (isDesktop()) void run(() => command("open_planner_settings", { kind }));
    else window.location.assign(`/?view=settings&section=widgets&preview=installed`);
  }
  async function enableTodo(): Promise<void> {
    const existing = widgets.find((w) => w.kind === "todo");
    await run(() =>
      existing?.installed
        ? command("set_widget_enabled", { id: existing.id, enabled: true })
        : command("install_widgets", { kinds: ["todo"] }),
    );
  }
  function edit(item: DataRecord): void {
    if (todo) setEditing({ item, widget: todo });
  }
  function draggedTask(event: DragEvent): DataRecord | undefined {
    let value = dragging.current;
    if (!value) {
      try {
        value = JSON.parse(event.dataTransfer.getData("application/x-comet-todo"));
      } catch {
        return undefined;
      }
    }
    return !busy && value?.widgetId === todo?.id
      ? items.find((item) => item.id === value?.id)
      : undefined;
  }
  function taskCheck(item: DataRecord): ReactElement {
    const frequency = ruleOf(item).mode === "frequency";
    const recordingDay = tab === "plans" ? planDay : day;
    const selected = selectedTask === item.id;
    return (
      <div className={s.taskSummary}>
        <div className={s.actions}>
          <span onClick={(event) => event.stopPropagation()}>
            <Checkbox
              className={s.taskCheck}
              aria-label={text(item.title)}
              title="완료 상태 바꾸기"
              children={null}
              aria-labelledby={undefined}
              disabled={busy || (frequency && recordingDay > localDay())}
              checked={
                frequency
                  ? rows(item.frequencyRecords).some((entry) => entry.date === recordingDay)
                  : typeof item.completedAt === "number"
              }
              onChange={() => void check(item)}
            />
          </span>
          <button
            type="button"
            className={s.taskTitle}
            aria-label={`${text(item.title)} 상세 보기`}
            aria-expanded={selected}
            onClick={() => setSelectedTask(text(item.id))}
          >
            {text(item.title)}
            {frequency && (
              <span className={s.caption}>
                {" "}
                · {frequencyRecords(item, recordingDay).length}/{number(ruleOf(item).timesPerWeek)}
                회
              </span>
            )}
          </button>
        </div>
        <p className={s.caption}>
          계획 · {plannedDay(item) || "날짜 없음"}　{dueLabel(item) || "기한 없음"}
        </p>
        {!!text(item.memo) && (
          <span className={s.memoPreview}>
            메모 · {text(item.memo).split(/\r?\n/)[0]} · 상세 보기
          </span>
        )}
        {selected && <TaskReadOnlyDetails item={item} />}
      </div>
    );
  }
  function quickInput(isToday: boolean): ReactElement {
    const diaryQuickAdd = embedded && isToday;
    const Input = diaryQuickAdd ? MessageInput : TextField;
    const quickList = lists.some((list) => list.id === newTaskList) ? newTaskList : "default";
    return (
      <>
        <p
          className={diaryQuickAdd ? s.visuallyHidden : s.caption}
          id={`planner-add-scope-${isToday ? "day" : "period"}`}
        >
          {isToday
            ? `새 할 일 계획일 · 선택일 ${day}`
            : `새 할 일 · ${planScope}${period === "inbox" ? "" : " · 계획일 없음"}`}
        </p>
        <form
          className={diaryQuickAdd ? s.diaryQuickAdd : s.quick}
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await act("add", {
                title,
                listId: diaryQuickAdd ? quickList : visibleList === "all" ? "default" : visibleList,
                plannedDate: isToday ? day : null,
                planPeriod: isToday || period === "inbox" ? "none" : period,
                planAnchor:
                  isToday || ["inbox", "someday"].includes(period)
                    ? null
                    : periodAnchor(period, planDay),
              })
            )
              setTitle("");
          }}
        >
          {diaryQuickAdd && <Icon name="plus" size={16} />}
          <div className={diaryQuickAdd ? s.diaryInput : s.grow}>
            <Input
              className={s.grow}
              aria-label="새 할 일"
              aria-describedby={`planner-add-scope-${isToday ? "day" : "period"}`}
              disabled={busy}
              placeholder={
                diaryQuickAdd
                  ? "새 할 일 · Enter로 추가"
                  : isToday
                    ? "할 일을 입력하고 Enter"
                    : period === "inbox"
                      ? "날짜 없이 할 일을 적어 보세요."
                      : "이 기간에 하고 싶은 일을 적어 보세요."
              }
              required
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          {diaryQuickAdd ? (
            <>
              <span className={s.diaryDate}>
                <span aria-hidden="true">
                  {day === localDay()
                    ? "오늘"
                    : dayDate(day).toLocaleDateString("ko-KR", {
                        month: "numeric",
                        day: "numeric",
                      })}
                  <Icon name="chevdown" size={12} />
                </span>
                <DateField
                  aria-label="새 할 일 계획일"
                  value={day}
                  disabled={busy}
                  required
                  onChange={(event) => {
                    if (event.target.value) setDay(event.target.value);
                  }}
                />
              </span>
              <SelectField
                className={s.diaryList}
                controlSize={32}
                leading={<span className={s.diaryListDot} />}
                aria-label="새 할 일 목록"
                disabled={busy}
                value={quickList}
                onChange={(event) => setNewTaskList(event.target.value)}
              >
                {lists.map((list) => (
                  <option key={text(list.id)} value={text(list.id)}>
                    {text(list.name)}
                  </option>
                ))}
              </SelectField>
              <CometButton
                className={s.diaryTemplate}
                variant="link"
                onClick={() => selectTab("templates")}
              >
                템플릿에서 고르기
                <Icon name="arrowright" size={14} />
              </CometButton>
              <button type="submit" hidden disabled={busy || !todo}>
                추가
              </button>
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={busy || !todo}>
              추가
            </Button>
          )}
        </form>
      </>
    );
  }
  function taskActions(selectionOnly = false): ReactElement {
    return (
      <div className={s.actions}>
        <Button
          variant="secondary"
          size="compact"
          disabled={!currentTask || busy}
          onClick={async () => {
            if (!timer) {
              openSettings("focus-timer");
              return;
            }
            if (await act("start", { durationMs: 1500000, todoId: selectedTask }, timer)) {
              setNotice("25분 집중을 시작했어요. 할 일 완료는 직접 표시해 주세요.");
              await run(() => command("open_widget", { id: timer.id }));
            }
          }}
        >
          25분 집중
        </Button>
        <Button
          variant="quiet"
          size="compact"
          disabled={!currentTask || plannedDay(currentTask) !== day || busy}
          onClick={() => void act("plan", { ids: [selectedTask], date: null })}
        >
          {day === localDay() ? "오늘에서 빼기" : "선택 날짜에서 빼기"}
        </Button>
        {!selectionOnly && !headerActionsTarget && <div className={s.spacer} />}
        {!selectionOnly && !headerActionsTarget && (
          <Button
            variant="quiet"
            size="compact"
            onClick={() => {
              setRollIds([]);
              setRollDate(moveDay(day, 1));
              setWrap(true);
            }}
          >
            하루 마무리
          </Button>
        )}
      </div>
    );
  }
  function diaryTasks(): ReactElement {
    const completed = (item: DataRecord): boolean =>
      typeof item.completedAt === "number" ||
      (ruleOf(item).mode === "frequency" &&
        rows(item.frequencyRecords).some((entry) => entry.date === day));
    const open = items.filter((item) => !completed(item));
    const completedToday = items.filter((item) => completed(item) && plannedDay(item) === day);
    const done = items.filter((item) => completed(item) && plannedDay(item) !== day);
    const envelopes = rows(record(preparation?.data).envelopes);
    const groups = [
      {
        title: "지난 계획",
        tasks: open.filter((item) => plannedDay(item) && plannedDay(item) < day),
      },
      {
        title: day === localDay() ? "오늘" : "선택한 날",
        tasks: [...open.filter((item) => plannedDay(item) === day), ...completedToday],
        date: day,
      },
      { title: "예정", tasks: open.filter((item) => plannedDay(item) > day) },
      { title: "날짜 없음", tasks: open.filter((item) => !plannedDay(item)) },
      ...(showCompleted ? [{ title: "완료한 일", tasks: done }] : []),
    ];
    return (
      <section className={s.diaryTasks} aria-label="모든 날짜 할 일">
        {todo ? (
          <>
            {quickInput(true)}
            {groups
              .filter((group) => group.tasks.length || group.date || group.title === "날짜 없음")
              .map((group) => (
                <section
                  className={s.diaryTaskGroup}
                  key={group.title}
                  aria-label={group.title === "완료한 일" ? group.title : `${group.title} 할 일`}
                  onDragOver={(event) => {
                    if (draggedTask(event)) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const source = draggedTask(event);
                    if (!source || completed(source)) return;
                    event.preventDefault();
                    dragging.current = null;
                    if (group.date || group.title === "날짜 없음") {
                      void moveTaskDate(source, group.date || null);
                    } else {
                      setMovingTask({ id: text(source.id), date: plannedDay(source) || day });
                    }
                  }}
                >
                  <div className={s.diaryGroupHeading}>
                    <h2 className={s.diaryGroupTitle}>
                      {group.title === "날짜 없음" ? (
                        <button
                          type="button"
                          className={s.diaryTaskTitle}
                          aria-label={`수집함 · 날짜 없음 · 미완료 ${inboxCount}개`}
                          onClick={() => {
                            setPeriod("inbox");
                            selectTab("plans");
                          }}
                        >
                          수집함
                        </button>
                      ) : (
                        group.title
                      )}
                    </h2>
                    <span className={s.diaryGroupMeta}>
                      {group.date &&
                        `${dayDate(group.date).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })} · `}
                      {group.title === "날짜 없음" ? "날짜 없음 · " : ""}
                      {group.date
                        ? group.tasks.filter((item) => !completed(item)).length
                        : group.tasks.length}
                      개{group.date ? " 남음" : ""}
                    </span>
                    {group.title === "날짜 없음" && (
                      <span className={s.diaryInboxHint}>빠른 실행에서 적은 것도 여기로 와요</span>
                    )}
                  </div>
                  {group.tasks.length ? (
                    <div className={s.diaryTaskCard}>
                      {group.tasks.map((item, index) => {
                        const envelope = envelopes.find(
                          (value) =>
                            Array.isArray(value.todoIds) && value.todoIds.includes(item.id),
                        );
                        const repeat = repeatLabel(item);
                        return (
                          <article
                            key={text(item.id)}
                            draggable={!busy}
                            onDragStart={(event) => {
                              if (!todo || busy) {
                                event.preventDefault();
                                return;
                              }
                              dragging.current = { id: text(item.id), widgetId: todo.id };
                              event.dataTransfer.setData(
                                "application/x-comet-todo",
                                JSON.stringify(dragging.current),
                              );
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              dragging.current = null;
                            }}
                            onDragOver={(event) => {
                              const source = draggedTask(event);
                              if (source && completed(source) === completed(item)) {
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                            onDrop={(event) => {
                              event.stopPropagation();
                              const source = draggedTask(event);
                              if (!source || completed(source) !== completed(item)) return;
                              event.preventDefault();
                              dragging.current = null;
                              if (source.id === item.id) return;
                              if (plannedDay(source) === plannedDay(item)) {
                                void act("reorder", {
                                  id: text(source.id),
                                  beforeId: text(item.id),
                                });
                              } else if (!completed(source)) {
                                void moveTaskDate(source, plannedDay(item) || null);
                              }
                            }}
                            onKeyDown={(event) => {
                              if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                                return;
                              const peers = group.tasks.filter(
                                (peer) =>
                                  plannedDay(peer) === plannedDay(item) &&
                                  completed(peer) === completed(item),
                              );
                              const at = peers.indexOf(item);
                              const next = event.key === "ArrowUp" ? at - 1 : at + 1;
                              if (busy || next < 0 || next >= peers.length) return;
                              event.preventDefault();
                              void act("reorder", {
                                id: text(item.id),
                                beforeId:
                                  event.key === "ArrowUp"
                                    ? text(peers[next].id)
                                    : peers[at + 2]
                                      ? text(peers[at + 2].id)
                                      : null,
                              });
                            }}
                          >
                            <TaskRow
                              layout="diary"
                              divider={index > 0}
                              title={
                                <button
                                  type="button"
                                  className={s.diaryTaskTitle}
                                  aria-label={`${text(item.title)} 상세 보기`}
                                  aria-expanded={selectedTask === item.id}
                                  onClick={() => setSelectedTask(text(item.id))}
                                >
                                  {text(item.title)}
                                </button>
                              }
                              completionLabel={text(item.title)}
                              completed={completed(item)}
                              disabled={
                                busy || (ruleOf(item).mode === "frequency" && day > localDay())
                              }
                              onCompletedChange={() => void check(item)}
                              selected={selectedTask === item.id}
                              description={text(item.memo).split(/\r?\n/)[0] || undefined}
                              due={
                                dueLabel(item, day) ||
                                (plannedDay(item) === day
                                  ? group.title
                                  : plannedDay(item) || "날짜 없음")
                              }
                              overdue={Boolean(
                                dueDay(item) &&
                                (typeof item.dueAt === "number"
                                  ? item.dueAt < Date.now()
                                  : dueDay(item) < localDay()),
                              )}
                              list={text(lists.find((list) => list.id === item.listId)?.name)}
                              repeat={
                                ruleOf(item).mode === "frequency"
                                  ? `${repeat} · ${frequencyRecords(item, day).length}/${number(ruleOf(item).timesPerWeek)}회`
                                  : repeat
                              }
                              envelope={envelope ? envelopeTitle(envelope) : undefined}
                            />
                            {selectedTask === item.id && (
                              <div className={s.diaryTaskDetails}>
                                <TaskReadOnlyDetails item={item} />
                                <Button
                                  variant="quiet"
                                  size="compact"
                                  aria-label={`${text(item.title)} 편집`}
                                  onClick={() => edit(item)}
                                >
                                  편집
                                </Button>
                                {taskActions(true)}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={s.diaryGroupMeta}>
                      {group.title === "날짜 없음"
                        ? "날짜 없이 남긴 할 일이 없어요."
                        : `${day}에 계획한 할 일이 없어요.`}
                    </p>
                  )}
                </section>
              ))}
            <div className={s.diaryTaskFooter}>
              <CometButton
                variant="link"
                aria-expanded={showCompleted}
                onClick={() => setShowCompleted((value) => !value)}
              >
                {showCompleted ? "완료한 일 접기" : `완료한 일 ${done.length}개 보기`}
              </CometButton>
              <div className={s.spacer} />
              {!headerActionsTarget && (
                <CometButton variant="link" onClick={() => setManageLists(true)}>
                  목록 관리
                </CometButton>
              )}
              <button
                type="button"
                className={s.diaryDragHint}
                disabled={busy || !open.length}
                onClick={() => {
                  const source = open.find((item) => item.id === selectedTask) || open[0];
                  if (source)
                    setMovingTask({ id: text(source.id), date: plannedDay(source) || day });
                }}
              >
                끌어서 순서를 바꾸거나 다른 날로 옮겨요
              </button>
            </div>
            {!headerActionsTarget && (
              <div className={s.actions}>
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => {
                    setRollIds([]);
                    setRollDate(moveDay(day, 1));
                    setWrap(true);
                  }}
                >
                  하루 마무리
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className={s.empty}>
            <p>
              {todoInstalled
                ? "할 일 사용이 꺼져 있어요. 켜면 저장한 항목을 다시 볼 수 있어요."
                : "할 일을 설치하면 계정 없이 수집함을 사용할 수 있어요."}
            </p>
            <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
              {todoInstalled ? "할 일 켜기" : "할 일 설치"}
            </Button>
          </div>
        )}
        {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
      </section>
    );
  }
  function prep(): ReactElement {
    return (
      <PlannerPreparation
        event={event}
        calendar={calendar}
        preparation={preparation}
        widgets={widgets}
        act={act}
        openSettings={openSettings}
        onDirtyChange={setPreparationDirty}
        onBusyChange={setPreparationBusy}
      />
    );
  }
  async function closeWindow(): Promise<void> {
    if (dirtyRef.current && !leaving.current) {
      setConfirmClose(true);
      return;
    }
    if (returning.current && onBack) onBack();
    else if (isDesktop()) await getCurrentWindow().destroy();
  }
  const shown = items.filter(
    (item) =>
      inPeriod(item, period, planDay) &&
      (visibleList === "all" || item.listId === visibleList) &&
      (showCompleted || typeof item.completedAt !== "number"),
  );
  const Root = embedded ? "section" : "main";
  return (
    <Root className={embedded ? s.embedded : s.window}>
      {embedded &&
        headerActionsTarget &&
        createPortal(
          <div className={s.headerActions}>
            {tab === "today" && (
              <CometButton
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={() => {
                  setRollIds([]);
                  setRollDate(moveDay(day, 1));
                  setWrap(true);
                }}
              >
                하루 마무리
              </CometButton>
            )}
            <IconButton
              icon="list"
              variant="surface"
              aria-label="목록 관리"
              disabled={busy}
              onClick={() => setManageLists(true)}
            />
          </div>,
          headerActionsTarget,
        )}
      {!embedded && (
        <WindowHeader
          className={s.header}
          label="플래너 닫기"
          title="할 일·연결 관리"
          onClose={closeWindow}
          actions={
            onBack && (
              <Button
                variant="quiet"
                size="compact"
                onClick={() => {
                  returning.current = true;
                  void closeWindow();
                }}
              >
                다이어리로 돌아가기
              </Button>
            )
          }
        />
      )}
      {loadError && (
        <div role="alert" className={s.error}>
          목록을 불러오지 못했어요. {loadError}{" "}
          <Button variant="quiet" size="compact" onClick={reload}>
            다시 불러오기
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" className={s.error}>
          {failure.message}
          {failure.saving && (
            <p>저장을 확인하지 못했어요. 입력을 유지했으니 확인한 뒤 다시 제출해 주세요.</p>
          )}
        </div>
      )}
      {!isDesktop() && (
        <p className={s.status}>예시 데이터 미리보기 · 입력한 내용은 저장하지 않아요.</p>
      )}
      {busy && (
        <p role="status" className={s.status}>
          저장하고 있어요…
        </p>
      )}
      {notice && (
        <p role="status" className={s.status}>
          {notice}
        </p>
      )}
      {completionUndo && (
        <div role="status" className={s.status}>
          {completionUndo.title} · 완료했어요.
          <Button
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void undoCompletion()}
          >
            완료 취소
          </Button>
        </div>
      )}
      {!snapshot ? (
        <div className={s.empty}>
          {loadError ? "목록을 다시 불러와 주세요." : "할 일을 불러오고 있어요."}
        </div>
      ) : (
        <div className={embedded ? s.embeddedTabs : s.tabs}>
          {!embedded && (
            <div className={s.nav}>
              <Tabs
                label="플래너"
                className={s.tabList}
                items={NAVIGATION.map(([value, label]) => ({ value, label, content: null }))}
                value={tab}
                onValueChange={selectTab}
                externalPanels={externalTabPanels(
                  tabsId,
                  NAVIGATION.map(([value]) => value),
                )}
              />
              <Button variant="quiet" size="compact" onClick={() => openSettings()}>
                연결·알림 설정 ↗
              </Button>
            </div>
          )}
          <PlannerPanel tabs={tabsId} embedded={embedded} current={tab} value="today">
            {embedded ? (
              diaryTasks()
            ) : (
              <>
                <div className={s.toolbar}>
                  <strong>
                    {dayDate(day).toLocaleDateString("ko-KR", {
                      month: "long",
                      day: "numeric",
                      weekday: "long",
                    })}
                  </strong>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="이전 날짜"
                    onClick={() => setDay(moveDay(day, -1))}
                  >
                    ‹
                  </Button>
                  <Button variant="secondary" size="compact" onClick={() => setDay(localDay())}>
                    오늘
                  </Button>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="다음 날짜"
                    onClick={() => setDay(moveDay(day, 1))}
                  >
                    ›
                  </Button>
                  <span className={s.caption}>기기 시간대 · {deviceTimeZone()}</span>
                  <div className={s.spacer} />
                  <span className={s.caption}>
                    선택일 {day} · 할 일 {chosen.length}개 · 완료 {chosen.length - remaining.length}
                    개
                  </span>
                </div>
                <div className={embedded ? s.embeddedContent : s.split}>
                  {!embedded && (
                    <aside className={s.column}>
                      <h2 className={s.heading}>
                        선택일 {day} 일정 · {dailyEvents.length}개
                      </h2>
                      {!calendar || (!connections.length && !events.length) ? (
                        <div className={s.empty}>
                          <p className={s.caption}>내 캘린더도 함께 볼 수 있어요.</p>
                          <Button variant="secondary" size="compact" onClick={() => openSettings()}>
                            캘린더 연결
                          </Button>
                          <p className={s.caption}>할 일은 계정 없이 사용할 수 있어요.</p>
                        </div>
                      ) : (
                        <>
                          {connections.some(
                            (c) => !["ready", "syncing"].includes(text(c.status)),
                          ) && (
                            <div role="status" className={s.error}>
                              캘린더를 갱신하지 못했어요.
                              <Button variant="quiet" size="compact" onClick={() => openSettings()}>
                                연결 확인 ↗
                              </Button>
                            </div>
                          )}
                          {!dailyEvents.length && (
                            <p className={s.caption}>{day}에 조회된 일정이 없어요.</p>
                          )}
                          {dailyEvents.map((e) => (
                            <button
                              type="button"
                              key={text(e.id)}
                              className={s.eventButton}
                              aria-pressed={event?.id === e.id}
                              onClick={() => setSelectedEvent(text(e.id))}
                            >
                              <span className={s.caption}>{eventTime(e)}</span>
                              <span>{text(e.title)}</span>
                              <span className={s.caption}>
                                {e.connectionId === "local"
                                  ? "Comet"
                                  : text(connections.find((c) => c.id === e.connectionId)?.name)}
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                      {event && prep()}
                      {lastSuccess > 0 && (
                        <p className={s.caption}>
                          마지막 확인 {new Date(lastSuccess).toLocaleString("ko-KR")} · 읽기 연결
                        </p>
                      )}
                    </aside>
                  )}
                  <section
                    className={s.column}
                    aria-label={
                      allTasks
                        ? "모든 날짜 할 일"
                        : day === localDay()
                          ? "오늘 할 일"
                          : "선택 날짜 할 일"
                    }
                  >
                    <div className={s.actions}>
                      <h2 className={s.heading}>
                        {allTasks ? "모든 날짜 할 일" : `${day} 할 일`} · {displayedTasks.length}개
                      </h2>
                      <Button
                        variant="quiet"
                        size="compact"
                        aria-pressed={allTasks}
                        onClick={() => setAllTasks((value) => !value)}
                      >
                        {allTasks ? "선택 날짜만 보기" : "모든 할 일 보기"}
                      </Button>
                      <div className={s.spacer} />
                      <Button
                        variant="quiet"
                        size="compact"
                        onClick={() => {
                          setPeriod("inbox");
                          selectTab("plans");
                        }}
                      >
                        수집함 · 날짜 없음 · 미완료 {inboxCount}개
                      </Button>
                    </div>
                    {!todo ? (
                      <div className={s.empty}>
                        <p>
                          {todoInstalled
                            ? "할 일 사용이 꺼져 있어요. 켜면 저장한 항목을 다시 볼 수 있어요."
                            : "할 일을 설치하면 계정 없이 수집함을 사용할 수 있어요."}
                        </p>
                        <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                          {todoInstalled ? "할 일 켜기" : "할 일 설치"}
                        </Button>
                      </div>
                    ) : (
                      <>
                        {quickInput(true)}
                        {!displayedTasks.length && (
                          <div className={s.empty}>
                            <p>
                              {allTasks
                                ? "모든 날짜와 날짜 없는 항목에 저장한 할 일이 없어요."
                                : `${day}에 계획한 할 일이 없어요.`}
                            </p>
                            <Button
                              variant="quiet"
                              size="compact"
                              onClick={() => selectTab("templates")}
                            >
                              템플릿에서 고르기
                            </Button>
                          </div>
                        )}
                        <div className={s.list}>
                          {displayedTasks.map((item) => (
                            <article
                              key={text(item.id)}
                              className={s.task}
                              data-selected={selectedTask === item.id}
                              onClick={() => setSelectedTask(text(item.id))}
                            >
                              {taskCheck(item)}
                              <span className={s.meta}>
                                {repeatLabel(item) ||
                                  text(lists.find((l) => l.id === item.listId)?.name)}
                              </span>
                              <Button
                                variant="quiet"
                                size="compact"
                                aria-label={`${text(item.title)} 편집`}
                                onClick={() => edit(item)}
                              >
                                편집
                              </Button>
                            </article>
                          ))}
                        </div>
                        {taskActions()}
                      </>
                    )}
                    {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
                  </section>
                </div>
              </>
            )}
          </PlannerPanel>
          <PlannerPanel tabs={tabsId} embedded={embedded} current={tab} value="plans">
            <div className={s.toolbar}>
              <div className={s.actions} role="group" aria-label="계획 기간">
                {[...PERIODS, ["inbox", "수집함"]].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="quiet"
                    size="compact"
                    className={s.categoryButton}
                    aria-pressed={period === key}
                    onClick={() => setPeriod(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className={s.spacer} />
              {!["someday", "inbox"].includes(period) && (
                <>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="이전 계획 기간"
                    onClick={() => setPlanDay(movePeriod(planDay, period, -1))}
                  >
                    ‹
                  </Button>
                  <span className={s.caption}>{periodAnchor(period, planDay)}</span>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="다음 계획 기간"
                    onClick={() => setPlanDay(movePeriod(planDay, period, 1))}
                  >
                    ›
                  </Button>
                </>
              )}
            </div>
            {todo ? (
              <>
                {quickInput(false)}
                <div className={s.actions}>
                  <Select
                    className={s.listSelect}
                    aria-label="조회할 목록"
                    value={visibleList}
                    onChange={(e) => setVisibleList(e.target.value)}
                  >
                    <option value="all">모든 목록</option>
                    {lists.map((l) => (
                      <option key={text(l.id)} value={text(l.id)}>
                        {text(l.name)}
                      </option>
                    ))}
                  </Select>
                  <Checkbox
                    checked={showCompleted}
                    onChange={(e) => setShowCompleted(e.target.checked)}
                  >
                    완료 포함
                  </Checkbox>
                  {!headerActionsTarget && (
                    <Button variant="quiet" size="compact" onClick={() => setManageLists(true)}>
                      목록 관리
                    </Button>
                  )}
                </div>
                <h2 className={s.heading}>
                  {planScope} · 표시 {shown.length}개
                </h2>
                <p className={s.caption}>
                  {visibleList === "all"
                    ? "모든 목록"
                    : text(lists.find((list) => list.id === visibleList)?.name)}{" "}
                  · {showCompleted ? "완료 포함" : "미완료만"}
                </p>
                <div style={{ overflow: "auto" }}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>할 일</th>
                        <th>목록</th>
                        <th>기한·반복</th>
                        <th>오늘 계획 · {localDay()}</th>
                        <th>
                          <span className={s.visuallyHidden}>편집</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((item) => (
                        <tr key={text(item.id)}>
                          <td>{taskCheck(item)}</td>
                          <td className={s.caption}>
                            {text(lists.find((l) => l.id === item.listId)?.name)}
                          </td>
                          <td className={s.caption}>
                            {[dueLabel(item) || "기한 없음", repeatLabel(item)]
                              .filter(Boolean)
                              .join(" · ")}
                          </td>
                          <td>
                            <Button
                              variant={plannedDay(item) === localDay() ? "quiet" : "secondary"}
                              size="compact"
                              disabled={busy}
                              onClick={() =>
                                void act("plan", {
                                  ids: [text(item.id)],
                                  date: plannedDay(item) === localDay() ? null : localDay(),
                                })
                              }
                            >
                              {plannedDay(item) === localDay() ? "오늘에 있음" : "오늘에 넣기"}
                            </Button>
                          </td>
                          <td>
                            <Button
                              variant="quiet"
                              size="compact"
                              aria-label={`${text(item.title)} 편집`}
                              onClick={() => edit(item)}
                            >
                              편집
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!shown.length && (
                    <p className={s.empty}>
                      {planScope}에 표시할 할 일이 없어요. 위에서 하나씩 추가해 보세요.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className={s.empty}>
                <p>
                  {todoInstalled
                    ? "할 일 사용이 꺼져 있어요. 켜면 저장한 항목을 다시 볼 수 있어요."
                    : "할 일을 설치하면 계정 없이 수집함을 사용할 수 있어요."}
                </p>
                <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                  {todoInstalled ? "할 일 켜기" : "할 일 설치"}
                </Button>
              </div>
            )}
          </PlannerPanel>
          {!embedded && (
            <TabPanel tabs={tabsId} value="calendar" selected={tab} className={s.panel}>
              <PlannerCalendar
                day={day}
                setDay={setDay}
                events={events}
                selected={text(event?.id)}
                onSelect={(value) => setSelectedEvent(text(value.id))}
                connections={connections}
                colors={record(record(calendar?.data).calendarColors)}
                busy={busy}
                onColorChange={
                  calendar ? (input) => void act("set-calendar-color", input, calendar) : undefined
                }
                side={
                  <>
                    {calendar ? (
                      prep()
                    ) : (
                      <Button variant="secondary" onClick={() => openSettings()}>
                        캘린더 연결
                      </Button>
                    )}
                    <section className={s.section}>
                      <h3 className={s.heading}>시간을 정한 할 일</h3>
                      {items
                        .filter(
                          (item) =>
                            typeof item.completedAt !== "number" &&
                            typeof item.dueAt === "number" &&
                            dueDay(item) === day,
                        )
                        .sort((a, b) => number(a.dueAt) - number(b.dueAt))
                        .map((item) => (
                          <div key={text(item.id)} className={s.actions}>
                            <span className={s.caption}>{clockLabel(number(item.dueAt))}</span>
                            {taskCheck(item)}
                            <Button
                              variant="quiet"
                              size="compact"
                              aria-label={`${text(item.title)} 시간 수정`}
                              onClick={() => edit(item)}
                            >
                              수정
                            </Button>
                          </div>
                        ))}
                      <h3 className={s.heading}>아직 시간을 정하지 않은 일</h3>
                      {remaining
                        .filter((item) => typeof item.dueAt !== "number")
                        .map((item) => (
                          <div key={text(item.id)} className={s.actions}>
                            {taskCheck(item)}
                            <Button
                              variant="quiet"
                              size="compact"
                              aria-label={`${text(item.title)} 시간 잡기`}
                              onClick={() => edit(item)}
                            >
                              시간 잡기
                            </Button>
                          </div>
                        ))}
                      <p className={s.caption}>
                        내장 할 일의 기한만 바뀝니다. 외부 일정은 수정하지 않아요.
                      </p>
                    </section>
                  </>
                }
              />
            </TabPanel>
          )}
          <PlannerPanel tabs={tabsId} embedded={embedded} current={tab} value="templates">
            {todo ? (
              <PlannerTemplates
                act={act}
                busy={busy}
                onDirtyChange={setTemplateDirty}
                onShowPlans={(value, anchor) => {
                  setPeriod(value);
                  setPlanDay(anchor);
                  setTab("plans");
                }}
              />
            ) : (
              <div className={s.empty}>
                <p>할 일을 시작하면 템플릿을 사용할 수 있어요.</p>
                <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                  {todoInstalled ? "할 일 켜기" : "할 일 설치"}
                </Button>
              </div>
            )}
          </PlannerPanel>
        </div>
      )}
      <footer className={embedded && tab === "today" ? s.visuallyHidden : s.footer}>
        {tab === "today"
          ? embedded || allTasks
            ? `모든 날짜와 날짜 없는 할 일을 함께 봅니다. 새 할 일의 계획일은 선택일 ${day}입니다.`
            : `선택일 ${day}에 계획한 일을 모아 봅니다. 계획 날짜와 기한은 별개입니다.`
          : tab === "plans"
            ? "계획 기간은 목표를 묶는 기준입니다. 오늘에 넣어도 기한이나 반복 규칙은 바뀌지 않습니다."
            : tab === "calendar"
              ? "읽기 연결 · 외부 일정은 원본 캘린더에서 관리합니다."
              : "템플릿은 새 할 일을 만듭니다. 기존 항목의 제목과 반복은 바꾸지 않습니다."}
      </footer>
      {editing && (
        <TodoEditor
          key={`${text(editing.item.id)}:${editing.widget.revision}`}
          widgetId={editing.widget.id}
          item={editing.item}
          lists={lists}
          busy={busy}
          act={(action, input) => {
            const latest = items.find((item) => item.id === editing.item.id);
            if (!todo || JSON.stringify(latest) !== JSON.stringify(editing.item)) {
              setFailure({
                message:
                  "이 항목이 다른 곳에서 변경되었습니다. 최신 내용을 다시 불러와 확인해 주세요.",
                saving: false,
              });
              return Promise.resolve(false);
            }
            return act(action, input, todo);
          }}
          onReload={() => {
            const latest = items.find((item) => item.id === editing.item.id);
            if (latest && todo) setEditing({ item: latest, widget: todo });
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {movingTask && (
        <Dialog
          isOpen
          title="할 일 옮기기"
          size="small"
          onOpenChange={(open) => {
            if (!open && !busy) setMovingTask(null);
          }}
        >
          <form
            className={s.form}
            onSubmit={async (event) => {
              event.preventDefault();
              const item = items.find((value) => value.id === movingTask.id);
              if (item && (await moveTaskDate(item, movingTask.date))) setMovingTask(null);
            }}
          >
            {failure && (
              <p role="alert" className={s.error}>
                {failure.message}
              </p>
            )}
            <FormField label="옮길 할 일">
              <Select
                value={movingTask.id}
                disabled={busy}
                onChange={(event) => setMovingTask({ ...movingTask, id: event.target.value })}
              >
                {items
                  .filter((item) => typeof item.completedAt !== "number")
                  .map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.title)}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="새 계획 날짜">
              <DateField
                required
                disabled={busy}
                value={movingTask.date}
                onChange={(event) => setMovingTask({ ...movingTask, date: event.target.value })}
              />
            </FormField>
            <div className={s.actions}>
              <Button variant="quiet" disabled={busy} onClick={() => setMovingTask(null)}>
                취소
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !todo ||
                  !movingTask.date ||
                  !items.some((item) => item.id === movingTask.id)
                }
              >
                선택한 날로 옮기기
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      <Dialog
        isOpen={wrap}
        title={`${day} 하루 마무리`}
        size="small"
        onOpenChange={(open) => {
          if (!busy) setWrap(open);
        }}
        closeLabel="하루 마무리 닫기"
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("plan", { ids: rollIds, date: rollDate })) setWrap(false);
          }}
        >
          {failure && (
            <p role="alert" className={s.error}>
              {failure.message}
            </p>
          )}
          <p className={s.caption}>
            선택일 {day} · 완료 {chosen.length - remaining.length}개 · 남은 일 {remaining.length}개.
            옮길 일만 골라요.
          </p>
          {remaining.map((item) => (
            <Checkbox
              key={text(item.id)}
              checked={rollIds.includes(text(item.id))}
              onChange={(e) =>
                setRollIds((old) =>
                  e.target.checked ? [...old, text(item.id)] : old.filter((id) => id !== item.id),
                )
              }
            >
              {text(item.title)}
            </Checkbox>
          ))}
          <FormField label="옮길 날짜" className={s.field}>
            <DateField required value={rollDate} onChange={(e) => setRollDate(e.target.value)} />
          </FormField>
          <p className={s.caption}>
            선택하지 않은 일은 {day}에 그대로 남아요. 원래 기한과 계획 기간은 유지합니다.
          </p>
          <div className={s.actions}>
            <Button variant="quiet" type="button" onClick={() => setWrap(false)}>
              그대로 마치기
            </Button>
            <div className={s.spacer} />
            <Button type="submit" variant="primary" disabled={busy || !rollIds.length}>
              선택한 {rollIds.length}개 옮기기
            </Button>
          </div>
        </form>
      </Dialog>
      <ListManager
        isOpen={manageLists}
        lists={lists}
        items={items}
        act={act}
        busy={busy}
        failure={failure?.message ?? null}
        onClose={() => setManageLists(false)}
      />
      <Dialog
        isOpen={confirmClose}
        title="작성 중인 내용이 있어요"
        variant="confirm"
        closeLabel="플래너 종료 확인 닫기"
        onOpenChange={(open) => {
          if (!open) returning.current = false;
          setConfirmClose(open);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                returning.current = false;
                setConfirmClose(false);
              }}
            >
              계속 작성
            </Button>
            <Button
              variant="critical"
              onClick={async () => {
                leaving.current = true;
                await closeWindow();
              }}
            >
              버리고 나가기
            </Button>
          </>
        }
      >
        <p>저장하지 않은 내용을 버리고 나갈까요?</p>
      </Dialog>
    </Root>
  );
}

function ListManager({
  isOpen,
  lists,
  items,
  act,
  busy,
  failure,
  onClose,
}: {
  isOpen: boolean;
  lists: DataRecord[];
  items: DataRecord[];
  act: ToolAction;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setRenames({});
    }
  }, [isOpen]);
  return (
    <Dialog
      isOpen={isOpen}
      title="목록 관리"
      size="small"
      closeLabel="목록 관리 닫기"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <div className={s.form}>
        {failure && (
          <p role="alert" className={s.error}>
            {failure}
          </p>
        )}
        <form
          className={s.quick}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("list-add", { name })) setName("");
          }}
        >
          <TextField
            className={s.grow}
            aria-label="새 목록 이름"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            목록 추가
          </Button>
        </form>
        {lists.map((list) => (
          <form
            key={text(list.id)}
            className={s.quick}
            onSubmit={(e) => {
              e.preventDefault();
              void act("list-rename", {
                id: text(list.id),
                name: renames[text(list.id)] ?? text(list.name),
              });
            }}
          >
            <TextField
              className={s.grow}
              aria-label={`${text(list.name)} 이름`}
              required
              maxLength={100}
              value={renames[text(list.id)] ?? text(list.name)}
              onChange={(e) => setRenames((old) => ({ ...old, [text(list.id)]: e.target.value }))}
            />
            <Button type="submit" variant="secondary" size="compact" disabled={busy}>
              이름 저장
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="compact"
              disabled={
                busy || list.id === "default" || items.some((item) => item.listId === list.id)
              }
              onClick={() => void act("list-delete", { id: text(list.id) })}
            >
              빈 목록 삭제
            </Button>
          </form>
        ))}
      </div>
    </Dialog>
  );
}
