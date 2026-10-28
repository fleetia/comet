import { TabPanel, externalTabPanels } from "../../primitives";
import { Button, IconButton, Tabs } from "@comet/ui";
import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
import { localDay, number, record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { PlannerCalendar } from "./PlannerCalendar";
import { PlannerPreparation } from "./PlannerPreparation";
import { PlannerTemplates } from "./PlannerTemplates";
import { TodoEditor, type TodoEditorField } from "./TodoEditor";
import {
  dayDate,
  deviceTimeZone,
  eventsOn,
  inPeriod,
  moveDay,
  movePeriod,
  periodAnchor,
  plannedDay,
  ruleOf,
} from "./plannerData";
import { usePlannerActions } from "./usePlannerActions";
import { usePlannerTasks } from "./usePlannerTasks";
import { usePlannerLeave } from "./usePlannerLeave";
import { PlannerCloseDialog } from "./PlannerCloseDialog";
import { PlannerListManager } from "./PlannerListManager";
import { PlannerMoveTaskDialog } from "./PlannerMoveTaskDialog";
import { PlannerWrapDialog } from "./PlannerWrapDialog";
import {
  elapsedWithin,
  focusDuration,
  focusSessions,
  taskFocusInput,
} from "../PlanningTools/FocusTimerData";
import { PlannerTodoEmpty } from "./PlannerTodoEmpty";
import { PlannerTaskCheck } from "./PlannerTaskCheck";
import { PlannerQuickInput } from "./PlannerQuickInput";
import { PlannerTaskActions } from "./PlannerTaskActions";
import { PlannerDiaryTasks } from "./PlannerDiaryTasks";
import { PlannerDayAgenda } from "./PlannerDayAgenda";
import { PlannerDayTaskList } from "./PlannerDayTaskList";
import { PlannerPlans } from "./PlannerPlans";
import { PlannerTimedTasks } from "./PlannerTimedTasks";
import * as s from "./planner.css";

function focusWithin(data: DataRecord, day: string): number {
  const start = new Date(`${day}T00:00:00`).getTime();
  const end = new Date(`${moveDay(day, 1)}T00:00:00`).getTime();
  return focusSessions(data, Date.now()).reduce(
    (sum, session) => sum + elapsedWithin(session, start, end),
    0,
  );
}

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
  habitSummary,
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
  /** Scheduled and filled habits of the selected day, known only inside the diary. */
  habitSummary?: { done: number; total: number };
} = {}): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const widgets = snapshot?.widgets ?? [];
  const enabled = (kind: string): WidgetView | undefined =>
    widgets.find((w) => w.kind === kind);
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
  const [movingTask, setMovingTask] = useState<{ id: string; date: string } | null>(null);
  const [editing, setEditing] = useState<{
    item: DataRecord;
    widget: WidgetView;
    field?: TodoEditorField;
  } | null>(null);
  const [wrap, setWrap] = useState(false);
  const [rollIds, setRollIds] = useState<string[]>([]);
  const [rollDate, setRollDate] = useState(moveDay(localDay(), 1));
  const [manageLists, setManageLists] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [preparationDirty, setPreparationDirty] = useState(false);
  const [preparationBusy, setPreparationBusy] = useState(false);
  useEffect(() => {
    setEditing(null);
    setManageLists(false);
    setWrap(false);
    setMovingTask(null);
  }, [dismissVersion]);
  const blocking = Boolean(
    editing || manageLists || wrap || movingTask || preparationDirty || preparationBusy,
  );
  const dirty = Boolean(blocking || title.trim() || templateDirty);
  const leave = usePlannerLeave({
    embedded,
    initialTab,
    state: { dirty, busy: busy || preparationBusy, blocking },
    onStateChange,
    onBack,
    isTab: (value) => NAVIGATION.some(([key]) => key === value),
    setTab,
    setFailure,
  });
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

  function openSettings(kind = "calendar"): void {
    if (isDesktop()) void run(() => command("open_planner_settings", { kind }));
    else window.location.assign(`/?view=settings&section=widgets&preview=installed`);
  }
  function edit(item: DataRecord, field?: TodoEditorField): void {
    if (todo) setEditing({ item, widget: todo, field });
  }
  function taskCheck(item: DataRecord): ReactElement {
    return (
      <PlannerTaskCheck
        item={item}
        recordingDay={tab === "plans" ? planDay : day}
        selected={selectedTask === item.id}
        busy={busy}
        onSelect={setSelectedTask}
        onCheck={check}
      />
    );
  }
  const quickList = lists.some((list) => list.id === newTaskList) ? newTaskList : "default";
  async function addTask(isToday: boolean): Promise<void> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || Array.from(title).length > 500) {
      setFailure({
        message: trimmedTitle
          ? "할 일 제목은 500자 이내로 입력해 주세요."
          : "할 일 제목을 입력해 주세요.",
        saving: false,
      });
      return;
    }
    const diaryQuickAdd = embedded && isToday;
    if (
      await act("add", {
        title,
        listId: diaryQuickAdd ? quickList : visibleList === "all" ? "default" : visibleList,
        plannedDate: isToday ? day : null,
        planPeriod: isToday || period === "inbox" ? "none" : period,
        planAnchor:
          isToday || ["inbox", "someday"].includes(period) ? null : periodAnchor(period, planDay),
      })
    )
      setTitle("");
  }
  function quickInput(isToday: boolean): ReactElement {
    return (
      <PlannerQuickInput
        isToday={isToday}
        embedded={embedded}
        day={day}
        period={period}
        planScope={planScope}
        title={title}
        busy={busy}
        hasTodo={Boolean(todo)}
        lists={lists}
        quickList={quickList}
        onTitleChange={setTitle}
        onDayChange={setDay}
        onListChange={setNewTaskList}
        onTemplates={() => selectTab("templates")}
        onSubmit={() => addTask(isToday)}
      />
    );
  }
  function openWrap(): void {
    setRollIds(remaining.map((item) => text(item.id)));
    setRollDate(moveDay(day, 1));
    setWrap(true);
  }
  async function focusSelected(): Promise<void> {
    if (!currentTask) return;
    if (!timer) {
      openSettings("focus-timer");
      return;
    }
    if (await act("start", taskFocusInput(currentTask), timer)) {
      setNotice("25분 집중을 시작했어요. 할 일 완료는 직접 표시해 주세요.");
      await run(() => command("open_widget", { id: timer.id }));
    }
  }
  function taskActions(selectionOnly = false): ReactElement {
    return (
      <PlannerTaskActions
        currentTask={currentTask}
        day={day}
        busy={busy}
        showWrap={!selectionOnly && !headerActionsTarget}
        onFocus={focusSelected}
        onRemove={() => void act("plan", { ids: [selectedTask], date: null })}
        onWrap={openWrap}
      />
    );
  }
  function diaryTasks(): ReactElement {
    return (
      <PlannerDiaryTasks
        day={day}
        items={items}
        lists={lists}
        envelopes={rows(record(preparation?.data).envelopes)}
        todo={todo}
        calendar={calendar}
        busy={busy}
        act={act}
        selectedTask={selectedTask}
        showCompleted={showCompleted}
        headerActions={Boolean(headerActionsTarget)}
        inboxCount={inboxCount}
        quickInput={quickInput(true)}
        taskActions={taskActions(true)}
        onSelectTask={setSelectedTask}
        onToggleCompleted={() => setShowCompleted((value) => !value)}
        onCheck={check}
        onEdit={edit}
        onMoveTaskDate={moveTaskDate}
        onStartMove={setMovingTask}
        onOpenInbox={() => {
          setPeriod("inbox");
          selectTab("plans");
        }}
        onManageLists={() => setManageLists(true)}
        onWrap={openWrap}
      />
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
              <Button variant="ghost" size="small" disabled={busy} onClick={openWrap}>
                하루 마무리
              </Button>
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
          onClose={leave.closeWindow}
          actions={
            onBack && (
              <Button variant="ghost" size="small" onClick={leave.returnToDiary}>
                다이어리로 돌아가기
              </Button>
            )
          }
        />
      )}
      {loadError && (
        <div role="alert" className={s.error}>
          목록을 불러오지 못했어요. {loadError}{" "}
          <Button variant="ghost" size="small" onClick={reload}>
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
            variant="ghost"
            size="small"
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
              <Button variant="ghost" size="small" onClick={() => openSettings()}>
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
                    variant="ghost"
                    size="small"
                    aria-label="이전 날짜"
                    onClick={() => setDay(moveDay(day, -1))}
                  >
                    ‹
                  </Button>
                  <Button variant="ghost" size="small" onClick={() => setDay(localDay())}>
                    오늘
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
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
                    <PlannerDayAgenda
                      day={day}
                      calendar={calendar}
                      connections={connections}
                      events={events}
                      dailyEvents={dailyEvents}
                      event={event}
                      lastSuccess={lastSuccess}
                      preparation={prep()}
                      onSelectEvent={setSelectedEvent}
                      onOpenSettings={() => openSettings()}
                    />
                  )}
                  <PlannerDayTaskList
                    day={day}
                    allTasks={allTasks}
                    displayedTasks={displayedTasks}
                    lists={lists}
                    inboxCount={inboxCount}
                    selectedTask={selectedTask}
                    hasTodo={Boolean(todo)}
                    calendar={calendar}
                    busy={busy}
                    act={act}
                    quickInput={quickInput(true)}
                    taskActions={taskActions()}
                    renderCheck={taskCheck}
                    onToggleAllTasks={() => setAllTasks((value) => !value)}
                    onOpenInbox={() => {
                      setPeriod("inbox");
                      selectTab("plans");
                    }}
                    onTemplates={() => selectTab("templates")}
                    onSelectTask={setSelectedTask}
                    onEdit={edit}
                  />
                </div>
              </>
            )}
          </PlannerPanel>
          <PlannerPanel tabs={tabsId} embedded={embedded} current={tab} value="plans">
            <PlannerPlans
              period={period}
              planDay={planDay}
              planScope={planScope}
              shown={shown}
              items={items}
              lists={lists}
              visibleList={visibleList}
              showCompleted={showCompleted}
              hasTodo={Boolean(todo)}
              headerActions={Boolean(headerActionsTarget)}
              busy={busy}
              act={act}
              quickInput={quickInput(false)}
              renderCheck={taskCheck}
              onPeriodChange={setPeriod}
              onPlanDayChange={setPlanDay}
              onVisibleListChange={setVisibleList}
              onShowCompletedChange={setShowCompleted}
              onManageLists={() => setManageLists(true)}
              onEdit={edit}
            />
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
                      <Button variant="ghost" onClick={() => openSettings()}>
                        캘린더 연결
                      </Button>
                    )}
                    <PlannerTimedTasks
                      day={day}
                      items={items}
                      remaining={remaining}
                      renderCheck={taskCheck}
                      onEdit={edit}
                    />
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
              <PlannerTodoEmpty
                message="할 일을 시작하면 템플릿을 사용할 수 있어요."
              />
            )}
          </PlannerPanel>
        </div>
      )}
      <footer className={embedded && tab === "today" ? s.visuallyHidden : s.footer}>
        {tab === "today"
          ? embedded || allTasks
            ? `모든 날짜와 날짜 없는 할 일을 함께 봅니다. 새 할 일의 계획일은 선택일 ${day}입니다.`
            : `선택일 ${day}에 계획한 일을 모아 봅니다.`
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
          focus={editing.field}
          onMovePlan={moveTaskDate}
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
            if (latest && todo) setEditing({ item: latest, widget: todo, field: editing.field });
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {movingTask && (
        <PlannerMoveTaskDialog
          movingTask={movingTask}
          items={items}
          hasTodo={Boolean(todo)}
          busy={busy}
          failure={failure}
          onChange={setMovingTask}
          onMove={moveTaskDate}
          onClose={() => setMovingTask(null)}
        />
      )}
      <PlannerWrapDialog
        isOpen={wrap}
        day={day}
        completedCount={chosen.length - remaining.length}
        focusLabel={timer ? focusDuration(focusWithin(record(timer.data), day)) : undefined}
        habits={habitSummary}
        remaining={remaining}
        rollIds={rollIds}
        rollDate={rollDate}
        busy={busy}
        failure={failure}
        act={act}
        onOpenChange={setWrap}
        onRollIdsChange={setRollIds}
        onRollDateChange={setRollDate}
      />
      <PlannerListManager
        isOpen={manageLists}
        lists={lists}
        items={items}
        act={act}
        busy={busy}
        failure={failure?.message ?? null}
        onClose={() => setManageLists(false)}
      />
      <PlannerCloseDialog
        isOpen={leave.confirmClose}
        onOpenChange={leave.onConfirmOpenChange}
        onKeep={leave.keepWriting}
        onDiscard={leave.discardAndLeave}
      />
    </Root>
  );
}
