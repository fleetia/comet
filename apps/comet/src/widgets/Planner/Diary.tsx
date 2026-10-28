import { Button, Surface } from "@comet/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { useDiaryWidgetActions } from "./useDiaryWidgetActions";
import { useDiaryTasks } from "./useDiaryTasks";
import { useCalendarClock, useDiaryCalendarEvents } from "./useDiaryCalendarEvents";
import { DiaryEventDialog } from "./DiaryEventDialog";
import { useDiaryCreation } from "./useDiaryCreation";
import { DiaryNewPageDialog } from "./DiaryNewPageDialog";
import { useDiaryWidgetDrop } from "./useDiaryWidgetDrop";
import { useDiaryQuickTask } from "./useDiaryQuickTask";
import { DiaryQuickTaskForm } from "./DiaryQuickTaskForm";
import { useDiaryLeave } from "./useDiaryLeave";
import { useDiaryNativeEvents, type DiaryViewTarget } from "./useDiaryNativeEvents";
import { DiaryLeaveDialog } from "./DiaryLeaveDialog";
import { DiaryRail } from "./DiaryRail";
import { DiaryEnvelopeIndex } from "./DiaryEnvelopeIndex";
import { DiaryPageToolbar } from "./DiaryPageToolbar";
import { isPlannerTool, toolForTab, type DiaryTool, type View } from "./diaryNavigation";
import { localDay, record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { DiaryCalendar } from "./DiaryCalendar";
import { PreparationCreate } from "../PreparationTool/PreparationCreate";
import { DiaryEnvelope, envelopeTitle } from "./DiaryEnvelope";
import { OrganizerRecords } from "./OrganizerRecords";
import { DiaryJournal } from "./DiaryJournal";
import { DiaryNotes, discardDiaryEnvelopeNoteDrafts } from "./DiaryNotes";
import { DiaryPage, discardDiaryPageDraft, type DiaryPageProps } from "./DiaryPage";
import { DiaryCollectionPage, discardDiaryCollectionDraft } from "./DiaryCollectionPage";
import { DiaryPageMenu } from "./DiaryPageMenu";
import type { DiaryAction, DiaryEntry, DiaryPage as Page } from "./diaryTypes";
import { LocalEventEditor } from "./LocalEventEditor";
import { DiaryToday } from "./DiaryToday";
import { DiaryHabits } from "./DiaryHabits";
import { DiaryLedger } from "./DiaryLedger";
import { Planner, type PlannerToolState } from "./Planner";
import { DiaryCalendarContext } from "./DiaryCalendarContext";
import { TodoEditor } from "./TodoEditor";
import { dayDate, deviceTimeZone, eventsOn, moveDay, periodAnchor } from "./plannerData";
import { useDiary } from "./useDiary";
import { habitCompleted, habitScheduled } from "./diaryHabitData";
import type { DiaryState } from "./diaryTypes";
import { colorForEvent } from "./calendarColorData";
import { focusSessions } from "../PlanningTools/FocusTimerData";
import * as s from "./diary.css";

const EMPTY_TOOL_STATE: PlannerToolState = { dirty: false, busy: false, blocking: false };

function habitSummary(state: DiaryState | null | undefined, day: string): { done: number; total: number } {
  const habits = (state?.habits ?? []).filter(
    (habit) => !habit.archived && habitScheduled(habit, day),
  );
  const done = habits.filter((habit) =>
    habitCompleted(
      habit,
      state?.habitChecks?.find((check) => check.habitId === habit.id && check.date === day),
    ),
  ).length;
  return { done, total: habits.length };
}

export function Diary({ onClose }: { onClose?: () => void } = {}): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const diary = useDiary();
  const [day, setDay] = useState(localDay());
  const [todayTab, setTodayTab] = useState<"summary" | "journal">("summary");
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).get("tab") === "calendar" ? "month" : "day",
  );
  const [pageId, setPageId] = useState("");
  const [envelopeId, setEnvelopeId] = useState("");
  const [tool, setTool] = useState<DiaryTool | null>(() =>
    toolForTab(new URLSearchParams(location.search).get("tab")),
  );
  const [toolsOpened, setToolsOpened] = useState(isPlannerTool(tool));
  const [toolState, setToolState] = useState<PlannerToolState>(EMPTY_TOOL_STATE);
  const [plannerHeader, setPlannerHeader] = useState<HTMLDivElement | null>(null);
  const [toolDismissVersion, setToolDismissVersion] = useState(0);
  const [viewTarget, setViewTarget] = useState<DiaryViewTarget | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [collection, setCollection] = useState<"pages" | "envelopes" | null>(() =>
    new URLSearchParams(location.search).get("tab") === "envelopes" ? "envelopes" : null,
  );
  const [requestedNote, setRequestedNote] = useState<{ id: string; version: number } | null>(null);
  const [requestedHabit, setRequestedHabit] = useState<{ id: string; version: number } | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<DataRecord | null>(null);
  const [notice, setNotice] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const bodyScope = tool
    ? `tool:${tool}`
    : envelopeId
      ? `envelope:${envelopeId}`
      : pageId
        ? `page:${pageId}`
        : `${view}:${view === "month" ? day.slice(0, 7) : day}`;
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = scrollPositions.current[bodyScope] ?? 0;
  }, [bodyScope]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pageDirty, setPageDirty] = useState(false);
  const [pageContentVersion, setPageContentVersion] = useState(0);
  const [notesDirty, setNotesDirty] = useState(false);
  const [featureDirty, setFeatureDirty] = useState(false);
  const [featureContentVersion, setFeatureContentVersion] = useState(0);
  const calendarNow = useCalendarClock(view === "week" && !pageId && !tool);
  const [pageMenuDirty, setPageMenuDirty] = useState(false);
  const [pageMenuVersion, setPageMenuVersion] = useState(0);
  const widgets = snapshot?.widgets ?? [];
  const enabled = (kind: string): WidgetView | undefined =>
    widgets.find((widget) => widget.kind === kind && widget.installed && widget.enabled);
  const todo = enabled("todo"),
    calendar = enabled("calendar"),
    preparation = enabled("preparation");
  const items = rows(record(todo?.data).items),
    lists = rows(record(todo?.data).lists);
  const connections = rows(record(calendar?.data).connections);
  const events = rows(record(calendar?.data).events).filter(
    (event) =>
      !event.cancelled &&
      (event.connectionId === "local" ||
        connections.some((connection) => connection.id === event.connectionId)),
  );
  const envelopes = rows(record(preparation?.data).envelopes);
  useEffect(() => {
    if (collection !== "envelopes" || envelopeId || !envelopes.length) return;
    setEnvelopeId(text(envelopes.find((value) => value.archived !== true)?.id ?? envelopes[0]?.id));
  }, [collection, envelopeId, envelopes]);
  const pages = diary.state?.pages ?? [],
    notes = diary.state?.notes ?? [];
  const page = pageId
    ? pages.find((value) => value.id === pageId)
    : pages.find((value) => value.date === day);
  const envelope = envelopes.find((value) => value.id === envelopeId);
  const actions = useDiaryWidgetActions({ snapshot, todo, reload, setFailure });
  const { busy, pending, latestWidgets, run, act, ensureWidget } = actions;
  const diaryAction: DiaryAction = async (action, input) =>
    Boolean(await diary.mutate(action, input));
  const {
    completionUndo,
    planTask,
    createTask,
    toggleTask,
    undoCompletion,
    focusTask,
    focusEnvelope,
  } = useDiaryTasks({
    actions,
    diaryAction,
    todo,
    timer: enabled("focus-timer"),
    calendar,
    envelope,
    events,
    day,
    reload,
    setFailure,
    setNotice,
  });
  const {
    selectedEvent,
    setSelectedEvent,
    calendarDraft,
    setCalendarDraft,
    calendarDirty,
    setCalendarDirty,
    saveCalendarEvent,
    reloadCalendarEvent,
  } = useDiaryCalendarEvents({ actions, reload });
  const creation = useDiaryCreation({
    actions,
    mutate: diary.mutate,
    page,
    day,
    reload,
    onPageCreated: (id) => {
      setTool(null);
      setPageId(id);
      setEnvelopeId("");
      setView("day");
    },
    onEnvelopeCreated: (id) => {
      setTool(null);
      setEnvelopeId(id);
      setPageId("");
    },
  });
  const {
    creating,
    setCreating,
    name,
    setName,
    envelopeCreateDirty,
    setEnvelopeCreateDirty,
    createPage,
    createEnvelope,
  } = creation;
  const drop = useDiaryWidgetDrop({
    actions,
    otherBusy: busy || diary.busy || toolState.busy,
    mutate: diary.mutate,
    diaryAction,
    planTask,
    pages,
    pageId,
    envelopeId,
    day,
    view,
    tool,
    reload,
    setFailure,
    setNotice,
  });
  const { addingWidget, addWidgetItem } = drop;
  const saving = busy || diary.busy || addingWidget || toolState.busy;
  const quickTask = useDiaryQuickTask({
    defaultDate: tool || pageId || envelopeId ? null : day,
    saving,
    pending,
    createTask,
  });
  const { leave, setLeave, navigate, navigateRef, blocking } = useDiaryLeave({
    saving,
    unsaved:
      pageDirty ||
      pageMenuDirty ||
      featureDirty ||
      calendarDirty ||
      Boolean(editing) ||
      envelopeCreateDirty ||
      Boolean(name) ||
      Boolean(quickTask.title) ||
      toolState.blocking,
    closingUnsaved: notesDirty || toolState.dirty,
  });
  const close = (): void => {
    if (onClose) { onClose(); return; }
    if (isDesktop())
      void getCurrentWindow()
        .destroy()
        .catch((cause: unknown) => setFailure(errorText(cause)));
  };
  // Project the visible calendar into the existing native animation condition.
  const nativeTab =
    notesOpen || collection
      ? "today"
      : ((tool === "today" ? "todos" : tool) ??
        (!pageId && !envelopeId && view !== "day" ? "calendar" : "today"));
  const navigationReady = useDiaryNativeEvents({
    navigateRef,
    blocking,
    close,
    nativeTab,
    setFailure,
    setViewTarget,
    onNote: (id) => {
      setNotesOpen(true);
      setRequestedNote((previous) => ({ id, version: (previous?.version ?? 0) + 1 }));
    },
    onTab: (tab, resetCollections) => {
      if (resetCollections || tab === "envelopes" || tab === "time") {
        setNotesOpen(false);
      }
      setCollection(tab === "envelopes" ? "envelopes" : null);
      const nextTool = toolForTab(tab);
      setTool(nextTool);
      if (isPlannerTool(nextTool)) setToolsOpened(true);
      setView(tab === "calendar" ? "month" : "day");
      if (tab === "time") setTodayTab("summary");
      setDay(localDay());
      setPageId("");
      setEnvelopeId("");
      setCalendarDraft(null);
      setCalendarDirty(false);
      setSelectedEvent(null);
      setCreating(null);
    },
  });
  function openDay(
    date: string,
    nextView: View = "day",
    nextTab: "summary" | "journal" = "summary",
  ): void {
    navigate(() => {
      setTool(null);
      setNotesOpen(false);
      setCollection(null);
      setDay(date);
      setView(nextView);
      setTodayTab(nextTab);
      setPageId("");
      setEnvelopeId("");
      setPageDirty(false);
    });
  }
  function openPage(value: Page): void {
    if (value.date) openDay(value.date, "day", "journal");
    else
      navigate(() => {
        setTool(null);
        setNotesOpen(false);
        setCollection("pages");
        setPageId(value.id);
        setEnvelopeId("");
        setView("day");
        setPageDirty(false);
      });
  }
  function openEnvelope(id: string): void {
    navigate(() => {
      setTool(null);
      setNotesOpen(false);
      setCollection("envelopes");
      setEnvelopeId(id);
      setPageId("");
      setPageDirty(false);
    });
  }
  useEffect(() => {
    if (!viewTarget || !navigationReady || !diary.state || !snapshot || saving) return;
    setViewTarget(null);
    if (viewTarget.entity === "page") {
      const page = diary.state.pages.find((value) => value.id === viewTarget.targetId);
      if (page) openPage(page);
      else setFailure("해당 기록을 현재 찾을 수 없어요. 원본이 삭제되었는지 확인해 주세요.");
      return;
    }
    if (viewTarget.entity === "envelope") {
      if (envelopes.some((value) => value.id === viewTarget.targetId)) openEnvelope(viewTarget.targetId);
      else setFailure("해당 봉투를 현재 찾을 수 없어요. 봉투가 삭제되었는지 확인해 주세요.");
      return;
    }
    if (viewTarget.entity === "todo") {
      const item = items.find((value) => value.id === viewTarget.targetId);
      navigateRef.current(() => {
        setNotesOpen(false);
        setCollection(null);
        setToolsOpened(true);
        setTool("today");
        if (item) setEditing(item);
      });
      return;
    }
    if (viewTarget.entity === "habit") {
      const habit = diary.state.habits?.find((value) => value.id === viewTarget.targetId);
      navigateRef.current(() => {
        setNotesOpen(false);
        setCollection(null);
        setTool("habits");
        if (habit)
          setRequestedHabit((previous) => ({ id: habit.id, version: (previous?.version ?? 0) + 1 }));
      });
      return;
    }
    const event = events.find((value) => value.id === viewTarget.targetId);
    if (!event) {
      setFailure(
        "해당 일정을 현재 찾을 수 없어요. 원본이 삭제되었거나 연결이 끊겼는지 확인해 주세요.",
      );
      return;
    }
    navigateRef.current(() => {
      setTool(null);
      setNotesOpen(false);
      setCollection(null);
      setPageId("");
      setEnvelopeId("");
      setView("month");
      setDay(
        event.allDay && text(event.startDate)
          ? text(event.startDate)
          : typeof event.startAt === "number"
            ? localDay(new Date(event.startAt))
            : localDay(),
      );
      setSelectedEvent(event);
    });
  }, [viewTarget, navigationReady, diary.state, snapshot, saving]);

  function openTool(next: DiaryTool): void {
    navigate(() => {
      setNotesOpen(false);
      setCollection(null);
      if (isPlannerTool(next)) setToolsOpened(true);
      setTool(next);
    });
  }
  function openSettings(): void {
    if (isDesktop()) void run(() => command("open_planner_settings", { kind: "calendar" }));
    else window.location.assign("/?view=settings&section=widgets&preview=installed");
  }
  function changeView(value: View): void {
    openDay(day, value);
  }
  function openCalendarEvent(event: DataRecord, date = day): void {
    navigate(() => {
      setDay(date);
      setSelectedEvent(event);
    });
  }
  function openSourceWidget(widget: WidgetView, itemId?: string): void {
    if (!widget.installed || !widget.enabled) {
      setFailure("위젯 설정에서 이 도구를 먼저 켜 주세요.");
      return;
    }
    if (!itemId && (widget.kind === "todo" || widget.kind === "calendar")) {
      if (widget.kind === "calendar") openDay(day, "month");
      else openTool("today");
      return;
    }
    void run(() =>
      itemId
        ? command("open_memo_note", { id: widget.id, noteId: itemId })
        : command("open_widget", { id: widget.id }),
    );
  }
  function openWidgetEntry(entry: DiaryEntry): void {
    const widget = widgets.find((value) => value.id === entry.refId);
    if (widget) openSourceWidget(widget, entry.itemId);
    else setFailure("원본 위젯을 찾을 수 없어요.");
  }
  const diaryPageProps: DiaryPageProps = {
    page,
    date: day,
    items,
    events: pageId ? [] : eventsOn(events, day),
    envelopes,
    moves: diary.state?.moves ?? [],
    widgets,
    onOpenWidgetEntry: openWidgetEntry,
    onOpenEvent: openCalendarEvent,
    busy: saving,
    onDiaryAction: diaryAction,
    onAddTask: (title) => createTask(title, pageId ? null : day),
    onToggleTask: (item) => void toggleTask(item),
    onEditTask: setEditing,
    onFocusTask: (item) => void focusTask(item),
    onMoveTask: planTask,
    onOpenEnvelope: openEnvelope,
    onCreatePage: createPage,
    onDirtyChange: setPageDirty,
  };
  const diaryPageContent =
    pageId && page?.date === null ? (
      <DiaryCollectionPage
        {...diaryPageProps}
        key={`page:${pageId}:${pageContentVersion}`}
        page={page}
        pages={pages}
        onOpenSourcePage={(source) => {
          if (source.date) openDay(source.date, "day", "journal");
          else openPage(source);
        }}
        onDeleted={() => {
          setPageId("");
          setPageDirty(false);
          setPageMenuDirty(false);
        }}
      />
    ) : (
      <DiaryPage
        {...diaryPageProps}
        key={`${pageId ? `page:${pageId}` : `day:${day}`}:${pageContentVersion}`}
      />
    );
  const weekStart = periodAnchor("week", day);
  const dateLabel = dayDate(day).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const heading = pageId
    ? (page?.title ?? "페이지")
    : view === "month"
      ? dayDate(day).toLocaleDateString("ko-KR", { year: "numeric", month: "long" })
      : view === "week"
        ? `${dayDate(weekStart).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} — ${dayDate(moveDay(weekStart, 6)).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`
        : dateLabel;

  return (
    <main className={s.window}>
      {(failure || diary.error || loadError) && (
        <div role="alert" className={s.error}>
          {failure || diary.error || loadError}{" "}
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              reload();
              diary.reload();
              setFailure(null);
            }}
          >
            다시 불러오기
          </Button>
        </div>
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
            disabled={saving}
            onClick={() => void undoCompletion()}
          >
            완료 취소
          </Button>
        </div>
      )}
      {!snapshot || !diary.state ? (
        <p role="status" className={s.status}>
          다이어리를 펼치고 있어요.
        </p>
      ) : (
        <div className={s.layout} data-collection={collection === "envelopes" && !notesOpen}>
          <DiaryRail
            notesOpen={notesOpen}
            collection={collection}
            tool={tool}
            view={view}
            day={day}
            items={items}
            noteCount={notes.length}
            envelopes={envelopes}
            saving={saving}
            onClose={() => navigate(close, true)}
            onOpenDay={openDay}
            onOpenTool={openTool}
            onOpenNotes={() =>
              navigate(() => {
                setNotesOpen(true);
                setCollection(null);
              })
            }
            onOpenEnvelopes={() =>
              navigate(() => {
                setNotesOpen(false);
                setTool(null);
                setCollection("envelopes");
                setPageId("");
                setEnvelopeId(text(envelopes.find((value) => !value.archived)?.id));
              })
            }
            onOpenPages={() =>
              navigate(() => {
                setNotesOpen(false);
                setTool(null);
                setCollection("pages");
                setView("day");
                setEnvelopeId("");
                const first = pages.find((value) => !value.date);
                setPageId(first?.id ?? "");
              })
            }
            onOpenSettings={openSettings}
            onOpenTravel={() =>
              void command("open_travel", {}).catch((cause: unknown) =>
                setFailure(errorText(cause)),
              )
            }
          />
          <aside hidden={!notesOpen} className={s.notes}>
            <DiaryNotes
              requestedNote={requestedNote}
              notes={notes}
              diaryAction={diaryAction}
              busy={saving}
              onDirtyChange={setNotesDirty}
              onOpenEnvelope={openEnvelope}
              envelopeNames={Object.fromEntries(
                envelopes.map((value) => [text(value.id), envelopeTitle(value)]),
              )}
              desktop={{
                widgets: widgets.filter((widget) => widget.kind === "memo"),
                busy: saving,
                act,
                onCreate: () =>
                  run(async () => {
                    const widget = await ensureWidget("memo");
                    await command("create_memo_note", { id: widget.id });
                    reload();
                  }).then(Boolean),
                onOpenNote: (widget, noteId, putAway) =>
                  run(async () => {
                    await command(putAway ? "request_close_memo_note" : "open_memo_note", {
                      id: widget.id,
                      noteId,
                    });
                    reload();
                  }).then(Boolean),
                linkTarget: envelopeId
                  ? "날짜나 내 페이지를 펼친 다음 연결해 주세요."
                  : `연결 대상: ${pageId ? page?.title || "제목 없는 페이지" : day}`,
                onAdd: (payload) => navigate(() => void addWidgetItem(payload)),
              }}
            />
          </aside>
          <DiaryEnvelopeIndex
            collection={collection}
            notesOpen={notesOpen}
            tool={tool}
            envelopeId={envelopeId}
            envelopes={envelopes}
            items={items}
            events={events}
            onOpenEnvelope={openEnvelope}
          />
          <Surface
            variant="panel"
            className={`${s.page} ${drop.dropActive ? s.dropActive : ""}`}
            hidden={notesOpen}
            aria-label="펼친 페이지"
            onDragOver={drop.onDragOver}
            onDragLeave={drop.onDragLeave}
            onDrop={drop.onDrop}
          >
            <DiaryPageToolbar
              tool={tool}
              collection={collection}
              view={view}
              day={day}
              pageId={pageId}
              envelopeId={envelopeId}
              heading={heading}
              archived={archived}
              pages={pages}
              saving={saving}
              onOpenDay={openDay}
              onOpenPage={openPage}
              onOpenTool={openTool}
              onChangeView={changeView}
              onArchivedChange={setArchived}
              onPlannerHeader={setPlannerHeader}
              onAdd={() => {
                if (collection) {
                  navigate(() => creation.start(collection === "pages" ? "page" : "envelope"));
                  return;
                }
                if (!tool && view !== "day") {
                  navigate(() => setCalendarDraft({ date: day }));
                  return;
                }
                quickTask.show();
              }}
            />
            <div
              className={s.body}
              ref={bodyRef}
              onScroll={(event) => {
                scrollPositions.current[bodyScope] = event.currentTarget.scrollTop;
              }}
            >
              {quickTask.open && <DiaryQuickTaskForm task={quickTask} saving={saving} />}
              {toolsOpened && (
                <div hidden={!isPlannerTool(tool)} className={s.toolContent}>
                  <Planner
                    headerActionsTarget={plannerHeader}
                    dismissVersion={toolDismissVersion}
                    embeddedTab={isPlannerTool(tool) ? tool : "plans"}
                    selectedDay={day}
                    onSelectedDayChange={(date) =>
                      navigate(() => {
                        setDay(date);
                      })
                    }
                    onNavigate={openTool}
                    onStateChange={setToolState}
                    habitSummary={habitSummary(diary.state, day)}
                  />
                </div>
              )}
              {tool === "organizer" && <OrganizerRecords />}
              {tool === "habits" && diary.state && (
                <DiaryHabits
                  key={featureContentVersion}
                  state={diary.state}
                  requestedHabit={requestedHabit}
                  date={day}
                  onDateChange={(date) => navigate(() => setDay(date))}
                  onAction={diaryAction}
                  busy={saving}
                  onDirtyChange={setFeatureDirty}
                />
              )}
              {tool === "ledger" && diary.state && (
                <DiaryLedger
                  key={featureContentVersion}
                  state={diary.state}
                  date={day}
                  onDateChange={(date) => navigate(() => setDay(date))}
                  onAction={diaryAction}
                  actionError={diary.error}
                  busy={saving}
                  onDirtyChange={setFeatureDirty}
                />
              )}
              {!tool && (
                <>
                  {!pageId && !envelopeId && !collection && view === "day" ? (
                    <DiaryToday
                      key={featureContentVersion}
                      tab={todayTab}
                      onTabChange={setTodayTab}
                      day={day}
                      widgets={widgets}
                      items={items}
                      events={events}
                      notes={notes}
                      busy={saving}
                      state={diary.state}
                      onDiaryAction={diaryAction}
                      onDirtyChange={setFeatureDirty}
                      onHabits={() => openTool("habits")}
                      onLedger={() => openTool("ledger")}
                      journal={
                        <>
                          {diaryPageContent}
                          <DiaryJournal key={day} date={day} />
                        </>
                      }
                      onTask={(item) => void toggleTask(item, day)}
                      onTasks={() => openTool("today")}
                      onEvent={openCalendarEvent}
                      onNotes={(id) =>
                        navigate(() => {
                          setRequestedNote((current) => ({
                            id,
                            version: (current?.version ?? 0) + 1,
                          }));
                          setNotesOpen(true);
                          setCollection(null);
                        })
                      }
                    />
                  ) : envelope && preparation ? (
                    <DiaryEnvelope
                      key={`${text(envelope.id)}:${pageContentVersion}`}
                      envelope={envelope}
                      preparation={preparation}
                      items={items}
                      events={events}
                      notes={notes}
                      pages={pages}
                      busy={saving}
                      act={(action, input) => act(action, input, preparation)}
                      diaryAction={diaryAction}
                      onPlanTask={(item) => planTask(item, localDay())}
                      onToggleTask={(item) => toggleTask(item, localDay())}
                      onEditTask={setEditing}
                      onFocusTask={(item) => void focusTask(item)}
                      onFocusEnvelope={() => void focusEnvelope()}
                      onOpenEvent={openCalendarEvent}
                      onCreateTask={(title) => createTask(title, null)}
                      onOpenPage={openPage}
                      onReturnToDay={() => openDay(localDay())}
                      onDirtyChange={setPageDirty}
                    />
                  ) : (
                    <>
                      {page?.date !== null && page && view === "day" && (
                        <div className={s.toolbar}>
                          <span className={s.spread} />
                          {page && view === "day" && (
                            <DiaryPageMenu
                              key={`${page.id}:${pageMenuVersion}`}
                              page={page}
                              busy={saving || pageDirty}
                              onAction={diaryAction}
                              onDeleted={() => {
                                setPageId("");
                                setPageMenuDirty(false);
                              }}
                              onDirtyChange={setPageMenuDirty}
                            />
                          )}
                        </div>
                      )}
                      {!pageId && view !== "day" ? (
                        <DiaryCalendar
                          key={`${view}:${day}:${featureContentVersion}`}
                          eventColor={(event) =>
                            colorForEvent(
                              event,
                              connections,
                              record(record(calendar?.data).calendarColors),
                            )
                          }
                          day={day}
                          view={view}
                          pages={pages}
                          events={events}
                          items={items}
                          envelopes={envelopes}
                          state={diary.state ?? undefined}
                          onAction={diaryAction}
                          busy={saving}
                          onDirtyChange={setFeatureDirty}
                          focusSessions={widgets
                            .filter((widget) => widget.kind === "focus-timer")
                            .flatMap((widget) => focusSessions(record(widget.data), calendarNow))}
                          onDay={openDay}
                          onEvent={openCalendarEvent}
                          onCreateEvent={(date) => navigate(() => setCalendarDraft({ date }))}
                          onDropItem={(payload, date) => void addWidgetItem(payload, date)}
                          onEnvelope={openEnvelope}
                        />
                      ) : (
                        diaryPageContent
                      )}
                      {!pageId && view === "day" && <DiaryJournal key={day} date={day} />}
                      {!pageId && (
                        <DiaryCalendarContext
                          day={day}
                          events={events}
                          connections={connections}
                          colors={record(record(calendar?.data).calendarColors)}
                          busy={saving}
                          onColorChange={(input) => void act("set-calendar-color", input, calendar)}
                          onOpenSettings={openSettings}
                        />
                      )}
                      {!pageId && view !== "day" && (
                        <p className={s.legend}>
                          □ 할 일　 · 기록이 있는 날　 ↗ 준비 봉투 연결 · {deviceTimeZone()}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </Surface>
        </div>
      )}
      {calendarDraft && (
        <LocalEventEditor
          key={
            calendarDraft.event
              ? `${text(calendarDraft.event.id)}:${calendarDraft.revision}:${calendarDraft.reloadKey ?? 0}`
              : `new:${calendarDraft.date}`
          }
          day={calendarDraft.date}
          event={calendarDraft.event}
          events={events}
          busy={busy}
          onSave={saveCalendarEvent}
          onDelete={calendarDraft.event ? () => saveCalendarEvent({}, true) : undefined}
          onReload={calendarDraft.event ? reloadCalendarEvent : undefined}
          onClose={() => {
            setCalendarDraft(null);
            setCalendarDirty(false);
          }}
          onDirtyChange={setCalendarDirty}
        />
      )}
      <DiaryNewPageDialog
        isOpen={creating === "page"}
        name={name}
        saving={saving}
        onNameChange={setName}
        onClose={creation.closePage}
        onSubmit={() => void creation.saveNew()}
      />
      {creating === "envelope" && (
        <PreparationCreate
          events={events}
          busy={saving}
          onCreate={createEnvelope}
          onDirtyChange={setEnvelopeCreateDirty}
          onClose={() => navigate(creation.closeEnvelope)}
        />
      )}
      {editing && todo && (
        <TodoEditor
          key={text(editing.id)}
          item={editing}
          widgetId={todo.id}
          lists={lists}
          busy={saving}
          act={(action, input) => {
            const latest = rows(
              record(latestWidgets.current.find((value) => value.id === todo.id)?.data).items,
            ).find((value) => value.id === editing.id);
            if (JSON.stringify(latest) !== JSON.stringify(editing)) {
              setFailure("이 할 일이 다른 곳에서 바뀌었어요. 최신 내용을 불러와 주세요.");
              return Promise.resolve(false);
            }
            return act(action, input);
          }}
          onReload={() => setEditing(items.find((value) => value.id === editing.id) ?? null)}
          onClose={() => setEditing(null)}
        />
      )}
      <DiaryEventDialog
        event={selectedEvent}
        day={day}
        events={events}
        envelopes={envelopes}
        saving={saving}
        onSelect={setSelectedEvent}
        onEdit={(current) =>
          setCalendarDraft({ date: day, event: current, revision: calendar?.revision })
        }
        onOpenDay={() => openDay(day)}
        onOpenEnvelope={openEnvelope}
      />
      <DiaryLeaveDialog
        leave={leave}
        saving={saving}
        onContinue={() => setLeave(null)}
        onDiscard={() => {
          const action = leave?.action;
          if (pageDirty) {
            if (envelope) discardDiaryEnvelopeNoteDrafts(text(envelope.id), notes);
            else {
              discardDiaryPageDraft(page, day);
              if (page?.date === null) discardDiaryCollectionDraft(page.id);
            }
            setPageContentVersion((value) => value + 1);
          }
          if (pageMenuDirty) setPageMenuVersion((value) => value + 1);
          if (featureDirty) setFeatureContentVersion((value) => value + 1);
          setPageDirty(false);
          setPageMenuDirty(false);
          setEditing(null);
          creation.discard();
          quickTask.discard();
          setCalendarDraft(null);
          setCalendarDirty(false);
          setFeatureDirty(false);
          if (toolState.blocking) {
            setToolDismissVersion((value) => value + 1);
          }
          setLeave(null);
          action?.();
        }}
      />
    </main>
  );
}
