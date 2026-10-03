import { Button, Dialog, FormField, Surface, TextField } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";
import { DiaryCalendar, MiniCalendar } from "./DiaryCalendar";
import { DiaryEnvelope, envelopeTitle } from "./DiaryEnvelope";
import { DiaryNotes } from "./DiaryNotes";
import { DiaryPage, discardDiaryPageDraft } from "./DiaryPage";
import { DiaryPageMenu } from "./DiaryPageMenu";
import type { DiaryAction, DiaryEntry, DiaryPage as Page } from "./diaryTypes";
import { LocalEventEditor } from "./LocalEventEditor";
import { DiaryWidgetShelf } from "./DiaryWidgetShelf";
import { hasWidgetDrag, readWidgetDrag, type WidgetDragPayload } from "../widgetDrag";
import { Planner, type PlannerToolState, type PlannerToolTab } from "./Planner";
import { DiaryCalendarContext } from "./DiaryCalendarContext";
import { TodoEditor } from "./TodoEditor";
import {
  dayDate,
  eventsOn,
  eventTime,
  moveDay,
  movePeriod,
  periodAnchor,
  plannedDay,
  ruleOf,
} from "./plannerData";
import { useDiary } from "./useDiary";
import { colorForEvent } from "./calendarColorData";
import * as s from "./diary.css";

type View = "month" | "week" | "day";
const VIEWS: [View, string][] = [
  ["month", "월간"],
  ["week", "주간"],
  ["day", "하루"],
];

const TOOL_MENU: [PlannerToolTab, string][] = [
  ["plans", "기간 계획"],
  ["templates", "템플릿"],
  ["today", "할 일 관리"],
];
const EMPTY_TOOL_STATE: PlannerToolState = { dirty: false, busy: false, blocking: false };

export function Diary(): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const diary = useDiary();
  const [day, setDay] = useState(localDay());
  const [month, setMonth] = useState(localDay());
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).get("tab") === "calendar" ? "month" : "day",
  );
  const [pageId, setPageId] = useState("");
  const [envelopeId, setEnvelopeId] = useState("");
  const [tool, setTool] = useState<PlannerToolTab | null>(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    return tab === "plans" || tab === "templates" ? tab : null;
  });
  const [toolsOpened, setToolsOpened] = useState(tool !== null);
  const [toolState, setToolState] = useState<PlannerToolState>(EMPTY_TOOL_STATE);
  const [toolDismissVersion, setToolDismissVersion] = useState(0);
  const [navigationReady, setNavigationReady] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState<"page" | "envelope" | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<DataRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DataRecord | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<{
    date: string;
    event?: DataRecord;
    revision?: number;
    reloadKey?: number;
  } | null>(null);
  const [calendarDirty, setCalendarDirty] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [notice, setNotice] = useState("");
  const [addingWidget, setAddingWidget] = useState(false);
  const dropping = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageDirty, setPageDirty] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [pageMenuDirty, setPageMenuDirty] = useState(false);
  const [leave, setLeave] = useState<{ action: () => void; closing: boolean } | null>(null);
  const pending = useRef(false);
  const latestWidgets = useRef<WidgetView[]>([]);
  for (const widget of snapshot?.widgets ?? []) {
    const at = latestWidgets.current.findIndex((value) => value.id === widget.id);
    if (at < 0) latestWidgets.current.push(widget);
    else if (widget.revision >= latestWidgets.current[at].revision)
      latestWidgets.current[at] = widget;
  }
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
  const pages = diary.state?.pages ?? [],
    notes = diary.state?.notes ?? [];
  const page = pageId
    ? pages.find((value) => value.id === pageId)
    : pages.find((value) => value.date === day);
  const envelope = envelopes.find((value) => value.id === envelopeId);
  const saving = busy || diary.busy || addingWidget || toolState.busy;
  const blocking = useRef(false);
  blocking.current =
    saving ||
    pageDirty ||
    pageMenuDirty ||
    notesDirty ||
    calendarDirty ||
    toolState.dirty ||
    toolState.blocking ||
    Boolean(editing) ||
    Boolean(name);
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
      calendarDirty ||
      editing ||
      name ||
      toolState.blocking ||
      (closing && (notesDirty || toolState.dirty))
    )
      setLeave({ action, closing });
    else action();
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  function openDay(date: string, nextView: View = "day"): void {
    navigate(() => {
      setTool(null);
      setDay(date);
      setMonth(date);
      setView(nextView);
      setPageId("");
      setEnvelopeId("");
      setPageDirty(false);
    });
  }
  function openPage(value: Page): void {
    if (value.date) openDay(value.date);
    else
      navigate(() => {
        setTool(null);
        setPageId(value.id);
        setEnvelopeId("");
        setView("day");
        setPageDirty(false);
      });
  }
  function openEnvelope(id: string): void {
    navigate(() => {
      setTool(null);
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
    const select = (tab: string): void => {
      if (!active || !["today", "calendar", "plans", "templates"].includes(tab)) return;
      navigateRef.current(() => {
        const nextTool = tab === "plans" || tab === "templates" ? tab : null;
        setTool(nextTool);
        if (nextTool) setToolsOpened(true);
        setView(tab === "calendar" ? "month" : "day");
        setDay(localDay());
        setMonth(localDay());
        setPageId("");
        setEnvelopeId("");
        setCalendarDraft(null);
        setCalendarDirty(false);
        setSelectedEvent(null);
        setCreating(null);
      });
    };
    let received = false;
    void listen<string>("planner-tab", (event) => {
      received = true;
      select(event.payload);
    })
      .then(async (cleanup) => {
        retain(cleanup);
        const tab = await command<string>("get_planner_tab");
        if (!received) select(tab);
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

  // Project the visible calendar into the existing native animation condition.
  // Read startup navigation first so an initial "today" render cannot overwrite it.
  const nativeTab = tool ?? (!pageId && !envelopeId && view !== "day" ? "calendar" : "today");
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

  async function run<T>(operation: () => Promise<T>): Promise<{ value: T } | null> {
    if (!isDesktop()) {
      setFailure("예시 미리보기예요. 기록은 데스크톱 앱에서 저장할 수 있어요.");
      return null;
    }
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      return { value: await operation() };
    } catch (cause) {
      setFailure(errorText(cause));
      reload();
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function execute(
    action: string,
    input: DataRecord,
    target: WidgetView,
  ): Promise<string | null> {
    const latest = latestWidgets.current.find((widget) => widget.id === target.id) ?? target;
    const result = await command<string | null>("execute_widget", {
      request: {
        requestId: crypto.randomUUID(),
        instanceId: latest.id,
        expectedRevision: latest.revision,
        action,
        input,
      },
    });
    // Keep sequential actions on the returned revision, even before React receives the event.
    try {
      const fresh = await command<WidgetSnapshot>("get_widgets");
      latestWidgets.current = fresh.widgets;
    } catch {
      reload();
    }
    return result;
  }
  const act: ToolAction = async (action, input = {}, target = todo) => {
    if (!target) {
      setFailure("이 도구를 먼저 켜 주세요.");
      return false;
    }
    return Boolean(await run(() => execute(action, input, target)));
  };
  const diaryAction: DiaryAction = async (action, input) =>
    Boolean(await diary.mutate(action, input));
  function planTask(item: DataRecord, toDate: string): Promise<boolean> {
    const fromDate = plannedDay(item);
    if (fromDate === toDate) return Promise.resolve(true);
    return fromDate
      ? diaryAction("move-record", {
          todoId: text(item.id),
          fromDate,
          toDate,
          title: text(item.title),
        })
      : act("plan", { ids: [text(item.id)], date: toDate });
  }
  async function ensureWidget(kind: string): Promise<WidgetView> {
    const existing = latestWidgets.current.find((widget) => widget.kind === kind);
    if (existing?.installed && existing.enabled) return existing;
    if (existing?.installed)
      await command("set_widget_enabled", { id: existing.id, enabled: true });
    else await command("install_widgets", { kinds: [kind] });
    const fresh = await command<WidgetSnapshot>("get_widgets");
    latestWidgets.current = fresh.widgets;
    const widget = fresh.widgets.find(
      (value) => value.kind === kind && value.installed && value.enabled,
    );
    if (!widget) throw new Error("도구를 준비하지 못했어요. 다시 시도해 주세요.");
    return widget;
  }
  async function createTask(title: string, plannedDate: string | null): Promise<string | null> {
    const result = await run(async () => {
      const target = await ensureWidget("todo");
      return execute("add", { title, plannedDate }, target);
    });
    return result?.value ?? null;
  }
  function toggleTask(item: DataRecord, date = day): Promise<boolean> {
    if (ruleOf(item).mode === "frequency") {
      const entry = rows(item.frequencyRecords).find((value) => value.date === date);
      return act(entry ? "undo-frequency" : "record-frequency", {
        id: text(item.id),
        ...(entry ? { recordId: text(entry.id) } : { date }),
      });
    }
    return act(typeof item.completedAt === "number" ? "undo" : "complete", { id: text(item.id) });
  }
  async function createPage(): Promise<string | null> {
    if (page) return page.id;
    const result = await diary.mutate("page-create", { date: day, title: "" });
    return result?.pages.find((value) => value.date === day)?.id ?? null;
  }
  async function saveNew(): Promise<void> {
    if (!name.trim()) return;
    if (creating === "page") {
      const result = await diary.mutate("page-create", { date: null, title: name });
      const added = result?.pages.at(-1);
      if (added) {
        setName("");
        setCreating(null);
        setTool(null);
        setPageId(added.id);
        setEnvelopeId("");
        setView("day");
      }
    } else {
      const result = await run(async () =>
        execute("create", { title: name }, await ensureWidget("preparation")),
      );
      if (result?.value) {
        setName("");
        setCreating(null);
        setTool(null);
        setEnvelopeId(result.value);
        setPageId("");
      }
    }
  }
  function openTool(next: PlannerToolTab): void {
    navigate(() => {
      setToolsOpened(true);
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
      if (event.connectionId === "local") {
        setCalendarDraft({ date, event, revision: calendar?.revision });
      } else {
        setDay(date);
        setSelectedEvent(event);
      }
    });
  }
  async function saveCalendarEvent(input: DataRecord, deleting = false): Promise<boolean> {
    if (!calendarDraft) return false;
    const draft = calendarDraft;
    return Boolean(
      await run(async () => {
        const fresh = await command<WidgetSnapshot>("get_widgets");
        latestWidgets.current = fresh.widgets;
        const target = await ensureWidget("calendar");
        if (draft.event) {
          const current = rows(record(target.data).events).find(
            (event) => event.id === draft.event?.id,
          );
          const fields = [
            "title",
            "allDay",
            "startDate",
            "endDate",
            "startAt",
            "endAt",
            "timeZone",
            "location",
            "description",
            "cancelled",
            "connectionId",
          ];
          if (!current || fields.some((field) => current[field] !== draft.event?.[field])) {
            throw new Error(
              "이 일정이 다른 화면에서 바뀌었어요. 초안을 확인한 뒤 최신 일정을 다시 열어 주세요.",
            );
          }
        }
        await command("execute_widget", {
          request: {
            requestId: crypto.randomUUID(),
            instanceId: target.id,
            expectedRevision: target.revision,
            action: deleting ? "delete-event" : draft.event ? "update-event" : "create-event",
            input: { ...input, ...(draft.event ? { id: text(draft.event.id) } : {}) },
          },
        });
        reload();
      }),
    );
  }
  async function reloadCalendarEvent(): Promise<boolean> {
    if (!calendarDraft?.event) return false;
    const draft = calendarDraft;
    return Boolean(
      await run(async () => {
        const fresh = await command<WidgetSnapshot>("get_widgets");
        latestWidgets.current = fresh.widgets;
        const widget = fresh.widgets.find((value) => value.kind === "calendar" && value.installed);
        const event = rows(record(widget?.data).events).find(
          (value) => value.id === draft.event?.id,
        );
        if (!widget || !event || event.connectionId !== "local")
          throw new Error("원본 일정을 찾을 수 없어요. 작성 중인 내용은 유지됩니다.");
        setCalendarDraft({
          date: draft.date,
          event,
          revision: widget.revision,
          reloadKey: (draft.reloadKey ?? 0) + 1,
        });
      }),
    );
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
    if (envelopeId && !targetDate) {
      setFailure("날짜나 내 페이지를 펼친 다음 연결해 주세요.");
      return;
    }
    dropping.current = true;
    setAddingWidget(true);
    setFailure(null);
    setNotice("");
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
      <WindowHeader
        className={s.header}
        title="내 다이어리"
        label="다이어리 닫기"
        onClose={async () => navigate(close, true)}
        actions={
          <>
            {!isDesktop() && <span className={s.caption}>예시 데이터</span>}
            <Button
              className={s.notesToggle}
              variant="quiet"
              size="compact"
              onClick={() => setNotesOpen(!notesOpen)}
            >
              메모
            </Button>
            <Button variant="quiet" size="compact" disabled={saving} onClick={openSettings}>
              연결·알림 설정 ↗
            </Button>
          </>
        }
      />
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
      {!snapshot || !diary.state ? (
        <p role="status" className={s.status}>
          다이어리를 펼치고 있어요.
        </p>
      ) : (
        <div className={s.layout}>
          <aside className={`${s.notes} ${notesOpen ? s.notesOpen : ""}`}>
            {notesOpen && (
              <Button
                className={s.notesToggle}
                variant="quiet"
                size="compact"
                onClick={() => setNotesOpen(false)}
              >
                메모 접기
              </Button>
            )}
            <DiaryNotes
              notes={notes}
              diaryAction={diaryAction}
              busy={saving}
              onDirtyChange={setNotesDirty}
              onOpenEnvelope={openEnvelope}
              envelopeNames={Object.fromEntries(
                envelopes.map((value) => [text(value.id), envelopeTitle(value)]),
              )}
            />
          </aside>
          <Surface
            padding="compact"
            className={s.index}
            role="navigation"
            aria-label="내 다이어리 목차"
          >
            <h2 className={s.indexTitle}>내 다이어리</h2>
            <MiniCalendar
              day={day}
              month={month}
              pages={pages}
              onMonth={setMonth}
              onDay={openDay}
            />
            <div className={s.toolMenu} role="group" aria-label="다이어리 메뉴">
              {TOOL_MENU.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={s.toolMenuItem}
                  aria-current={tool === value ? "page" : undefined}
                  onClick={() => openTool(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={s.section}>
              <div className={s.toolbar}>
                <h3 className={s.sectionTitle}>내 페이지</h3>
                <span className={s.spread} />
                <Button
                  aria-label="새 페이지"
                  variant="quiet"
                  size="compact"
                  onClick={() =>
                    navigate(() => {
                      setCreating("page");
                      setName("");
                    })
                  }
                >
                  +
                </Button>
              </div>
              {pages
                .filter((value) => !value.date)
                .map((value) => (
                  <button
                    type="button"
                    key={value.id}
                    className={s.navItem}
                    aria-current={!tool && pageId === value.id ? "page" : undefined}
                    onClick={() => openPage(value)}
                  >
                    {value.title}
                  </button>
                ))}
              {!pages.some((value) => !value.date) && (
                <p className={s.caption}>
                  읽은 책, 모으는 생각…
                  <br />
                  날짜 없이 이어 쓸 수 있어요.
                </p>
              )}
            </div>
            <div className={s.section}>
              <div className={s.toolbar}>
                <h3 className={s.sectionTitle}>준비 봉투</h3>
                <span className={s.spread} />
                <Button
                  aria-label="새 준비 봉투"
                  variant="quiet"
                  size="compact"
                  onClick={() =>
                    navigate(() => {
                      setCreating("envelope");
                      setName("");
                    })
                  }
                >
                  +
                </Button>
              </div>
              {envelopes
                .filter((value) => Boolean(value.archived) === archived)
                .map((value) => (
                  <button
                    type="button"
                    key={text(value.id)}
                    className={s.navItem}
                    aria-current={!tool && envelopeId === value.id ? "page" : undefined}
                    onClick={() => openEnvelope(text(value.id))}
                  >
                    {envelopeTitle(value)}
                    <br />
                    <span className={s.caption}>
                      {text(value.date) ||
                        (value.eventId ? text(value.eventLabel) : "날짜 없이 준비 중")}
                    </span>
                  </button>
                ))}
              {!envelopes.length && (
                <p className={s.caption}>
                  약속이 잡히기 전부터
                  <br />할 일과 자료를 모아 두세요.
                </p>
              )}
              <Button variant="quiet" size="compact" onClick={() => setArchived(!archived)}>
                {archived ? "준비 중인 봉투" : "보관한 봉투"}
              </Button>
            </div>
            <DiaryWidgetShelf
              snapshot={snapshot}
              busy={saving}
              onOpenWidget={openSourceWidget}
              onOpenMemo={openSourceWidget}
              onAdd={(payload) =>
                navigate(() => {
                  setTool(null);
                  void addWidgetItem(payload);
                })
              }
            />
          </Surface>
          <Surface
            padding="flush"
            className={`${s.page} ${dropActive ? s.dropActive : ""}`}
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
            <div className={s.toolbar}>
              <div className={s.viewSwitch} role="group" aria-label="다이어리 보기">
                {VIEWS.map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={s.viewButton}
                    aria-current={
                      !tool && (envelopeId || pageId ? "day" : view) === value ? "page" : undefined
                    }
                    onClick={() => changeView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className={s.spread} />
              {tool ? (
                <Button
                  variant="quiet"
                  size="compact"
                  onClick={() => navigate(() => setTool(null))}
                >
                  기록으로 돌아가기
                </Button>
              ) : envelopeId || pageId ? (
                <Button variant="quiet" size="compact" onClick={() => openDay(localDay())}>
                  오늘로 돌아가기
                </Button>
              ) : (
                <>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="이전 페이지"
                    onClick={() =>
                      openDay(
                        view === "month"
                          ? movePeriod(day, "month", -1)
                          : moveDay(day, view === "week" ? -7 : -1),
                        view,
                      )
                    }
                  >
                    ‹
                  </Button>
                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => openDay(localDay(), view)}
                  >
                    오늘
                  </Button>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="다음 페이지"
                    onClick={() =>
                      openDay(
                        view === "month"
                          ? movePeriod(day, "month", 1)
                          : moveDay(day, view === "week" ? 7 : 1),
                        view,
                      )
                    }
                  >
                    ›
                  </Button>
                </>
              )}
            </div>
            <div className={s.body}>
              {toolsOpened && (
                <div hidden={!tool} className={s.toolContent}>
                  <h1 className={s.title}>{TOOL_MENU.find(([value]) => value === tool)?.[1]}</h1>
                  <Planner
                    dismissVersion={toolDismissVersion}
                    embeddedTab={tool ?? "plans"}
                    onNavigate={openTool}
                    onStateChange={setToolState}
                  />
                </div>
              )}
              {!tool && (
                <>
                  {notice && (
                    <p role="status" className={s.caption}>
                      {notice}
                    </p>
                  )}
                  {envelope && preparation ? (
                    <DiaryEnvelope
                      key={text(envelope.id)}
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
                      onCreateTask={(title) => createTask(title, null)}
                      onOpenPage={openPage}
                      onReturnToDay={() => openDay(localDay())}
                      onDirtyChange={setPageDirty}
                    />
                  ) : (
                    <>
                      <div className={s.toolbar}>
                        <h1 className={s.title}>{heading}</h1>
                        <span className={s.spread} />
                        {!pageId && (
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={saving}
                            onClick={() => navigate(() => setCalendarDraft({ date: day }))}
                          >
                            + 일정
                          </Button>
                        )}
                        {page && view === "day" && (
                          <DiaryPageMenu
                            key={page.id}
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
                      <p className={s.caption}>
                        {pageId
                          ? "날짜와 상관없이 이어 쓰는 나의 페이지"
                          : view === "month"
                            ? "약속과 할 일을 펼쳐 보고, 날짜를 눌러 그날을 써요."
                            : view === "week"
                              ? "한 주를 펼쳐 놓고, 하루씩 이어 써요."
                              : `${day.slice(0, 4)}년 · 할 일, 약속, 떠오른 생각을 한곳에`}
                      </p>
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
                      {!pageId && view !== "day" ? (
                        <DiaryCalendar
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
                          onDay={openDay}
                          onEvent={openCalendarEvent}
                          onCreateEvent={(date) => navigate(() => setCalendarDraft({ date }))}
                          onDropItem={(payload, date) => void addWidgetItem(payload, date)}
                          onEnvelope={openEnvelope}
                        />
                      ) : (
                        <DiaryPage
                          key={pageId ? `page:${pageId}` : `day:${day}`}
                          page={page}
                          date={day}
                          items={items}
                          events={pageId ? [] : eventsOn(events, day)}
                          envelopes={envelopes}
                          moves={diary.state.moves}
                          widgets={widgets}
                          onOpenWidgetEntry={openWidgetEntry}
                          onOpenEvent={openCalendarEvent}
                          busy={saving}
                          onDiaryAction={diaryAction}
                          onAddTask={(title) => createTask(title, pageId ? null : day)}
                          onToggleTask={(item) => void toggleTask(item)}
                          onEditTask={setEditing}
                          onMoveTask={planTask}
                          onOpenEnvelope={openEnvelope}
                          onCreatePage={createPage}
                          onDirtyChange={setPageDirty}
                        />
                      )}
                      {!pageId && view !== "day" && (
                        <p className={s.legend}>□ 할 일　 · 기록이 있는 날　 ↗ 준비 봉투 연결</p>
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
      <Dialog
        isOpen={Boolean(creating)}
        title={creating === "page" ? "새 페이지" : "새 준비 봉투"}
        size="small"
        closeLabel="새로 만들기 닫기"
        onOpenChange={(open) => {
          if (!open && !saving) {
            setCreating(null);
            setName("");
          }
        }}
      >
        <form
          className={s.form}
          onSubmit={(event) => {
            event.preventDefault();
            void saveNew();
          }}
        >
          <FormField label={creating === "page" ? "페이지 이름" : "봉투 이름"}>
            <TextField
              autoFocus
              required
              maxLength={500}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={creating === "page" ? "예: 읽은 책" : "예: 토요일 모임 준비"}
            />
          </FormField>
          <p className={s.caption}>
            {creating === "page"
              ? "한 가지 주제를 날짜 없이 계속 이어 쓰세요."
              : "날짜는 나중에 정해도 좋아요. 할 일과 자료부터 담아 두세요."}
          </p>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
            만들기
          </Button>
        </form>
      </Dialog>
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
      <Dialog
        isOpen={Boolean(selectedEvent)}
        title={text(selectedEvent?.title) || "약속"}
        size="small"
        closeLabel="약속 닫기"
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      >
        {selectedEvent && (
          <div className={s.form}>
            <p>
              {eventTime(selectedEvent)} · {text(selectedEvent.calendarName) || "연결된 캘린더"}
            </p>
            <p className={s.caption}>외부 일정은 원본 캘린더에서 수정해요.</p>
            <Button
              variant="primary"
              onClick={() => {
                setSelectedEvent(null);
                openDay(day);
              }}
            >
              이날 펼치기
            </Button>
            {envelopes
              .filter((value) => value.eventId === selectedEvent.id)
              .map((value) => (
                <Button
                  key={text(value.id)}
                  variant="secondary"
                  onClick={() => {
                    setSelectedEvent(null);
                    openEnvelope(text(value.id));
                  }}
                >
                  {envelopeTitle(value)} ↗
                </Button>
              ))}
          </div>
        )}
      </Dialog>
      <Dialog
        isOpen={Boolean(leave)}
        title="작성 중인 내용이 있어요"
        size="small"
        closeLabel="작성 계속하기"
        onOpenChange={(open) => {
          if (!open) setLeave(null);
        }}
      >
        <p>
          저장하지 않은 내용을 확인하고{" "}
          {leave?.closing ? "다이어리를 닫을까요?" : "다른 페이지로 이동할까요?"}
        </p>
        <div className={s.toolbar}>
          <Button variant="secondary" onClick={() => setLeave(null)}>
            계속 작성
          </Button>
          <Button
            variant="critical"
            disabled={saving}
            onClick={() => {
              const action = leave?.action;
              discardDiaryPageDraft(page, day);
              setPageDirty(false);
              setPageMenuDirty(false);
              setEditing(null);
              setName("");
              setCreating(null);
              setCalendarDraft(null);
              setCalendarDirty(false);
              if (toolState.blocking) {
                setToolDismissVersion((value) => value + 1);
              }
              setLeave(null);
              action?.();
            }}
          >
            {leave?.closing ? "저장하지 않고 닫기" : "저장하지 않고 이동"}
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
