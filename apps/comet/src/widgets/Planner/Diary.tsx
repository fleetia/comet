import { Button, FormField, Select, Surface, TextField } from "../../ui";
import {
  EnvelopeCard,
  IconButton as CometIconButton,
  SegmentedControl,
  SidebarItem,
  Dialog,
} from "@comet/ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { useDiaryWidgetActions } from "./useDiaryWidgetActions";
import { useDiaryTasks } from "./useDiaryTasks";
import { useCalendarClock, useDiaryCalendarEvents } from "./useDiaryCalendarEvents";
import { DiaryEventDialog } from "./DiaryEventDialog";
import { useDiaryCreation } from "./useDiaryCreation";
import { DiaryNewPageDialog } from "./DiaryNewPageDialog";
import { localDay, record, rows, text, type DataRecord } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";
import { DiaryCalendar } from "./DiaryCalendar";
import { PreparationCreate } from "../PreparationTool/PreparationCreate";
import { DiaryEnvelope, envelopeTitle } from "./DiaryEnvelope";
import { OrganizerRecords } from "./OrganizerRecords";
import { DiaryJournal } from "./DiaryJournal";
import { DiaryNotes } from "./DiaryNotes";
import { DiaryPage, discardDiaryPageDraft, type DiaryPageProps } from "./DiaryPage";
import { DiaryCollectionPage, discardDiaryCollectionDraft } from "./DiaryCollectionPage";
import { DiaryPageMenu } from "./DiaryPageMenu";
import type { DiaryAction, DiaryEntry, DiaryPage as Page } from "./diaryTypes";
import { LocalEventEditor } from "./LocalEventEditor";
import { DiaryToday } from "./DiaryToday";
import { DiaryHabits } from "./DiaryHabits";
import { DiaryLedger } from "./DiaryLedger";
import { hasWidgetDrag, readWidgetDrag, type WidgetDragPayload } from "../widgetDrag";
import { Planner, type PlannerToolState, type PlannerToolTab } from "./Planner";
import { DiaryCalendarContext } from "./DiaryCalendarContext";
import { TodoEditor } from "./TodoEditor";
import {
  dayDate,
  deviceTimeZone,
  eventsOn,
  frequencyRecords,
  moveDay,
  movePeriod,
  periodAnchor,
  ruleOf,
} from "./plannerData";
import { useDiary } from "./useDiary";
import { colorForEvent } from "./calendarColorData";
import { focusSessions } from "../PlanningTools/FocusTimerData";
import * as s from "./diary.css";
import * as envelopeStyles from "./diaryEnvelope.css";

type View = "month" | "week" | "day";
const VIEWS: [View, string][] = [
  ["day", "하루"],
  ["week", "주"],
  ["month", "월"],
];

type DiaryTool = PlannerToolTab | "organizer" | "habits" | "ledger";
function toolForTab(tab: string | null): DiaryTool | null {
  switch (tab) {
    case "todos":
      // The task tool uses "today" internally; the native "today" route is the diary summary.
      return "today";
    case "plans":
    case "templates":
    case "organizer":
    case "habits":
    case "ledger":
      return tab;
    default:
      return null;
  }
}
function isPlannerTool(tool: DiaryTool | null): tool is PlannerToolTab {
  return tool === "today" || tool === "plans" || tool === "templates";
}
const TOOL_MENU: [DiaryTool, string][] = [
  ["plans", "기간 계획"],
  ["templates", "템플릿"],
  ["today", "할 일"],
  ["organizer", "정리 기록"],
  ["habits", "습관"],
  ["ledger", "가계부"],
];
const EMPTY_TOOL_STATE: PlannerToolState = { dirty: false, busy: false, blocking: false };

export function Diary(): ReactElement {
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
  const [navigationReady, setNavigationReady] = useState(false);
  const [viewTarget, setViewTarget] = useState<{
    entity: "page" | "event";
    targetId: string;
  } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [collection, setCollection] = useState<"pages" | "envelopes" | null>(() =>
    new URLSearchParams(location.search).get("tab") === "envelopes" ? "envelopes" : null,
  );
  const [requestedNote, setRequestedNote] = useState<{ id: string; version: number } | null>(null);
  const [archived, setArchived] = useState(false);
  const [quickTaskOpen, setQuickTaskOpen] = useState(false);
  const [quickTaskTitle, setQuickTaskTitle] = useState("");
  const [quickTaskDate, setQuickTaskDate] = useState<string | null>(null);
  const quickTaskVersion = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      quickTaskVersion.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!quickTaskTitle) setQuickTaskDate(tool || pageId || envelopeId ? null : day);
  }, [quickTaskTitle, tool, pageId, envelopeId, day]);
  const [editing, setEditing] = useState<DataRecord | null>(null);
  const [dropActive, setDropActive] = useState(false);
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
  const [addingWidget, setAddingWidget] = useState(false);
  const dropping = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pageDirty, setPageDirty] = useState(false);
  const [pageContentVersion, setPageContentVersion] = useState(0);
  const [notesDirty, setNotesDirty] = useState(false);
  const [featureDirty, setFeatureDirty] = useState(false);
  const [featureContentVersion, setFeatureContentVersion] = useState(0);
  const calendarNow = useCalendarClock(view === "week" && !pageId && !tool);
  const [pageMenuDirty, setPageMenuDirty] = useState(false);
  const [pageMenuVersion, setPageMenuVersion] = useState(0);
  const [leave, setLeave] = useState<{ action: () => void; closing: boolean } | null>(null);
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
  const saving = busy || diary.busy || addingWidget || toolState.busy;
  const blocking = useRef(false);
  blocking.current =
    saving ||
    pageDirty ||
    pageMenuDirty ||
    notesDirty ||
    featureDirty ||
    calendarDirty ||
    toolState.dirty ||
    toolState.blocking ||
    Boolean(editing) ||
    envelopeCreateDirty ||
    Boolean(name) ||
    Boolean(quickTaskTitle);
  const close = (): void => {
    if (isDesktop())
      void getCurrentWindow()
        .destroy()
        .catch((cause: unknown) => setFailure(errorText(cause)));
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  function navigate(action: () => void, closing = false): void {
    if (saving) return;
    if (
      pageDirty ||
      pageMenuDirty ||
      featureDirty ||
      calendarDirty ||
      editing ||
      envelopeCreateDirty ||
      name ||
      quickTaskTitle ||
      toolState.blocking ||
      (closing && (notesDirty || toolState.dirty))
    )
      setLeave({ action, closing });
    else action();
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let received = false;
    let cleanup: (() => void) | undefined;
    function select(id: string | null): void {
      if (!active || !id) return;
      navigateRef.current(() => {
        setNotesOpen(true);
        setRequestedNote((previous) => ({ id, version: (previous?.version ?? 0) + 1 }));
      });
    }
    void listen<string>("planner-note", (event) => {
      received = true;
      select(event.payload);
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        const id = await command<string | null>("get_planner_note_target");
        if (!received) select(id);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
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
    if (!isDesktop()) return;
    let active = true;
    const cleanups: (() => void)[] = [];
    const retain = (cleanup: () => void): void => {
      if (active) cleanups.push(cleanup);
      else cleanup();
    };
    const select = (tab: string, resetCollections = true): void => {
      if (
        !active ||
        ![
          "today",
          "todos",
          "calendar",
          "plans",
          "templates",
          "organizer",
          "habits",
          "ledger",
          "envelopes",
          "time",
        ].includes(tab)
      )
        return;
      navigateRef.current(() => {
        if (resetCollections || tab === "envelopes" || tab === "time") {
          setNotesOpen(false);
          setCollection(tab === "envelopes" ? "envelopes" : null);
        }
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
      });
    };
    let received = false;
    let targetReceived = false;
    function receiveTarget(value: unknown): void {
      if (!active || !value) return;
      if (
        typeof value !== "object" ||
        !("entity" in value) ||
        !("targetId" in value) ||
        (value.entity !== "page" && value.entity !== "event") ||
        typeof value.targetId !== "string" ||
        !value.targetId
      ) {
        setFailure("열 기록의 정보를 확인하지 못했어요.");
        return;
      }
      setViewTarget({ entity: value.entity, targetId: value.targetId });
    }
    void listen("planner-view-target", (event) => {
      targetReceived = true;
      receiveTarget(event.payload);
      void command("get_planner_view_target").catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    })
      .then(async (cleanup) => {
        retain(cleanup);
        const target = await command<unknown>("get_planner_view_target");
        if (!targetReceived) receiveTarget(target);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    void listen<string>("planner-tab", (event) => {
      received = true;
      setViewTarget(null);
      select(event.payload);
    })
      .then(async (cleanup) => {
        retain(cleanup);
        const tab = await command<string>("get_planner_tab");
        if (!received) select(tab, false);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      })
      .finally(() => {
        if (active) setNavigationReady(true);
      });
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (blocking.current) {
          event.preventDefault();
          navigateRef.current(() => closeRef.current(), true);
        }
      })
      .then(retain)
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
  useEffect(() => {
    if (!viewTarget || !navigationReady || !diary.state || !snapshot || saving) return;
    setViewTarget(null);
    if (viewTarget.entity === "page") {
      const page = diary.state.pages.find((value) => value.id === viewTarget.targetId);
      if (page) openPage(page);
      else setFailure("해당 기록을 현재 찾을 수 없어요. 원본이 삭제되었는지 확인해 주세요.");
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

  // Project the visible calendar into the existing native animation condition.
  // Read startup navigation first so an initial "today" render cannot overwrite it.
  const nativeTab =
    notesOpen || collection
      ? "today"
      : ((tool === "today" ? "todos" : tool) ??
        (!pageId && !envelopeId && view !== "day" ? "calendar" : "today"));
  useEffect(() => {
    if (!navigationReady || !isDesktop()) return;
    let active = true;
    void command("set_planner_tab", { tab: nativeTab }).catch((cause: unknown) => {
      if (active) setFailure(errorText(cause));
    });
    return () => {
      active = false;
    };
  }, [navigationReady, nativeTab]);

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
  async function addWidgetItem(payload: WidgetDragPayload, targetDate?: string): Promise<void> {
    if (dropping.current || saving) return;
    setNotice("");
    if (envelopeId && !targetDate) {
      setFailure("날짜나 내 페이지를 펼친 다음 연결해 주세요.");
      return;
    }
    dropping.current = true;
    setAddingWidget(true);
    setFailure(null);
    try {
      const fresh = await command<WidgetSnapshot>("get_widgets");
      latestWidgets.current = fresh.widgets;
      const widget = fresh.widgets.find(
        (value) => value.id === payload.widgetId && value.installed,
      );
      if (!widget) throw new Error("원본 위젯을 찾을 수 없어요.");
      const date = targetDate ?? (pageId ? null : day);
      const data = record(widget.data);
      const collection =
        payload.kind === "todo"
          ? rows(data.items)
          : payload.kind === "memo"
            ? rows(data.notes)
            : rows(data.envelopes);
      const source =
        payload.kind === "widget" ? null : collection.find((value) => value.id === payload.itemId);
      const expectedKind = payload.kind === "envelope" ? "preparation" : payload.kind;
      if (payload.kind !== "widget" && (!source || widget.kind !== expectedKind)) {
        throw new Error("연결할 원본 항목을 찾을 수 없어요.");
      }
      if (payload.kind === "todo" && source && date) {
        if (!widget.enabled) throw new Error("할 일 위젯을 먼저 켜 주세요.");
        if (!(await planTask(source, date))) return;
      } else {
        let target =
          !targetDate && pageId
            ? pages.find((value) => value.id === pageId)
            : pages.find((value) => value.date === date);
        if (!target && date) {
          const saved = await diary.mutate("page-create", { date, title: "" });
          target = saved?.pages.find((value) => value.date === date);
        }
        if (!target) throw new Error("연결할 페이지를 만들지 못했어요.");
        const label = source
          ? text(source.title) || text(source.body) || text(source.eventLabel) || "메모"
          : fresh.catalog.find((value) => value.id === widget.kind)?.name || widget.kind;
        if (
          !(await diaryAction("entry-add", {
            pageId: target.id,
            kind:
              payload.kind === "todo"
                ? "todo"
                : payload.kind === "envelope"
                  ? "envelope"
                  : "widget",
            refId:
              payload.kind === "todo" || payload.kind === "envelope" ? payload.itemId : widget.id,
            ...(payload.kind === "memo" ? { itemId: payload.itemId } : {}),
            text: label.slice(0, 20000),
          }))
        )
          return;
      }
      setNotice(date ? `${date}에 연결했어요.` : "이 페이지에 연결했어요.");
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      dropping.current = false;
      setAddingWidget(false);
      reload();
    }
  }
  function dropOnPage(event: DragEvent<HTMLElement>): void {
    const payload = readWidgetDrag(event.dataTransfer);
    if (!payload || view !== "day" || envelopeId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    void addWidgetItem(payload);
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
            variant="quiet"
            size="compact"
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
            variant="quiet"
            size="compact"
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
          <nav className={s.rail} aria-label="내 다이어리 목차">
            <WindowHeader
              nativeControls
              className={s.railHeader}
              label="다이어리 닫기"
              onClose={async () => navigate(close, true)}
            />
            <SidebarItem
              href="#today"
              icon="today"
              current={!notesOpen && !collection && !tool && view === "day"}
              onClick={(event) => {
                event.preventDefault();
                openDay(localDay());
              }}
            >
              오늘
            </SidebarItem>
            <SidebarItem
              href="#calendar"
              icon="calendar"
              current={!notesOpen && !collection && !tool && view !== "day"}
              onClick={(event) => {
                event.preventDefault();
                openDay(day, "month");
              }}
            >
              캘린더
            </SidebarItem>
            <SidebarItem
              href="#tasks"
              icon="todo"
              badge={items.filter((item) => item.completedAt === null).length || undefined}
              current={!notesOpen && tool === "today"}
              onClick={(event) => {
                event.preventDefault();
                openTool("today");
              }}
            >
              할 일
            </SidebarItem>
            {(["habits", "ledger"] as const).map((section) => (
              <SidebarItem
                key={section}
                href={`#${section}`}
                icon={section === "habits" ? "habit" : "ledger"}
                current={!notesOpen && tool === section}
                onClick={(event) => {
                  event.preventDefault();
                  openTool(section);
                }}
              >
                {section === "habits" ? "습관" : "가계부"}
              </SidebarItem>
            ))}
            <SidebarItem
              href="#notes"
              icon="memo"
              badge={notes.length || undefined}
              current={notesOpen}
              onClick={(event) => {
                event.preventDefault();
                navigate(() => {
                  setNotesOpen(true);
                  setCollection(null);
                });
              }}
            >
              메모
            </SidebarItem>
            <SidebarItem
              href="#envelopes"
              icon="envelope"
              badge={envelopes.filter((value) => !value.archived).length || undefined}
              current={!notesOpen && collection === "envelopes"}
              onClick={(event) => {
                event.preventDefault();
                navigate(() => {
                  setNotesOpen(false);
                  setTool(null);
                  setCollection("envelopes");
                  setPageId("");
                  setEnvelopeId(text(envelopes.find((value) => !value.archived)?.id));
                });
              }}
            >
              준비 봉투
            </SidebarItem>
            <span className={s.railDivider} />
            <SidebarItem
              href="#organizer"
              icon="organize"
              current={!notesOpen && tool === "organizer"}
              onClick={(event) => {
                event.preventDefault();
                openTool("organizer");
              }}
            >
              정리 기록
            </SidebarItem>
            <SidebarItem
              href="#pages"
              icon="page"
              current={!notesOpen && collection === "pages"}
              onClick={(event) => {
                event.preventDefault();
                navigate(() => {
                  setNotesOpen(false);
                  setTool(null);
                  setCollection("pages");
                  setView("day");
                  setEnvelopeId("");
                  const first = pages.find((value) => !value.date);
                  setPageId(first?.id ?? "");
                });
              }}
            >
              내 페이지
            </SidebarItem>
            <span className={s.spread} />
            <CometIconButton
              icon="gear"
              aria-label="연결·알림 설정"
              disabled={saving}
              onClick={openSettings}
            />
          </nav>
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
          <Surface
            padding="compact"
            className={s.index}
            hidden={collection !== "envelopes" || notesOpen}
            role="navigation"
            aria-label={collection === "envelopes" ? "준비 봉투 목록" : "내 페이지 목록"}
          >
            <div hidden={collection !== "envelopes"}>
              <div className={envelopeStyles.envelopeGroups}>
                {[false, true].map((isArchived) => {
                  const group = envelopes.filter((value) => Boolean(value.archived) === isArchived);
                  return (
                    <section
                      key={String(isArchived)}
                      id={`envelope-group-${isArchived ? "archived" : "preparing"}`}
                      className={envelopeStyles.envelopeGroup}
                      aria-label={isArchived ? "보관한 봉투" : "준비 중인 봉투"}
                    >
                      <h3 className={s.caption}>
                        {isArchived ? "보관함" : "준비 중"} · {group.length}
                      </h3>
                      {group.map((value) => {
                        const checks = rows(value.checks);
                        const linkedIds = Array.isArray(value.todoIds) ? value.todoIds : [];
                        const linked = items.filter((item) => linkedIds.includes(item.id));
                        const completed =
                          checks.filter((item) => item.done === true).length +
                          linked.filter((item) =>
                            ruleOf(item).mode === "frequency"
                              ? frequencyRecords(item, localDay()).some(
                                  (entry) => entry.date === localDay(),
                                )
                              : typeof item.completedAt === "number",
                          ).length;
                        const event = events.find(
                          (event) => event.id === value.eventId && !event.cancelled,
                        );
                        const description = event
                          ? `${text(event.startDate) || (typeof event.startAt === "number" ? localDay(new Date(event.startAt)) : "일정에 연결됨")} · ${text(event.title)}`
                          : text(value.date) ||
                            (value.eventId
                              ? `${text(value.eventLabel)} · 일정 확인 필요`
                              : "날짜 없이 준비 중");
                        return (
                          <EnvelopeCard
                            key={text(value.id)}
                            className={envelopeStyles.envelopeCard}
                            title={envelopeTitle(value)}
                            description={isArchived ? `${description} · 보관함` : description}
                            completed={completed}
                            total={checks.length + linkedIds.length}
                            archived={isArchived}
                            selected={!tool && envelopeId === value.id}
                            aria-current={!tool && envelopeId === value.id ? "page" : undefined}
                            onClick={() => openEnvelope(text(value.id))}
                          />
                        );
                      })}
                      {!group.length && (
                        <p className={s.caption}>
                          {isArchived
                            ? "아직 보관한 봉투가 없어요."
                            : "약속이 잡히기 전부터 할 일과 자료를 모아 두세요."}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </Surface>
          <Surface
            padding="flush"
            className={`${s.page} ${dropActive ? s.dropActive : ""}`}
            hidden={notesOpen}
            aria-label="펼친 페이지"
            onDragOver={(event) => {
              if (!tool && view === "day" && !envelopeId && hasWidgetDrag(event.dataTransfer)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "link";
                setDropActive(true);
              }
            }}
            onDragLeave={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              )
                setDropActive(false);
            }}
            onDrop={tool ? undefined : dropOnPage}
          >
            <div
              className={s.pageNavigation}
              hidden={tool === "habits" || tool === "ledger"}
              data-tauri-drag-region
            >
              <div className={collection === "pages" ? s.pageHeading : s.toolbar}>
                {!tool && !pageId && !envelopeId && (
                  <CometIconButton
                    icon="chevleft"
                    variant="surface"
                    aria-label="이전 페이지"
                    onClick={() =>
                      openDay(
                        view === "month"
                          ? movePeriod(day, "month", -1)
                          : moveDay(day, view === "week" ? -7 : -1),
                        view,
                      )
                    }
                  />
                )}
                <h1 className={s.title} title={pageId ? heading : undefined}>
                  {tool
                    ? TOOL_MENU.find(([value]) => value === tool)?.[1]
                    : envelopeId
                      ? "준비 봉투"
                      : heading}
                </h1>
                {!tool && !pageId && !envelopeId && (
                  <CometIconButton
                    icon="chev"
                    variant="surface"
                    aria-label="다음 페이지"
                    onClick={() =>
                      openDay(
                        view === "month"
                          ? movePeriod(day, "month", 1)
                          : moveDay(day, view === "week" ? 7 : 1),
                        view,
                      )
                    }
                  />
                )}
              </div>
              <div className={s.toolbar}>
                {collection === "envelopes" && (
                  <SegmentedControl
                    label="준비 봉투 분류"
                    appearance="contained"
                    value={archived ? "archived" : "preparing"}
                    options={[
                      { value: "preparing", label: "준비 중" },
                      { value: "archived", label: "보관함" },
                    ]}
                    onValueChange={(value) => {
                      setArchived(value === "archived");
                      document
                        .getElementById(`envelope-group-${value}`)
                        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                    }}
                  />
                )}
                {collection === "pages" && (
                  <div className={s.pageSelect}>
                    <Select
                      aria-label="내 페이지 선택"
                      value={pageId}
                      onChange={(event) => {
                        const selected = pages.find((value) => value.id === event.target.value);
                        if (selected) openPage(selected);
                      }}
                    >
                      {!pageId && <option value="">페이지 선택</option>}
                      {pages
                        .filter((value) => !value.date)
                        .map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.title}
                          </option>
                        ))}
                    </Select>
                  </div>
                )}
                {isPlannerTool(tool) && (
                  <SegmentedControl
                    label="할 일 보기"
                    appearance="contained"
                    value={tool}
                    options={[
                      { value: "today", label: "날짜별" },
                      { value: "plans", label: "기간별" },
                    ]}
                    onValueChange={(value) => {
                      if (value === "today" || value === "plans" || value === "templates") {
                        openTool(value);
                      }
                    }}
                  />
                )}
                {isPlannerTool(tool) && <div ref={setPlannerHeader} />}
                {!tool && !pageId && !envelopeId && (
                  <SegmentedControl
                    label="다이어리 보기"
                    appearance="contained"
                    value={view}
                    options={VIEWS.map(([value, label]) => ({ value, label }))}
                    onValueChange={(value) => {
                      if (value === "day" || value === "week" || value === "month")
                        changeView(value);
                    }}
                  />
                )}
                {tool !== "habits" && tool !== "ledger" && tool !== "organizer" && (
                  <CometIconButton
                    icon="plus"
                    variant="primary"
                    aria-label={
                      collection === "pages"
                        ? "새 페이지"
                        : collection === "envelopes"
                          ? "새 준비 봉투"
                          : !tool && view !== "day"
                            ? "새 일정"
                            : "빠른 할 일 추가"
                    }
                    disabled={saving}
                    onClick={() => {
                      if (collection) {
                        navigate(() =>
                          creation.start(collection === "pages" ? "page" : "envelope"),
                        );
                        return;
                      }
                      if (!tool && view !== "day") {
                        navigate(() => setCalendarDraft({ date: day }));
                        return;
                      }
                      if (!quickTaskTitle)
                        setQuickTaskDate(tool || pageId || envelopeId ? null : day);
                      setQuickTaskOpen(true);
                    }}
                  />
                )}
              </div>
            </div>
            <div
              className={s.body}
              ref={bodyRef}
              onScroll={(event) => {
                scrollPositions.current[bodyScope] = event.currentTarget.scrollTop;
              }}
            >
              {quickTaskOpen && (
                <form
                  className={s.form}
                  aria-label="빠른 할 일"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      pending.current ||
                      saving ||
                      !quickTaskTitle.trim() ||
                      quickTaskTitle.length > 500
                    )
                      return;
                    const version = quickTaskVersion.current;
                    if (await createTask(quickTaskTitle, quickTaskDate)) {
                      if (!mounted.current || version !== quickTaskVersion.current) return;
                      quickTaskVersion.current += 1;
                      setQuickTaskTitle("");
                      setQuickTaskOpen(false);
                    }
                  }}
                >
                  <FormField label="빠른 할 일 제목" required>
                    <TextField
                      autoFocus
                      maxLength={500}
                      value={quickTaskTitle}
                      disabled={saving}
                      onChange={(event) => {
                        quickTaskVersion.current += 1;
                        setQuickTaskTitle(event.target.value);
                      }}
                    />
                  </FormField>
                  <p className={s.caption}>
                    {quickTaskDate ? `${quickTaskDate} 할 일` : "날짜 없이 모아두기"}
                  </p>
                  <div className={s.toolbar}>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={saving || !quickTaskTitle.trim()}
                    >
                      할 일 저장
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={saving}
                      onClick={() => setQuickTaskOpen(false)}
                    >
                      닫아두기
                    </Button>
                  </div>
                </form>
              )}
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
                  />
                </div>
              )}
              {tool === "organizer" && <OrganizerRecords />}
              {tool === "habits" && diary.state && (
                <DiaryHabits
                  key={featureContentVersion}
                  state={diary.state}
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
      <Dialog
        isOpen={Boolean(leave)}
        title="작성 중인 내용이 있어요"
        variant="confirm"
        closeLabel="작성 계속하기"
        onOpenChange={(open) => {
          if (!open) setLeave(null);
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeave(null)}>
              계속 작성
            </Button>
            <Button
              variant="critical"
              disabled={saving}
              onClick={() => {
                const action = leave?.action;
                if (pageDirty) {
                  discardDiaryPageDraft(page, day);
                  if (page?.date === null) discardDiaryCollectionDraft(page.id);
                  setPageContentVersion((value) => value + 1);
                }
                if (pageMenuDirty) setPageMenuVersion((value) => value + 1);
                if (featureDirty) setFeatureContentVersion((value) => value + 1);
                setPageDirty(false);
                setPageMenuDirty(false);
                setEditing(null);
                creation.discard();
                quickTaskVersion.current += 1;
                setQuickTaskTitle("");
                setQuickTaskOpen(false);
                setCalendarDraft(null);
                setCalendarDirty(false);
                setFeatureDirty(false);
                if (toolState.blocking) {
                  setToolDismissVersion((value) => value + 1);
                }
                setLeave(null);
                action?.();
              }}
            >
              {leave?.closing ? "저장하지 않고 닫기" : "저장하지 않고 이동"}
            </Button>
          </>
        }
      >
        <p>
          저장하지 않은 내용을 확인하고{" "}
          {leave?.closing ? "다이어리를 닫을까요?" : "다른 페이지로 이동할까요?"}
        </p>
      </Dialog>
    </main>
  );
}
