import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { Diary } from "../Planner/Diary";
import * as diaryStyles from "../Planner/diary.css";
import type { DiaryState } from "../Planner/diaryTypes";
import type { DataRecord } from "../toolData";
import { localDay } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";
import { WIDGET_DRAG_TYPE, type WidgetDragPayload } from "../widgetDrag";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
const native = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
  startDragging: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

const DAY = "2026-10-03";
const NEXT_DAY = "2026-10-04";
let widgets: WidgetSnapshot;
let diary: DiaryState;
let update: (action: string, input: DataRecord) => DiaryState;
let execute: (request: DataRecord) => string | null;

function widget(kind: string, data: DataRecord): WidgetView {
  return {
    id: kind,
    kind,
    installed: true,
    enabled: true,
    revision: 7,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}

function task(id: string, title: string, plannedDate: string | null = DAY): DataRecord {
  return {
    id,
    title,
    plannedDate,
    listId: "default",
    memo: "",
    completedAt: null,
    dueDate: "2026-10-09",
    dueAt: null,
    planPeriod: "none",
    planAnchor: null,
    repeat: "none",
    repeatRule: null,
  };
}

function setTasks(items: DataRecord[]): void {
  widgets.widgets = [widget("todo", { lists: [{ id: "default", name: "내 할 일" }], items })];
}

async function openDiary(): Promise<void> {
  render(<Diary />);
  await screen.findByRole("navigation", { name: "내 다이어리 목차" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_tab"));
  showJournal();
}

function showJournal(): void {
  const journal = screen.queryByRole("radio", { name: "한 줄 기록" });
  if (journal) fireEvent.click(journal);
}

function showNotes(): void {
  fireEvent.click(screen.getByRole("link", { name: /^메모/ }));
}

async function showTasks(view: "plans" | "templates" | "today"): Promise<void> {
  if (!screen.queryByRole("radiogroup", { name: "할 일 보기" })) {
    fireEvent.click(screen.getByRole("link", { name: /^할 일/ }));
  }
  if (screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })) return;
  if (view === "templates") {
    if (!screen.queryByRole("button", { name: "템플릿에서 고르기" })) {
      fireEvent.click(await screen.findByRole("radio", { name: "날짜별" }));
    }
    if (screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })) return;
    fireEvent.click(await screen.findByRole("button", { name: "템플릿에서 고르기" }));
    return;
  }
  const label = view === "plans" ? "기간별" : "날짜별";
  fireEvent.click(await screen.findByRole("radio", { name: label }));
}

function showToday(): void {
  fireEvent.click(screen.getByRole("link", { name: "오늘" }));
  showJournal();
}

function showPage(title: string): void {
  fireEvent.click(screen.getByRole("link", { name: "내 페이지" }));
  const option = screen.getByRole("option", { name: title }) as HTMLOptionElement;
  fireEvent.change(screen.getByRole("combobox", { name: "내 페이지 선택" }), {
    target: { value: option.value },
  });
}

function chooseDay(date: string): void {
  fireEvent.click(screen.getByRole("link", { name: "캘린더" }));
  fireEvent.click(screen.getByRole("button", { name: `${date} 하루 펼치기` }));
  showJournal();
}

function opened(): ReturnType<typeof within> {
  return within(screen.getByLabelText("펼친 페이지"));
}

async function addTask(title: string): Promise<void> {
  const trigger = opened().queryByRole("button", {
    name: "할 일, 떠오른 생각, 오늘의 일을 한 줄로…",
  });
  if (trigger) fireEvent.click(trigger);
  fireEvent.click(opened().getByRole("button", { name: "할 일" }));
  fireEvent.change(opened().getByRole("textbox", { name: "새 기록 내용" }), {
    target: { value: title },
  });
  fireEvent.click(opened().getByRole("button", { name: "할 일 추가" }));
  await waitFor(() =>
    expect(opened().getByRole("textbox", { name: "새 기록 내용" })).toHaveProperty("value", ""),
  );
}

function actions(commandName: string): Record<string, unknown>[] {
  return vi
    .mocked(command)
    .mock.calls.filter(([name]) => name === commandName)
    .map(([, args]) => args ?? {});
}

function dropItem(target: Element, payload: WidgetDragPayload): void {
  fireEvent.drop(target, {
    dataTransfer: {
      getData: (type: string) => (type === WIDGET_DRAG_TYPE ? JSON.stringify(payload) : ""),
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
  localStorage.clear();
  window.history.replaceState(null, "", "/?view=planner");
  widgets = { catalog: [], onboardingDone: true, widgets: [] };
  diary = { revision: 3, pages: [], notes: [], moves: [] };
  update = () => {
    throw new Error("Unexpected diary mutation");
  };
  execute = () => {
    throw new Error("Unexpected widget mutation");
  };
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name, args) => {
      if (name === "get_widgets") return structuredClone(widgets);
      if (name === "get_diary") return structuredClone(diary);
      if (name === "get_planner_tab") return "today";
      if (name === "get_planner_note_target") return null;
      if (name === "get_planner_view_target") return null;
      if (name === "set_planner_tab") return null;
      if (name === "update_diary") return update(String(args?.action), args?.input as DataRecord);
      if (name === "execute_widget") return execute(args?.request as DataRecord);
      throw new Error(`Unexpected command: ${name}`);
    });
  native.onCloseRequested.mockReset().mockResolvedValue(() => undefined);
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => undefined);
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.startDragging.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});

it("opens the todo list from its deep link before native startup navigation resolves", async () => {
  setTasks([task("todo-route", "위젯에서 연 할 일")]);
  window.history.replaceState(null, "", "/?view=planner&tab=todos");
  const existing = vi.mocked(command).getMockImplementation()!;
  let finishNavigation!: (tab: string) => void;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "get_planner_tab"
      ? new Promise((resolve) => {
          finishNavigation = resolve;
        })
      : existing(name, args),
  );
  render(<Diary />);
  expect(await screen.findByRole("radiogroup", { name: "할 일 보기" })).toBeTruthy();
  await act(async () => finishNavigation("todos"));
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "todos" }));
  expect(screen.getByRole("link", { name: /^할 일/ }).getAttribute("aria-current")).toBe("page");
});

it("opens the todo list from native startup navigation without a URL tab", async () => {
  setTasks([task("todo-route", "위젯에서 연 할 일")]);
  const existing = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "get_planner_tab" ? Promise.resolve("todos") : existing(name, args),
  );
  render(<Diary />);
  expect(await screen.findByRole("radiogroup", { name: "할 일 보기" })).toBeTruthy();
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "todos" }));
});

it("keeps repeated todo open events on the list and preserves the today destination", async () => {
  setTasks([task("todo-route", "위젯에서 연 할 일")]);
  await openDiary();
  for (const tab of ["todos", "todos", "today"]) {
    act(() => {
      for (const [event, callback] of vi.mocked(listen).mock.calls)
        if (event === "planner-tab") callback({ event, id: 1, payload: tab });
    });
    await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab }));
    if (tab === "todos") {
      expect(screen.getByRole("radiogroup", { name: "할 일 보기" })).toBeTruthy();
      expect(screen.getByRole("link", { name: /^할 일/ }).getAttribute("aria-current")).toBe(
        "page",
      );
    } else {
      expect(screen.queryByRole("radiogroup", { name: "할 일 보기" })).toBeNull();
      expect(screen.getByRole("link", { name: "오늘" }).getAttribute("aria-current")).toBe("page");
    }
  }
  expect(actions("execute_widget")).toEqual([]);
  expect(actions("update_diary")).toEqual([]);
});

it("opens the preparation collection from its initial deep link after widgets load", async () => {
  window.history.replaceState(null, "", "/?view=planner&tab=envelopes");
  widgets.widgets = [
    widget("preparation", {
      envelopes: [
        { id: "trip", title: "여행 준비", checks: [], links: [], todoIds: [], archived: false },
      ],
    }),
  ];
  render(<Diary />);
  expect(await screen.findByRole("article", { name: "여행 준비 준비 봉투" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /^준비 봉투/ }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
});

it("handles preparation and time navigation events without recreating stored data", async () => {
  widgets.widgets = [
    widget("preparation", {
      envelopes: [
        { id: "trip", title: "여행 준비", checks: [], links: [], todoIds: [], archived: false },
      ],
    }),
  ];
  render(<Diary />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_tab"));
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-tab") callback({ event, id: 1, payload: "envelopes" });
  });
  expect(await screen.findByRole("article", { name: "여행 준비 준비 봉투" })).toBeTruthy();
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-tab") callback({ event, id: 1, payload: "time" });
  });
  expect(screen.getByRole("radio", { name: "하루" })).toHaveProperty("checked", true);
  expect(screen.getByRole("radio", { name: "요약" })).toHaveProperty("checked", true);
  expect(screen.getByRole("link", { name: "오늘" }).getAttribute("aria-current")).toBe("page");
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
  expect(command).not.toHaveBeenCalledWith("update_diary", expect.anything());
});

it("opens an exact page from the startup target after the diary has loaded", async () => {
  diary.pages = [
    { id: "first", title: "다른 기록", date: null, entries: [] },
    { id: "requested", title: "열어야 할 기록", date: null, entries: [] },
  ];
  const original = structuredClone(diary);
  const existing = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "get_planner_view_target"
      ? Promise.resolve({ entity: "page", targetId: "requested" })
      : existing(name, args),
  );
  render(<Diary />);
  expect(await screen.findByRole("heading", { name: "열어야 할 기록", level: 1 })).toBeTruthy();
  expect(diary).toEqual(original);
  expect(actions("update_diary")).toEqual([]);
  expect(actions("execute_widget")).toEqual([]);
});

it("opens an exact live event target and reports a removed target without opening another event", async () => {
  widgets.widgets = [
    widget("calendar", {
      connections: [],
      events: [
        {
          id: "first",
          title: "다른 일정",
          connectionId: "local",
          allDay: true,
          startDate: DAY,
          endDate: NEXT_DAY,
        },
        {
          id: "requested",
          title: "연결한 일정",
          connectionId: "local",
          allDay: true,
          startDate: DAY,
          endDate: NEXT_DAY,
        },
      ],
    }),
  ];
  await openDiary();
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-view-target")
        callback({ event, id: 1, payload: { entity: "event", targetId: "requested" } });
  });
  expect(await screen.findByRole("dialog", { name: "연결한 일정" })).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "연결한 일정" })).getByRole("button", {
      name: "약속 닫기",
    }),
  );
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-view-target")
        callback({ event, id: 1, payload: { entity: "event", targetId: "missing" } });
  });
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("해당 일정을 현재 찾을 수 없어요"),
  );
  expect(screen.queryByRole("dialog", { name: "다른 일정" })).toBeNull();
  expect(actions("update_diary")).toEqual([]);
  expect(actions("execute_widget")).toEqual([]);
});

it("keeps a journal draft until a page target passes the existing navigation guard", async () => {
  diary.pages = [
    {
      id: "requested",
      title: "이어 볼 기록",
      date: NEXT_DAY,
      entries: [{ id: "entry", kind: "note", text: "다음 날의 원문" }],
    },
  ];
  await openDiary();
  fireEvent.click(
    opened().getByRole("button", { name: "할 일, 떠오른 생각, 오늘의 일을 한 줄로…" }),
  );
  fireEvent.change(opened().getByRole("textbox", { name: "새 기록 내용" }), {
    target: { value: "아직 쓰는 초안" },
  });
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-view-target")
        callback({ event, id: 1, payload: { entity: "page", targetId: "requested" } });
  });
  expect(await screen.findByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  expect(screen.queryByText("다음 날의 원문")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(opened().getByRole("textbox", { name: "새 기록 내용" })).toHaveProperty(
    "value",
    "아직 쓰는 초안",
  );
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls)
      if (event === "planner-view-target")
        callback({ event, id: 1, payload: { entity: "page", targetId: "requested" } });
  });
  fireEvent.click(await screen.findByRole("button", { name: "저장하지 않고 이동" }));
  expect(await screen.findByText("다음 날의 원문")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "한 줄 기록" })).toHaveProperty("checked", true);
  expect(actions("update_diary")).toEqual([]);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

it("creates one quick task on the selected date without duplicating a diary record", async () => {
  setTasks([]);
  execute = (request) => {
    expect(request.expectedRevision).toBe(7);
    expect(request.input).toEqual({ title: "한 줄 할 일", plannedDate: localDay() });
    widgets.widgets[0].revision += 1;
    return "quick-task";
  };
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  fireEvent.change(screen.getByLabelText(/빠른 할 일 제목/), { target: { value: "한 줄 할 일" } });
  fireEvent.click(screen.getByRole("button", { name: "할 일 저장" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "빠른 할 일" })).toBeNull());
  expect(actions("execute_widget")).toHaveLength(1);
  expect(actions("update_diary")).toEqual([]);
});

it("keeps a collapsed quick-task draft and warns before navigation and native close", async () => {
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  fireEvent.change(screen.getByLabelText(/빠른 할 일 제목/), { target: { value: "나중에 저장" } });
  fireEvent.click(screen.getByRole("button", { name: "닫아두기" }));
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  expect(screen.getByLabelText(/빠른 할 일 제목/)).toHaveProperty("value", "나중에 저장");
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  const event = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 닫기" }));
  expect(native.destroy).toHaveBeenCalledOnce();
  expect(actions("execute_widget")).toEqual([]);
});

it("keeps failed quick input for retry and synchronously blocks duplicate submissions", async () => {
  setTasks([]);
  execute = () => {
    throw new Error("저장 실패");
  };
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  fireEvent.change(screen.getByLabelText(/빠른 할 일 제목/), { target: { value: "실패한 제목" } });
  fireEvent.click(screen.getByRole("button", { name: "할 일 저장" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText(/빠른 할 일 제목/)).toHaveProperty("value", "실패한 제목");
  execute = () => "retried";
  const form = screen.getByRole("form", { name: "빠른 할 일" });
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  await waitFor(() => expect(screen.queryByRole("form", { name: "빠른 할 일" })).toBeNull());
  expect(actions("execute_widget")).toHaveLength(2);
});

it("uses no planned date in the collection and enables Todo before creating its quick task", async () => {
  widgets.widgets = [{ ...widget("todo", { items: [] }), enabled: false }];
  const original = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "set_widget_enabled") {
      widgets.widgets[0].enabled = true;
      widgets.widgets[0].revision = 9;
      return;
    }
    return original(name, args);
  });
  execute = (request) => {
    expect(request.expectedRevision).toBe(9);
    expect(request.input).toEqual({ title: "날짜 없는 할 일", plannedDate: null });
    return "collection-task";
  };
  await openDiary();
  await showTasks("plans");
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  fireEvent.change(screen.getByLabelText(/빠른 할 일 제목/), {
    target: { value: "날짜 없는 할 일" },
  });
  fireEvent.click(screen.getByRole("button", { name: "할 일 저장" }));
  await waitFor(() => expect(actions("execute_widget")).toHaveLength(1));
  expect(command).toHaveBeenCalledWith("set_widget_enabled", { id: "todo", enabled: true });
  expect(actions("update_diary")).toEqual([]);
});

it("opens the exact stored note from a conversation without changing its location or discarding an editor draft", async () => {
  diary.notes = [
    { id: "linked-note", title: "이어갈 작업", body: "독자 검증은 아직", pinned: false },
  ];
  await openDiary();
  function requestNote(): void {
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "planner-note") callback({ event, id: 1, payload: "linked-note" });
    }
  }
  act(requestNote);
  const content = await screen.findByRole("textbox", { name: "메모 내용" });
  expect(content).toHaveProperty("value", "독자 검증은 아직");
  fireEvent.change(content, { target: { value: "편집 중인 다음 작업" } });
  act(requestNote);
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "편집 중인 다음 작업",
  );
  expect(diary.notes[0].pinned).toBe(false);
  expect(actions("update_diary")).toEqual([]);
});

it("projects month and week calendars into native state and clears it for tools and day pages", async () => {
  await openDiary();
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "today" }));
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "calendar" }));
  const calendarWrites = actions("set_planner_tab").length;
  fireEvent.click(screen.getByRole("radio", { name: "주" }));
  expect(actions("set_planner_tab")).toHaveLength(calendarWrites);
  await showTasks("plans");
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "plans" }));
  showToday();
  await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab: "today" }));
});

it("waits for startup navigation before publishing a calendar condition", async () => {
  const existing = vi.mocked(command).getMockImplementation()!;
  let finishNavigation!: (tab: string) => void;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "get_planner_tab"
      ? new Promise((resolve) => {
          finishNavigation = resolve;
        })
      : existing(name, args),
  );
  await openDiary();
  expect(actions("set_planner_tab")).toEqual([]);
  await act(async () => finishNavigation("calendar"));
  await waitFor(() => expect(actions("set_planner_tab")).toEqual([{ tab: "calendar" }]));
  expect(screen.getByRole("radio", { name: "월" })).toHaveProperty("checked", true);
});

it("links the exact returned Todo IDs and uses fresh widget revisions before a widgets-state event", async () => {
  setTasks([]);
  diary.pages = [{ id: "daily", title: "", date: DAY, entries: [] }];
  let created = 0;
  execute = (request) => {
    const id = `created-${++created}`;
    const input = request.input as DataRecord;
    widgets.widgets[0] = {
      ...widgets.widgets[0],
      revision: widgets.widgets[0].revision + 1,
      data: {
        lists: [{ id: "default", name: "내 할 일" }],
        items: [
          ...((widgets.widgets[0].data as DataRecord).items as DataRecord[]),
          task(`unrelated-${created}`, "다른 창의 할 일"),
          task(id, String(input.title)),
        ],
      },
    };
    return id;
  };
  update = (action, input) => {
    expect(action).toBe("entry-add");
    diary = {
      ...diary,
      revision: diary.revision + 1,
      pages: [
        {
          ...diary.pages[0],
          entries: [
            ...diary.pages[0].entries,
            {
              id: `entry-${created}`,
              kind: "todo",
              text: String(input.text),
              refId: String(input.refId),
            },
          ],
        },
      ],
    };
    return structuredClone(diary);
  };
  await openDiary();
  await addTask("자료 읽기");
  await addTask("질문 정리하기");

  expect(actions("execute_widget").map(({ request }) => request)).toEqual([
    expect.objectContaining({
      action: "add",
      instanceId: "todo",
      expectedRevision: 7,
      input: { title: "자료 읽기", plannedDate: DAY },
    }),
    expect.objectContaining({
      action: "add",
      instanceId: "todo",
      expectedRevision: 8,
      input: { title: "질문 정리하기", plannedDate: DAY },
    }),
  ]);
  expect(actions("update_diary")).toEqual([
    {
      expectedRevision: 3,
      action: "entry-add",
      input: { pageId: "daily", kind: "todo", text: "자료 읽기", refId: "created-1" },
    },
    {
      expectedRevision: 4,
      action: "entry-add",
      input: { pageId: "daily", kind: "todo", text: "질문 정리하기", refId: "created-2" },
    },
  ]);
});

it("opens its own new undated page after another page was created elsewhere, then returns to a selected day", async () => {
  setTasks([task("today-task", "오늘 준비"), task("tomorrow-task", "내일 준비", NEXT_DAY)]);
  diary.pages = [{ id: "daily", title: "", date: DAY, entries: [] }];
  update = (action, input) => {
    expect(action).toBe("page-create");
    expect(input).toEqual({ title: "읽은 책", date: null });
    diary = {
      ...diary,
      revision: 5,
      pages: [...diary.pages, { id: "my-page", title: "읽은 책", date: null, entries: [] }],
    };
    return structuredClone(diary);
  };
  await openDiary();
  expect(opened().getByRole("checkbox", { name: "오늘 준비" })).toBeTruthy();
  fireEvent.click(screen.getByRole("link", { name: "내 페이지" }));
  fireEvent.click(opened().getByRole("button", { name: "새 페이지" }));
  const dialog = within(screen.getByRole("dialog", { name: "새 페이지" }));
  fireEvent.change(dialog.getByRole("textbox", { name: "페이지 이름" }), {
    target: { value: "읽은 책" },
  });
  act(() => {
    fireEvent.click(dialog.getByRole("button", { name: "만들기" }));
    diary = {
      ...diary,
      revision: 4,
      pages: [
        ...diary.pages,
        { id: "other-window", title: "다른 창에서 만든 페이지", date: null, entries: [] },
      ],
    };
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "diary-updated") callback({ event, id: 1, payload: structuredClone(diary) });
    }
  });
  await waitFor(() =>
    expect(opened().getByRole("heading", { name: "읽은 책", level: 1 })).toBeTruthy(),
  );
  expect(opened().queryByRole("checkbox", { name: "오늘 준비" })).toBeNull();
  expect(actions("update_diary")).toEqual([
    { expectedRevision: 4, action: "page-create", input: { title: "읽은 책", date: null } },
  ]);
  chooseDay(NEXT_DAY);
  expect(opened().getByRole("checkbox", { name: "내일 준비" })).toBeTruthy();
  expect(opened().queryByRole("checkbox", { name: "오늘 준비" })).toBeNull();
});

it("preserves the full long page title and page selection/create actions", async () => {
  const title =
    "qa page long title alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron";
  diary.pages = [
    { id: "long-page", title, date: null, entries: [] },
    { id: "other-page", title: "다른 페이지", date: null, entries: [] },
  ];
  await openDiary();
  showPage(title);
  expect(opened().getByRole("heading", { name: title, level: 1 }).getAttribute("title")).toBe(
    title,
  );
  expect(screen.getByRole("combobox", { name: "내 페이지 선택" })).toHaveProperty(
    "value",
    "long-page",
  );
  showPage("다른 페이지");
  expect(opened().getByRole("heading", { name: "다른 페이지", level: 1 })).toBeTruthy();
  showPage(title);
  fireEvent.click(opened().getByRole("button", { name: "새 페이지" }));
  expect(screen.getByRole("dialog", { name: "새 페이지" })).toBeTruthy();
});

it("moves a dated Todo from a collection using the Todo's actual date while preserving the deadline", async () => {
  const item = task("task", "책 반납", "2026-10-01");
  setTasks([item]);
  diary.pages = [
    {
      id: "collection",
      title: "읽은 책",
      date: null,
      entries: [{ id: "reference", kind: "todo", text: "책 반납", refId: "task" }],
    },
  ];
  update = () => ({ ...diary, revision: 4 });
  await openDiary();
  showPage("읽은 책");
  fireEvent.click(opened().getByRole("button", { name: "할 일·위젯 연결과 기존 기록 편집" }));
  fireEvent.click(opened().getByRole("button", { name: "책 반납 날짜 옮기기" }));
  fireEvent.change(opened().getByLabelText("책 반납 옮길 날짜"), {
    target: { value: "2026-10-06" },
  });
  fireEvent.click(opened().getByRole("button", { name: "이 날짜로 옮기기" }));
  await waitFor(() =>
    expect(actions("update_diary")).toEqual([
      {
        expectedRevision: 3,
        action: "move-record",
        input: { todoId: "task", fromDate: "2026-10-01", toDate: "2026-10-06", title: "책 반납" },
      },
    ]),
  );
  expect(actions("execute_widget")).toEqual([]);
  expect(item.dueDate).toBe("2026-10-09");
});

it("gives a previously undated collection Todo its first plan without inventing a move history", async () => {
  setTasks([task("task", "자료 모으기", null)]);
  diary.pages = [
    {
      id: "collection",
      title: "모아둔 생각",
      date: null,
      entries: [{ id: "reference", kind: "todo", text: "자료 모으기", refId: "task" }],
    },
  ];
  execute = () => null;
  await openDiary();
  showPage("모아둔 생각");
  fireEvent.click(opened().getByRole("button", { name: "할 일·위젯 연결과 기존 기록 편집" }));
  fireEvent.click(opened().getByRole("button", { name: "자료 모으기 날짜 옮기기" }));
  fireEvent.change(opened().getByLabelText("자료 모으기 옮길 날짜"), {
    target: { value: "2026-10-06" },
  });
  fireEvent.click(opened().getByRole("button", { name: "이 날짜로 옮기기" }));
  await waitFor(() =>
    expect(actions("execute_widget")).toEqual([
      {
        request: expect.objectContaining({
          action: "plan",
          input: { ids: ["task"], date: "2026-10-06" },
        }),
      },
    ]),
  );
  expect(actions("update_diary")).toEqual([]);
});

it("shows an independently dated envelope in the day, month and week and opens the same envelope", async () => {
  widgets.widgets = [
    widget("preparation", {
      envelopes: [
        {
          id: "envelope",
          title: "주말 준비",
          date: DAY,
          eventId: "",
          checks: [],
          links: [],
          todoIds: [],
          archived: false,
        },
        {
          id: "archived",
          title: "보관한 준비",
          date: DAY,
          eventId: "",
          checks: [],
          links: [],
          todoIds: [],
          archived: true,
        },
      ],
    }),
  ];
  await openDiary();
  expect(opened().getByRole("button", { name: /주말 준비/ })).toBeTruthy();
  expect(opened().queryByRole("button", { name: /보관한 준비/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  expect(opened().getByRole("button", { name: /주말 준비/ })).toBeTruthy();
  expect(opened().queryByRole("button", { name: /보관한 준비/ })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "주" }));
  fireEvent.click(opened().getByRole("button", { name: /주말 준비/ }));
  expect(opened().getByRole("heading", { name: "주말 준비" })).toBeTruthy();
  expect(opened().getByText("10월 3일 토요일")).toBeTruthy();
  expect(actions("execute_widget")).toEqual([]);
});

it.each(["journal", "envelope", "page"] as const)(
  "starts task focus from %s details without inheriting the previous timer context",
  async (source) => {
    const item = { ...task("response", "늦은 도착 응답 확인"), memo: "할 일 참고 메모" };
    setTasks([item]);
    diary.pages = [
      {
        id: "collection",
        title: "자료 모음",
        date: null,
        entries: [
          { id: "reference", kind: "todo", text: "늦은 도착 응답 확인", refId: "response" },
        ],
      },
    ];
    const timer = widget("focus-timer", {
      status: "idle",
      title: "이전 준비 봉투",
      todoId: "previous",
      memo: "이전 집중 메모",
      eventRef: { id: "previous-event" },
      noteRef: { kind: "diary", id: "previous-note" },
    });
    widgets.widgets.push(
      timer,
      widget("preparation", {
        envelopes: [
          {
            id: "envelope",
            title: "여행 준비",
            date: DAY,
            eventId: "",
            checks: [],
            links: [],
            todoIds: ["response"],
            archived: false,
          },
        ],
      }),
    );
    const original = structuredClone(widgets);
    execute = () => null;
    const existing = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation((name, args) =>
      name === "open_widget" ? Promise.resolve(undefined) : existing(name, args),
    );
    await openDiary();
    if (source === "envelope") fireEvent.click(opened().getByRole("button", { name: /여행 준비/ }));
    if (source === "page") {
      showPage("자료 모음");
      fireEvent.click(opened().getByRole("button", { name: "할 일·위젯 연결과 기존 기록 편집" }));
    }
    const existingButtons = opened().queryAllByRole("button", { name: "25분 집중 시작" });
    fireEvent.click(opened().getByRole("button", { name: "늦은 도착 응답 확인 상세 보기" }));
    const taskButtons = opened()
      .getAllByRole("button", { name: "25분 집중 시작" })
      .filter((button: HTMLElement) => !existingButtons.includes(button));
    expect(taskButtons).toHaveLength(1);
    fireEvent.click(taskButtons[0]!);
    await waitFor(() =>
      expect(actions("execute_widget")).toEqual([
        {
          request: expect.objectContaining({
            instanceId: timer.id,
            action: "start",
            input: {
              durationMs: 1500000,
              title: "늦은 도착 응답 확인",
              todoId: "response",
              memo: "",
              eventRef: null,
              noteRef: null,
            },
          }),
        },
      ]),
    );
    await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: timer.id }));
    expect(widgets).toEqual(original);
    expect(actions("update_diary")).toEqual([]);
  },
);

it("owns native close protection for both journal drafts and embedded planning tools", async () => {
  setTasks([]);
  await openDiary();
  fireEvent.click(
    opened().getByRole("button", { name: "할 일, 떠오른 생각, 오늘의 일을 한 줄로…" }),
  );
  fireEvent.change(opened().getByRole("textbox", { name: "새 기록 내용" }), {
    target: { value: "아직 쓰는 중" },
  });
  const preventDefault = vi.fn();
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(opened().getByRole("textbox", { name: "새 기록 내용" })).toHaveProperty(
    "value",
    "아직 쓰는 중",
  );

  await showTasks("plans");
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  const input = await screen.findByRole("textbox", { name: "새 할 일" });
  expect(screen.getByRole("navigation", { name: "내 다이어리 목차" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "다이어리로 돌아가기" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "캘린더" })).toBeNull();
  fireEvent.change(input, { target: { value: "기간 계획 초안" } });
  const toolPrevent = vi.fn();
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault: toolPrevent }));
  expect(native.onCloseRequested).toHaveBeenCalledOnce();
  expect(toolPrevent).toHaveBeenCalledOnce();
  expect(native.destroy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty(
    "value",
    "기간 계획 초안",
  );
});

it("returns external calendar shortcuts to the same diary and retains planning drafts", async () => {
  setTasks([]);
  await openDiary();
  await showTasks("plans");
  fireEvent.change(await screen.findByRole("textbox", { name: "새 할 일" }), {
    target: { value: "아직 제출하지 않은 계획" },
  });
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "planner-tab") callback({ event, id: 1, payload: "calendar" });
    }
  });
  expect(opened().getByRole("heading", { name: "2026년 10월" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "새 할 일" })).toBeNull();
  await showTasks("plans");
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty(
    "value",
    "아직 제출하지 않은 계획",
  );
  expect(vi.mocked(listen).mock.calls.filter(([name]) => name === "planner-tab")).toHaveLength(1);
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
});

it("shows the calendar when an external shortcut arrives from the memo screen", async () => {
  await openDiary();
  showNotes();
  expect(screen.getByRole("link", { name: /^메모/ }).getAttribute("aria-current")).toBe("page");
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "planner-tab") callback({ event, id: 1, payload: "calendar" });
    }
  });
  expect(opened().getByRole("heading", { name: "2026년 10월" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "캘린더" }).getAttribute("aria-current")).toBe("page");
});

it("retains template choices across journal navigation and confirms unsaved template changes on close", async () => {
  setTasks([]);
  await openDiary();
  await showTasks("templates");
  await screen.findByRole("navigation", { name: "템플릿 종류" });
  fireEvent.click(screen.getByRole("button", { name: "건강 관리" }));
  const choice = screen.getAllByRole("checkbox")[0];
  fireEvent.click(choice);
  showToday();
  expect(opened().getByRole("heading", { name: "10월 3일 토요일" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다이어리 닫기" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  await showTasks("templates");
  expect(screen.getByRole("button", { name: "건강 관리" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
  fireEvent.click(screen.getByRole("button", { name: "다이어리 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 닫기" }));
  await waitFor(() => expect(native.destroy).toHaveBeenCalledOnce());
});

it("closes a clean event editor when an external shortcut opens a diary tool", async () => {
  setTasks([]);
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  fireEvent.click(screen.getByRole("button", { name: "새 일정" }));
  expect(screen.getByRole("dialog", { name: "새 일정" })).toBeTruthy();
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "planner-tab") callback({ event, id: 1, payload: "plans" });
    }
  });
  expect(await screen.findByRole("textbox", { name: "새 할 일" })).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "새 일정" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeNull();
});

it("discards an open tool dialog without clearing other planning drafts", async () => {
  setTasks([]);
  await openDiary();
  await showTasks("templates");
  await screen.findByRole("navigation", { name: "템플릿 종류" });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  await showTasks("plans");
  fireEvent.change(screen.getByRole("textbox", { name: "새 할 일" }), {
    target: { value: "보존할 계획" },
  });
  fireEvent.click(screen.getByRole("button", { name: "목록 관리" }));
  act(() => {
    for (const [event, callback] of vi.mocked(listen).mock.calls) {
      if (event === "planner-tab") callback({ event, id: 1, payload: "calendar" });
    }
  });
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  expect(screen.queryByRole("dialog", { name: "목록 관리" })).toBeNull();
  expect(opened().getByRole("heading", { name: "2026년 10월" })).toBeTruthy();
  await showTasks("plans");
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty("value", "보존할 계획");
  await showTasks("templates");
  expect(screen.getAllByRole("checkbox")[0]).toHaveProperty("checked", false);
});

it("creates a local calendar event from a month date and edits the same event without an external connection", async () => {
  widgets.widgets = [widget("calendar", { connections: [], events: [] })];
  execute = (request) => {
    const input = request.input as DataRecord;
    widgets.widgets[0] = {
      ...widgets.widgets[0],
      revision: widgets.widgets[0].revision + 1,
      data: { connections: [], events: [{ ...input, id: "local-event", connectionId: "local" }] },
    };
    return "local-event";
  };
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  fireEvent.doubleClick(screen.getByTitle(`${NEXT_DAY} 빈 곳을 두 번 눌러 일정 추가`));
  const creator = within(screen.getByRole("dialog", { name: "새 일정" }));
  expect(creator.getByLabelText("시작 날짜")).toHaveProperty("value", NEXT_DAY);
  fireEvent.change(creator.getByLabelText("일정 제목"), { target: { value: "동네 축제" } });
  fireEvent.click(creator.getByRole("button", { name: "추가" }));
  const eventButton = await screen.findByRole("button", { name: "동네 축제" });
  expect(actions("execute_widget")[0]).toEqual({
    request: expect.objectContaining({
      instanceId: "calendar",
      expectedRevision: 7,
      action: "create-event",
      input: expect.objectContaining({
        title: "동네 축제",
        startDate: NEXT_DAY,
        endDate: "2026-10-05",
      }),
    }),
  });
  expect((actions("execute_widget")[0].request as DataRecord).input).not.toHaveProperty("id");

  fireEvent.click(eventButton);
  fireEvent.click(screen.getByRole("button", { name: "일정 편집" }));
  const editor = within(screen.getByRole("dialog", { name: "일정 편집" }));
  fireEvent.change(editor.getByLabelText("일정 제목"), { target: { value: "오후 동네 축제" } });
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "오후 동네 축제" });
  expect(actions("execute_widget")[1]).toEqual({
    request: expect.objectContaining({
      instanceId: "calendar",
      expectedRevision: 8,
      action: "update-event",
      input: expect.objectContaining({ id: "local-event", title: "오후 동네 축제" }),
    }),
  });
  expect(actions("update_diary")).toEqual([]);
});

it.each(["update-event", "delete-event"] as const)(
  "accepts %s on an unchanged event using the latest calendar revision",
  async (action) => {
    const event = {
      id: "local-event",
      connectionId: "local",
      title: "산책",
      allDay: true,
      startDate: DAY,
      endDate: NEXT_DAY,
    };
    widgets.widgets = [widget("calendar", { connections: [], events: [event] })];
    execute = () => null;
    await openDiary();
    fireEvent.click(screen.getByRole("radio", { name: "월" }));
    fireEvent.click(screen.getByRole("button", { name: "산책" }));
    fireEvent.click(screen.getByRole("button", { name: "일정 편집" }));
    const editor = within(screen.getByRole("dialog", { name: "일정 편집" }));
    fireEvent.change(editor.getByLabelText("일정 제목"), { target: { value: "아침 산책" } });
    widgets.widgets[0] = {
      ...widgets.widgets[0],
      revision: 8,
      data: {
        connections: [],
        events: [event, { ...event, id: "another-event", title: "별도 일정" }],
      },
    };
    if (action === "delete-event") {
      fireEvent.click(editor.getByRole("button", { name: "삭제" }));
      fireEvent.click(editor.getByRole("button", { name: "일정 삭제" }));
    } else {
      fireEvent.click(editor.getByRole("button", { name: "저장" }));
    }
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "일정 편집" })).toBeNull());
    expect(actions("execute_widget")).toEqual([
      {
        request: expect.objectContaining({
          expectedRevision: 8,
          action,
          input:
            action === "delete-event"
              ? { id: "local-event" }
              : expect.objectContaining({ id: "local-event", title: "아침 산책" }),
        }),
      },
    ]);
  },
);

it("rejects saving or deleting an event changed elsewhere and preserves the edited draft", async () => {
  const event = {
    id: "local-event",
    connectionId: "local",
    title: "산책",
    allDay: true,
    startDate: DAY,
    endDate: NEXT_DAY,
  };
  widgets.widgets = [widget("calendar", { connections: [], events: [event] })];
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  fireEvent.click(screen.getByRole("button", { name: "산책" }));
  fireEvent.click(screen.getByRole("button", { name: "일정 편집" }));
  const editor = within(screen.getByRole("dialog", { name: "일정 편집" }));
  fireEvent.change(editor.getByLabelText("일정 제목"), { target: { value: "저장 전 산책 초안" } });
  act(() => {
    widgets.widgets[0] = {
      ...widgets.widgets[0],
      revision: 8,
      data: { connections: [], events: [{ ...event, title: "다른 창에서 바꾼 산책" }] },
    };
    for (const [name, callback] of vi.mocked(listen).mock.calls) {
      if (name === "widgets-state")
        callback({ event: name, id: 1, payload: structuredClone(widgets) });
    }
  });
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(editor.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(editor.getByLabelText("일정 제목")).toHaveProperty("value", "저장 전 산책 초안");
  expect(actions("execute_widget")).toEqual([]);
  fireEvent.click(editor.getByRole("button", { name: "삭제" }));
  fireEvent.click(editor.getByRole("button", { name: "일정 삭제" }));
  await waitFor(() => expect(editor.getByRole("alert").textContent).toContain("삭제하지 못했어요"));
  expect(actions("execute_widget")).toEqual([]);
  expect(editor.getByLabelText("일정 제목")).toHaveProperty("value", "저장 전 산책 초안");
});

it("moves the original dated Todo when dropped onto a calendar date without creating a copy", async () => {
  const item = task("original", "자료 읽기", "2026-10-01");
  setTasks([item]);
  update = () => ({ ...diary, revision: 4 });
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  dropItem(screen.getByTitle(`${NEXT_DAY} 빈 곳을 두 번 눌러 일정 추가`), {
    v: 1,
    kind: "todo",
    widgetId: "todo",
    itemId: "original",
  });
  await screen.findByText(`${NEXT_DAY}에 연결했어요.`);
  expect(actions("update_diary")).toEqual([
    {
      expectedRevision: 3,
      action: "move-record",
      input: { todoId: "original", fromDate: "2026-10-01", toDate: NEXT_DAY, title: "자료 읽기" },
    },
  ]);
  expect(actions("execute_widget")).toEqual([]);
  expect(item.dueDate).toBe("2026-10-09");
});

it("adds an original desktop memo reference from persistent notes to an undated page", async () => {
  widgets.widgets = [widget("memo", { notes: [{ id: "note-1", body: "원본 메모" }] })];
  diary.pages = [{ id: "collection", title: "생각 모음", date: null, entries: [] }];
  update = () => ({ ...diary, revision: 4 });
  await openDiary();
  showPage("생각 모음");
  showNotes();
  fireEvent.click(screen.getByRole("button", { name: "페이지에 연결" }));
  expect(screen.getByText("연결 대상: 생각 모음").closest("[hidden]")).toBeNull();
  await waitFor(() =>
    expect(
      screen.getAllByRole("status").some((node) => node.textContent === "이 페이지에 연결했어요."),
    ).toBe(true),
  );
  expect(screen.getByRole("button", { name: "페이지에 연결" })).toBeTruthy();
  expect(actions("update_diary")).toEqual([
    {
      expectedRevision: 3,
      action: "entry-add",
      input: {
        pageId: "collection",
        kind: "widget",
        refId: "memo",
        itemId: "note-1",
        text: "원본 메모",
      },
    },
  ]);
  expect(actions("execute_widget")).toEqual([]);
});

it.each([DAY, NEXT_DAY])(
  "shows the retained %s link target and success without leaving notes",
  async (date) => {
    widgets.widgets = [widget("memo", { notes: [{ id: "note-1", body: "원본 메모" }] })];
    diary.pages = [{ id: "target", title: "", date, entries: [] }];
    update = () => ({ ...diary, revision: 4 });
    await openDiary();
    if (date !== DAY) chooseDay(date);
    showNotes();
    expect(screen.getByText(`연결 대상: ${date}`).closest("[hidden]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "페이지에 연결" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").some((node) => node.textContent === `${date}에 연결했어요.`),
      ).toBe(true),
    );
    expect(screen.getByRole("link", { name: /^메모/ }).getAttribute("aria-current")).toBe("page");
    expect(actions("update_diary")[0]).toMatchObject({
      action: "entry-add",
      input: { pageId: "target", itemId: "note-1" },
    });
  },
);

it("blocks duplicate pending note links and clears success when a retry fails", async () => {
  widgets.widgets = [widget("memo", { notes: [{ id: "note-1", body: "원본 메모" }] })];
  diary.pages = [{ id: "target", title: "", date: DAY, entries: [] }];
  let finish: ((state: DiaryState) => void) | undefined;
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "update_diary"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : fallback(name, args),
  );
  await openDiary();
  showNotes();
  const link = screen.getByRole("button", { name: "페이지에 연결" });
  fireEvent.click(link);
  fireEvent.click(link);
  await waitFor(() => expect(actions("update_diary")).toHaveLength(1));
  expect(link).toHaveProperty("disabled", true);
  await act(async () => finish?.({ ...diary, revision: 4 }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("status").some((node) => node.textContent === `${DAY}에 연결했어요.`),
    ).toBe(true),
  );
  vi.mocked(command).mockImplementation((name, args) =>
    name === "update_diary" ? Promise.reject(new Error("연결 저장 실패")) : fallback(name, args),
  );
  fireEvent.click(link);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("연결 저장 실패"));
  expect(screen.queryByText(`${DAY}에 연결했어요.`)).toBeNull();
  expect(link).toHaveProperty("disabled", false);
  expect(screen.getByText(`연결 대상: ${DAY}`)).toBeTruthy();
});

it("creates a dated page for a dropped widget reference and uses its returned revision", async () => {
  widgets.widgets = [widget("timer", { running: false })];
  update = (action) => {
    diary = {
      ...diary,
      revision: diary.revision + 1,
      pages: [{ id: "created-page", title: "", date: DAY, entries: [] }],
    };
    expect(["page-create", "entry-add"]).toContain(action);
    return structuredClone(diary);
  };
  await openDiary();
  dropItem(screen.getByLabelText("펼친 페이지"), { v: 1, kind: "widget", widgetId: "timer" });
  await screen.findByText(`${DAY}에 연결했어요.`);
  expect(actions("update_diary")).toEqual([
    { expectedRevision: 3, action: "page-create", input: { date: DAY, title: "" } },
    {
      expectedRevision: 4,
      action: "entry-add",
      input: { pageId: "created-page", kind: "widget", refId: "timer", text: "timer" },
    },
  ]);
  expect(actions("execute_widget")).toEqual([]);
});

it.each([
  { v: 1, kind: "widget", widgetId: "missing" },
  { v: 1, kind: "memo", widgetId: "memo", itemId: "missing-note" },
] satisfies WidgetDragPayload[])(
  "rejects a dropped reference whose source no longer exists: $kind",
  async (payload) => {
    widgets.widgets = [widget("memo", { notes: [] })];
    await openDiary();
    dropItem(screen.getByLabelText("펼친 페이지"), payload);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("원본"));
    expect(actions("update_diary")).toEqual([]);
    expect(actions("execute_widget")).toEqual([]);
  },
);

it("keeps the calendar and embedded task manager on one date and preserves pinned notes through the memo destination", async () => {
  setTasks([task("one", "오늘 작업"), task("two", "다음 날 작업", NEXT_DAY)]);
  diary.notes = [{ id: "pinned", title: "늘 보는 메모", body: "모든 날짜의 안내", pinned: true }];
  await openDiary();
  chooseDay(NEXT_DAY);
  showNotes();
  expect(
    within(screen.getByRole("region", { name: "계속 쓸 메모" })).getByRole("textbox", {
      name: "메모 내용",
    }),
  ).toHaveProperty("value", "모든 날짜의 안내");
  await showTasks("today");
  expect(await screen.findByRole("checkbox", { name: "다음 날 작업" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "오늘 작업" })).toBeTruthy();
  showNotes();
  expect(
    within(screen.getByRole("region", { name: "계속 쓸 메모" })).getByRole("textbox", {
      name: "메모 내용",
    }),
  ).toHaveProperty("value", "모든 날짜의 안내");
  await showTasks("today");
  fireEvent.change(screen.getByLabelText("새 할 일 계획일"), { target: { value: DAY } });
  expect(screen.getByRole("checkbox", { name: "오늘 작업" })).toBeTruthy();
  expect(screen.getByLabelText("새 할 일 계획일")).toHaveProperty("value", DAY);
  showToday();
  expect(screen.getByRole("checkbox", { name: "오늘 작업" })).toBeTruthy();
  showNotes();
  expect(
    within(screen.getByRole("region", { name: "계속 쓸 메모" })).getByRole("textbox", {
      name: "메모 내용",
    }),
  ).toHaveProperty("value", "모든 날짜의 안내");
  expect(actions("execute_widget")).toEqual([]);
  expect(actions("update_diary")).toEqual([]);
});

it("shows complete event details and the selected-day agenda before explicit editing", async () => {
  const title = "생략되지 않는 아주 긴 Comet 일정 제목과 준비 내용을 끝까지 확인하기";
  widgets.widgets = [
    widget("calendar", {
      connections: [],
      events: [
        {
          id: "long",
          connectionId: "local",
          title,
          allDay: true,
          startDate: DAY,
          endDate: NEXT_DAY,
          location: "모임 장소",
          description: "전체 일정 설명\n두 번째 줄",
        },
        {
          id: "second",
          connectionId: "local",
          title: "같은 날 다른 일정",
          allDay: true,
          startDate: DAY,
          endDate: NEXT_DAY,
        },
      ],
    }),
  ];
  await openDiary();
  const page = screen.getByLabelText("다이어리 본문");
  const body = page.parentElement!;
  body.scrollTop = 180;
  fireEvent.scroll(body);
  fireEvent.click(opened().getAllByRole("button", { name: "일정 보기" })[0]);
  const detail = within(screen.getByRole("dialog", { name: title }));
  expect(detail.getAllByText(title).length).toBeGreaterThan(0);
  expect(detail.getByText("전체 일정 설명 두 번째 줄")).toBeTruthy();
  expect(detail.getByRole("region", { name: "선택 날짜 전체 일정" }).textContent).toContain(
    "같은 날 다른 일정",
  );
  const agenda = within(detail.getByRole("region", { name: "선택 날짜 전체 일정" }));
  const longEvent = agenda.getByRole("button", { name: `종일 · ${title}` });
  expect(longEvent.className).toContain(diaryStyles.agendaEventButton);
  fireEvent.click(agenda.getByRole("button", { name: "종일 · 같은 날 다른 일정" }));
  expect(screen.getByRole("dialog", { name: "같은 날 다른 일정" })).toBeTruthy();
  fireEvent.click(longEvent);
  expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
  expect(detail.queryByRole("textbox")).toBeNull();
  expect(actions("execute_widget")).toEqual([]);
  fireEvent.click(detail.getByRole("button", { name: "약속 닫기" }));
  expect(body.scrollTop).toBe(180);
  await showTasks("today");
  showToday();
  expect(body.scrollTop).toBe(180);
});

it.each(["timed", "all-day", "UTC-boundary"] as const)(
  "opens a linked %s event on its own day after reopening the diary",
  async (kind) => {
    const startAt =
      kind === "UTC-boundary"
        ? Date.parse("2026-11-06T00:30:00Z")
        : new Date("2026-11-06T10:00:00").getTime();
    const eventDay = kind === "all-day" ? "2026-11-06" : localDay(new Date(startAt));
    const event = {
      id: "departure",
      connectionId: "local",
      title: "여행 출발",
      ...(kind === "all-day"
        ? { allDay: true, startDate: eventDay, endDate: "2026-11-09" }
        : { allDay: false, startAt, endAt: startAt + 3600000 }),
    };
    widgets.widgets = [
      widget("calendar", {
        connections: [],
        events: [
          event,
          {
            id: "same-day",
            connectionId: "local",
            title: "출발 당일 일정",
            allDay: true,
            startDate: eventDay,
            endDate: "2026-11-07",
          },
          {
            id: "today",
            connectionId: "local",
            title: "오늘만 있는 일정",
            allDay: true,
            startDate: DAY,
            endDate: NEXT_DAY,
          },
        ],
      }),
      widget("preparation", {
        envelopes: [
          {
            id: "travel",
            title: "여행 준비",
            eventId: event.id,
            date: DAY,
            checks: [],
            links: [],
            todoIds: [],
          },
        ],
      }),
    ];
    const stored = structuredClone({ widgets, diary });
    for (let reopen = 0; reopen < 2; reopen += 1) {
      await openDiary();
      fireEvent.click(screen.getByRole("link", { name: /^준비 봉투/ }));
      fireEvent.click(screen.getByRole("button", { name: /여행 준비/ }));
      fireEvent.click(opened().getByRole("button", { name: "일정 보기" }));
      const detail = within(screen.getByRole("dialog", { name: event.title }));
      expect(detail.getByRole("heading", { name: `${eventDay} 전체 일정` })).toBeTruthy();
      const agenda = within(detail.getByRole("region", { name: "선택 날짜 전체 일정" }));
      expect(agenda.getByRole("button", { name: /출발 당일 일정/ })).toBeTruthy();
      expect(agenda.queryByRole("button", { name: /오늘만 있는 일정/ })).toBeNull();
      fireEvent.click(detail.getByRole("button", { name: "약속 닫기" }));
      expect(opened().getByRole("heading", { name: "여행 준비" })).toBeTruthy();
      fireEvent.click(opened().getByRole("button", { name: "일정 보기" }));
      fireEvent.click(screen.getByRole("button", { name: "이날 펼치기" }));
      expect(screen.queryByRole("dialog", { name: event.title })).toBeNull();
      expect(opened().getAllByText(event.title).length).toBeGreaterThan(0);
      expect(opened().queryByText("오늘만 있는 일정")).toBeNull();
      expect(screen.getByRole("radio", { name: "하루" })).toHaveProperty("checked", true);
      cleanup();
    }
    expect(actions("execute_widget")).toEqual([]);
    expect(actions("update_diary")).toEqual([]);
    expect({ widgets, diary }).toEqual(stored);
  },
);

it("keeps the clicked date when opening a multi-day calendar event", async () => {
  widgets.widgets = [
    widget("calendar", {
      connections: [],
      events: [
        {
          id: "multi-day",
          connectionId: "local",
          title: "여러 날 여행",
          allDay: true,
          startDate: DAY,
          endDate: "2026-10-06",
        },
      ],
    }),
  ];
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  // The second week segment starts on October 5, not the event's October 3 start.
  fireEvent.click(screen.getAllByRole("button", { name: "여러 날 여행" })[1]);
  expect(screen.getByRole("heading", { name: "2026-10-05 전체 일정" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이날 펼치기" }));
  showJournal();
  fireEvent.click(opened().getByRole("button", { name: "일정 보기" }));
  expect(screen.getByRole("heading", { name: "2026-10-05 전체 일정" })).toBeTruthy();
  expect(actions("execute_widget")).toEqual([]);
  expect(actions("update_diary")).toEqual([]);
});

it.each(["close", "escape"])(
  "preserves month scroll when viewing a different day's event via %s",
  async (close) => {
    widgets.widgets = [
      widget("calendar", {
        connections: [],
        events: [
          {
            id: "month-end",
            connectionId: "local",
            title: "qa multi day",
            allDay: true,
            startDate: "2026-10-30",
            endDate: "2026-11-02",
          },
        ],
      }),
    ];
    await openDiary();
    const body = document.querySelector<HTMLDivElement>(`.${diaryStyles.body}`)!;
    fireEvent.click(screen.getByRole("radio", { name: "월" }));
    body.scrollTop = 380;
    fireEvent.scroll(body);
    fireEvent.click(screen.getAllByRole("button", { name: "qa multi day" })[0]);
    const dialog = screen.getByRole("dialog", { name: "qa multi day" });
    expect(body.scrollTop).toBe(380);
    if (close === "escape")
      fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    else fireEvent.click(within(dialog).getByRole("button", { name: "약속 닫기" }));
    expect(screen.queryByRole("dialog", { name: "qa multi day" })).toBeNull();
    expect(body.scrollTop).toBe(380);
    // A different month has its own position; returning restores the previous month.
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 120;
    fireEvent.scroll(body);
    fireEvent.click(screen.getByRole("button", { name: "이전 페이지" }));
    expect(body.scrollTop).toBe(380);
    // Other calendar views and tools retain their separate scopes.
    fireEvent.click(screen.getByRole("radio", { name: "주" }));
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 90;
    fireEvent.scroll(body);
    fireEvent.click(screen.getByRole("radio", { name: "하루" }));
    expect(body.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("radio", { name: "주" }));
    expect(body.scrollTop).toBe(90);
    fireEvent.click(screen.getByRole("radio", { name: "월" }));
    expect(body.scrollTop).toBe(380);
    fireEvent.click(screen.getByRole("link", { name: "정리 기록" }));
    expect(body.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("link", { name: "캘린더" }));
    expect(body.scrollTop).toBe(380);
    expect(actions("execute_widget")).toEqual([]);
    expect(actions("update_diary")).toEqual([]);
  },
);

it("undoes completion against the refreshed revision without touching diary records or starting a timer", async () => {
  setTasks([task("one", "되돌릴 일")]);
  execute = (request) => {
    const data = widgets.widgets[0].data as DataRecord;
    widgets.widgets[0] = {
      ...widgets.widgets[0],
      revision: widgets.widgets[0].revision + 1,
      data: {
        ...data,
        items: [
          {
            ...task("one", "되돌릴 일"),
            completedAt: request.action === "complete" ? Date.now() : null,
          },
        ],
      },
    };
    return null;
  };
  await openDiary();
  fireEvent.click(screen.getByRole("checkbox", { name: "되돌릴 일" }));
  const undo = await screen.findByRole("button", { name: "완료 취소" });
  fireEvent.click(undo);
  await waitFor(() => expect(actions("execute_widget")).toHaveLength(2));
  expect(actions("execute_widget").map(({ request }) => request)).toEqual([
    expect.objectContaining({
      action: "complete",
      instanceId: "todo",
      expectedRevision: 7,
      input: { id: "one" },
    }),
    expect.objectContaining({
      action: "undo",
      instanceId: "todo",
      expectedRevision: 8,
      input: { id: "one" },
    }),
  ]);
  expect(actions("update_diary")).toEqual([]);
});

it("searches both memo stores and restores a desktop sheet without mutating Diary notes", async () => {
  const desktopNote = {
    id: "desktop",
    title: "발표 준비",
    body: "  회의 메모\n그대로  ",
    isOpen: false,
  };
  widgets.widgets = [widget("memo", { notes: [desktopNote] })];
  diary.notes = [{ id: "persistent", title: "계획", body: "내일 할 일", pinned: true }];
  await openDiary();
  showNotes();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "open_memo_note" ? Promise.resolve(undefined) : fallback(name, args),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value: "발표" },
  });
  expect(
    within(screen.getByRole("region", { name: "계속 쓸 메모" })).queryByRole("button", {
      name: "계획 메모 열기",
    }),
  ).toBeNull();
  expect(screen.queryByRole("heading", { name: "계획" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "메모 제목" })).toHaveProperty("value", "발표 준비");
  fireEvent.click(screen.getByRole("button", { name: "바탕화면에 꺼내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_memo_note", { id: "memo", noteId: "desktop" }),
  );
  expect(actions("update_diary")).toEqual([]);
  expect(actions("execute_widget")).toEqual([]);
  expect(widgets.widgets[0].data).toEqual({
    notes: [desktopNote],
  });
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value: "내일" },
  });
  expect(screen.queryByRole("button", { name: "회의 메모 그대로" })).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "계속 쓸 메모" })).getByText("계획"),
  ).toBeTruthy();
});

it("locks desktop memo creation and restore together and exposes command failures", async () => {
  widgets.widgets = [widget("memo", { notes: [{ id: "one", body: "남길 메모", isOpen: true }] })];
  await openDiary();
  showNotes();
  const fallback = vi.mocked(command).getMockImplementation()!;
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementation((name, args) =>
    name === "create_memo_note"
      ? new Promise((resolve) => {
          finish = () => resolve(undefined);
        })
      : fallback(name, args),
  );
  fireEvent.click(screen.getByRole("button", { name: "+ 새 바탕화면 메모" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("create_memo_note", { id: "memo" }));
  expect(screen.getByRole("button", { name: "+ 새 바탕화면 메모" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "넣어두기" })).toHaveProperty("disabled", true);
  await act(async () => finish?.());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "넣어두기" })).toHaveProperty("disabled", false),
  );
  vi.mocked(command).mockImplementation((name, args) =>
    name === "request_close_memo_note"
      ? Promise.reject(new Error("메모 저장 실패"))
      : fallback(name, args),
  );
  fireEvent.click(screen.getByRole("button", { name: "넣어두기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("메모 저장 실패");
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", "남길 메모");
  expect(actions("close_memo_note")).toEqual([]);
});

it("shows the collapsed event history only on dated day pages", async () => {
  diary.pages = [{ id: "undated", title: "메모 모음", date: null, entries: [] }];
  await openDiary();
  expect(screen.getByText("함께한 기록").closest("details")).toHaveProperty("open", false);
  showPage("메모 모음");
  expect(screen.queryByText("함께한 기록")).toBeNull();
});

it.each(["pinned", "stored"] as const)(
  "protects the other note draft on close after cancelling the %s editor across search and date changes",
  async (cancelFirst) => {
    diary.notes = [
      { id: "pinned", title: "곁에 둔 생각", body: "계속 쓸 원문", pinned: true },
      { id: "stored", title: "넣어둔 생각", body: "보관한 원문", pinned: false },
    ];
    const titles = { pinned: "곁에 둔 생각", stored: "넣어둔 생각" };
    const drafts = { pinned: "  계속 쓰던\n초안  ", stored: "  보관 중인\n초안  " };
    const remaining = cancelFirst === "pinned" ? "stored" : "pinned";
    await openDiary();
    showNotes();
    const search = screen.getByRole("searchbox", { name: "메모 검색" });
    fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
      target: { value: drafts.pinned },
    });
    fireEvent.click(screen.getByRole("button", { name: "넣어둔 생각 메모 열기" }));
    fireEvent.change(
      within(screen.getByRole("article", { name: "넣어둔 생각 메모" })).getByRole("textbox", {
        name: "메모 내용",
      }),
      { target: { value: drafts.stored } },
    );
    fireEvent.click(screen.getByRole("button", { name: `${titles[cancelFirst]} 메모 열기` }));
    fireEvent.click(
      within(screen.getByRole("article", { name: `${titles[cancelFirst]} 메모` })).getByRole(
        "button",
        { name: "변경 취소" },
      ),
    );
    fireEvent.change(search, { target: { value: "일치하지 않는 검색" } });
    chooseDay(NEXT_DAY);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "10월 4일 일요일", level: 1 })).toBeTruthy();
    showNotes();

    const preventDefault = vi.fn();
    act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(native.destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: `${titles[remaining]} 메모 열기` }));
    const editor = within(screen.getByRole("article", { name: `${titles[remaining]} 메모` }));
    expect(editor.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
      "value",
      drafts[remaining],
    );
    expect(actions("update_diary")).toEqual([]);
    expect(actions("execute_widget")).toEqual([]);
    fireEvent.click(editor.getByRole("button", { name: "변경 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "다이어리 닫기" }));
    await waitFor(() => expect(native.destroy).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("keeps collection writing when navigation is cancelled and clears it only after confirmed discard", async () => {
  diary.pages = [{ id: "books", title: "읽은 책", date: null, entries: [] }];
  await openDiary();
  showPage("읽은 책");
  fireEvent.change(screen.getByLabelText("페이지에 기록할 내용"), {
    target: { value: "  이어 쓸 기록  " },
  });
  showToday();
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("value", "  이어 쓸 기록  ");
  expect(localStorage.getItem("comet:diary-collection-draft:books")).toContain("이어 쓸 기록");
  showToday();
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  await waitFor(() => expect(screen.queryByLabelText("페이지에 기록할 내용")).toBeNull());
  expect(localStorage.getItem("comet:diary-collection-draft:books")).toBeNull();
  showPage("읽은 책");
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("value", "");
  expect(actions("update_diary")).toEqual([]);
});

it("opens a collection record's original dated page through the normal guarded navigation", async () => {
  diary.pages = [
    {
      id: "books",
      title: "읽은 책",
      date: null,
      entries: [
        { id: "book", kind: "note", text: "책 감상", sourcePageId: "daily", sourceEntryId: "note" },
      ],
    },
    {
      id: "daily",
      title: "",
      date: NEXT_DAY,
      entries: [{ id: "note", kind: "note", text: "원본 한 줄 기록" }],
    },
  ];
  await openDiary();
  showPage("읽은 책");
  fireEvent.click(screen.getByRole("link", { name: "10월 4일 한 줄 기록에서" }));
  await waitFor(() => expect(screen.queryByLabelText("페이지에 기록할 내용")).toBeNull());
  expect(screen.getByRole("radio", { name: "한 줄 기록" })).toHaveProperty("checked", true);
  expect(opened().getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "원본 한 줄 기록",
  );
  expect(actions("update_diary")).toEqual([]);
});

it("discards the active weekly editor across week navigation and guards a fresh draft again", async () => {
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "주" }));
  const separateJournalDraft = JSON.stringify({
    body: "별도 한 줄 기록 초안",
    drafts: {},
    kind: "note",
    time: "",
    envelopeId: "",
    createdTask: null,
  });
  localStorage.setItem(`comet:diary-draft:day:${DAY}`, separateJournalDraft);
  fireEvent.click(screen.getByRole("button", { name: "시간 입력" }));
  fireEvent.change(screen.getByLabelText("시간 기록 제목"), { target: { value: "이전 주 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByLabelText("시간 기록 제목")).toHaveProperty("value", "이전 주 초안");
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  expect(screen.queryByLabelText("시간 기록 제목")).toBeNull();
  expect(localStorage.getItem(`comet:diary-draft:day:${DAY}`)).toBe(separateJournalDraft);
  fireEvent.click(screen.getByRole("button", { name: "시간 입력" }));
  const editor = within(screen.getByRole("dialog", { name: "시간 칠하기" }));
  expect(editor.getByText("2026-10-10")).toBeTruthy();
  expect(editor.getByLabelText("시간 기록 제목")).toHaveProperty("value", "");
  fireEvent.change(editor.getByLabelText("시간 기록 제목"), {
    target: { value: "이번 주 새 초안" },
  });
  fireEvent.click(screen.getByRole("link", { name: "오늘" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(editor.getByLabelText("시간 기록 제목")).toHaveProperty("value", "이번 주 새 초안");
  expect(actions("update_diary")).toEqual([]);
}, 15000);

it("clears only the discarded weekly editor when notes hide the calendar and retains separate planning and note drafts", async () => {
  setTasks([]);
  await openDiary();
  await showTasks("plans");
  fireEvent.change(screen.getByRole("textbox", { name: "새 할 일" }), {
    target: { value: "별도 기간 계획 초안" },
  });
  showNotes();
  fireEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
  fireEvent.change(screen.getByLabelText("새 메모 내용"), {
    target: { value: "  별도 메모\n초안  " },
  });
  showToday();
  fireEvent.click(screen.getByRole("radio", { name: "주" }));
  fireEvent.click(screen.getByRole("button", { name: "시간 입력" }));
  fireEvent.change(screen.getByLabelText("시간 기록 제목"), {
    target: { value: "버릴 시간 초안" },
  });
  showNotes();
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  expect(screen.queryByLabelText("시간 기록 제목")).toBeNull();
  expect(screen.getByLabelText("새 메모 내용")).toHaveProperty("value", "  별도 메모\n초안  ");
  await showTasks("plans");
  expect(screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty(
    "value",
    "별도 기간 계획 초안",
  );
  showNotes();
  expect(screen.getByLabelText("새 메모 내용")).toHaveProperty("value", "  별도 메모\n초안  ");
  expect(actions("update_diary")).toEqual([]);
}, 15000);

it("clears a discarded collection's in-memory writing when notes only hide its page", async () => {
  diary.pages = [{ id: "books", title: "읽은 책", date: null, entries: [] }];
  await openDiary();
  showPage("읽은 책");
  fireEvent.change(screen.getByLabelText("페이지에 기록할 내용"), {
    target: { value: "  버릴 기록 원문  " },
  });
  showNotes();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty(
    "value",
    "  버릴 기록 원문  ",
  );
  showNotes();
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 이동" }));
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("value", "");
  expect(localStorage.getItem("comet:diary-collection-draft:books")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "내 페이지" }));
  expect(screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeNull();
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("페이지에 기록할 내용"), { target: { value: "새 입력" } });
  fireEvent.click(screen.getByRole("button", { name: "다이어리 닫기" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  expect(native.destroy).not.toHaveBeenCalled();
});

it("accepts a drop immediately after opening a collection directly from the weekly calendar", async () => {
  widgets.widgets = [widget("memo", { notes: [{ id: "note-1", body: "원본 메모" }] })];
  diary.pages = [{ id: "books", title: "읽은 책", date: null, entries: [] }];
  update = () => ({ ...diary, revision: 4 });
  await openDiary();
  fireEvent.click(screen.getByRole("radio", { name: "주" }));
  fireEvent.click(screen.getByRole("link", { name: "내 페이지" }));
  expect(screen.getByLabelText("페이지에 기록할 내용")).toBeTruthy();
  dropItem(screen.getByLabelText("펼친 페이지"), {
    v: 1,
    kind: "memo",
    widgetId: "memo",
    itemId: "note-1",
  });
  await screen.findByText("이 페이지에 연결했어요.");
  expect(actions("update_diary")).toEqual([
    {
      expectedRevision: 3,
      action: "entry-add",
      input: {
        pageId: "books",
        kind: "widget",
        refId: "memo",
        itemId: "note-1",
        text: "원본 메모",
      },
    },
  ]);
  expect(actions("execute_widget")).toEqual([]);
}, 15000);

it("routes native habit and ledger navigation to the matching screen and preserves the native tab value", async () => {
  await openDiary();
  for (const [tab, label] of [
    ["habits", "습관 기록"],
    ["ledger", "가계부"],
  ] as const) {
    act(() => {
      for (const [event, callback] of vi.mocked(listen).mock.calls) {
        if (event === "planner-tab") callback({ event, id: 1, payload: tab });
      }
    });
    expect(await screen.findByRole("region", { name: label })).toBeTruthy();
    await waitFor(() => expect(actions("set_planner_tab").at(-1)).toEqual({ tab }));
  }
  expect(screen.queryByRole("region", { name: "습관 기록" })).toBeNull();
  expect(actions("update_diary")).toEqual([]);
});

it("keeps the travel ownership error inside the ledger editor after the real diary hook rejects a save", async () => {
  const failure = "여행에서 자동으로 기록한 내 몫이에요. 여행의 비용이나 예약에서 고쳐 주세요.";
  const entry = {
    id: "travel-ledger",
    date: DAY,
    kind: "expense" as const,
    amount: 101,
    category: "culture",
    title: "입장료",
    memo: "여행 · 제주 가족 여행",
  };
  diary.ledgerEntries = [entry];
  update = () => {
    throw new Error(failure);
  };
  await openDiary();
  fireEvent.click(screen.getByRole("link", { name: "가계부" }));
  const savedRow = screen.getByRole("button", { name: "입장료 편집" }).parentElement!;
  fireEvent.click(screen.getByRole("button", { name: "입장료 편집" }));
  const editor = within(screen.getByRole("dialog", { name: "수입·지출 편집" }));
  fireEvent.change(editor.getByLabelText("기록 금액 (원)"), { target: { value: "202" } });
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(editor.getByRole("alert").textContent).toBe(failure));
  expect(editor.getByLabelText("기록 금액 (원)")).toHaveProperty("value", "202");
  expect(editor.getByRole("button", { name: "저장" })).toHaveProperty("disabled", false);
  expect(within(savedRow).getByText("101원")).toBeTruthy();
  expect(within(savedRow).queryByText("202원")).toBeNull();
  expect(actions("update_diary")).toEqual([
    {
      expectedRevision: 3,
      action: "ledger-entry-update",
      input: { ...entry, amount: 202, expected: entry },
    },
  ]);
  fireEvent.click(editor.getByRole("button", { name: "취소" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
  const ledger = within(screen.getByRole("region", { name: "가계부" }));
  fireEvent.change(ledger.getByLabelText("금액 (원)"), { target: { value: "0" } });
  fireEvent.change(ledger.getByLabelText("어디에 썼나요?"), { target: { value: "새 기록" } });
  fireEvent.click(ledger.getByRole("button", { name: "추가" }));
  expect(ledger.getByRole("alert").textContent).toBe("원 단위 금액과 어디에 썼는지 입력해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "입장료 편집" }));
  const reopened = within(screen.getByRole("dialog", { name: "수입·지출 편집" }));
  expect(reopened.queryByRole("alert")).toBeNull();
  expect(reopened.getByLabelText("기록 금액 (원)")).toHaveProperty("value", "101");
});

it("unlocks a rejected envelope draft and creates a new request from the refreshed widget revision", async () => {
  const preparation = widget("preparation", { envelopes: [] });
  widgets.widgets = [preparation];
  execute = () => {
    preparation.revision = 8;
    throw new Error("PREPARATION_CREATE_REJECTED: 연결할 일정이 없어졌어요.");
  };
  await openDiary();
  fireEvent.click(screen.getByRole("link", { name: /^준비 봉투/ }));
  const sidebar = within(screen.getByRole("navigation", { name: "준비 봉투 목록" }));
  expect(sidebar.queryByRole("heading", { name: "준비 봉투" })).toBeNull();
  expect(sidebar.getByRole("heading", { name: "준비 중 · 0" })).toBeTruthy();
  expect(opened().getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "새 준비 봉투" })).toHaveLength(1);
  fireEvent.click(opened().getByRole("button", { name: "새 준비 봉투" }));
  const form = within(screen.getByRole("dialog", { name: "새 준비 봉투" }));
  fireEvent.change(form.getByRole("textbox", { name: "봉투 이름" }), {
    target: { value: "이어 쓸 준비" },
  });
  fireEvent.click(form.getByRole("button", { name: "만들기" }));
  await waitFor(() =>
    expect(form.getByRole("textbox", { name: "봉투 이름" })).toHaveProperty("disabled", false),
  );
  expect(form.getByRole("textbox", { name: "봉투 이름" })).toHaveProperty("value", "이어 쓸 준비");
  fireEvent.change(form.getByRole("textbox", { name: "봉투 이름" }), {
    target: { value: "고친 준비" },
  });
  execute = (request) => {
    preparation.data = {
      envelopes: [{ id: "created-envelope", ...(request.input as DataRecord) }],
    };
    return "created-envelope";
  };
  fireEvent.click(form.getByRole("button", { name: "만들기" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "새 준비 봉투" })).toBeNull());
  const requests = actions("execute_widget").map(({ request }) => request as DataRecord);
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ expectedRevision: 7, input: { title: "이어 쓸 준비" } });
  expect(requests[1]).toMatchObject({ expectedRevision: 8, input: { title: "고친 준비" } });
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  expect(await opened().findByRole("heading", { name: "고친 준비" })).toBeTruthy();
});

it("retries an uncertain envelope create with the same request after its linked event disappears", async () => {
  const preparation = widget("preparation", { envelopes: [] });
  const calendar = widget("calendar", {
    events: [
      { id: "event", title: "함께 갈 일정", connectionId: "local", startDate: DAY, allDay: true },
    ],
  });
  widgets.widgets = [preparation, calendar];
  execute = () => {
    preparation.revision = 8;
    calendar.data = { events: [] };
    throw new Error("저장 응답을 받지 못했어요.");
  };
  await openDiary();
  fireEvent.click(screen.getByRole("link", { name: /^준비 봉투/ }));
  fireEvent.click(opened().getByRole("button", { name: "새 준비 봉투" }));
  const form = within(screen.getByRole("dialog", { name: "새 준비 봉투" }));
  fireEvent.change(form.getByRole("textbox", { name: "봉투 이름" }), {
    target: { value: "같은 요청의 준비" },
  });
  fireEvent.click(form.getByRole("radio", { name: "일정에 연결" }));
  fireEvent.change(form.getByRole("combobox", { name: "일정" }), { target: { value: "event" } });
  fireEvent.click(form.getByRole("button", { name: "만들기" }));
  const retry = await form.findByRole("button", { name: "같은 요청으로 다시 시도" });
  await waitFor(() => expect(retry).toHaveProperty("disabled", false));
  expect(form.getByRole("textbox", { name: "봉투 이름" })).toHaveProperty("disabled", true);
  await waitFor(() => expect(form.queryByRole("option", { name: /함께 갈 일정/ })).toBeNull());
  execute = (request) => {
    preparation.data = {
      envelopes: [{ id: "restored-envelope", ...(request.input as DataRecord) }],
    };
    return "restored-envelope";
  };
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "새 준비 봉투" })).toBeNull());
  const requests = actions("execute_widget").map(({ request }) => request);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[1]).toMatchObject({
    expectedRevision: 7,
    input: { eventId: "event", title: "같은 요청의 준비" },
  });
  expect(await opened().findByRole("heading", { name: "같은 요청의 준비" })).toBeTruthy();
});

it("ignores guarded navigation while a quick task save is pending", async () => {
  setTasks([]);
  let finish: (id: string) => void = () => undefined;
  execute = () => new Promise<string>((resolve) => (finish = resolve)) as unknown as string;
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "빠른 할 일 추가" }));
  fireEvent.change(screen.getByLabelText(/빠른 할 일 제목/), { target: { value: "저장 중" } });
  fireEvent.click(screen.getByRole("button", { name: "할 일 저장" }));
  await waitFor(() => expect(actions("execute_widget")).toHaveLength(1));
  fireEvent.click(screen.getByRole("link", { name: "캘린더" }));
  fireEvent.click(screen.getByRole("radio", { name: "월" }));
  expect(screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeNull();
  expect(screen.getByRole("radio", { name: "하루" })).toHaveProperty("checked", true);
  await act(async () => finish("pending-task"));
  await waitFor(() => expect(screen.queryByRole("form", { name: "빠른 할 일" })).toBeNull());
  expect(screen.getByRole("radio", { name: "하루" })).toHaveProperty("checked", true);
});

it("lets a clean native close proceed without asking", async () => {
  await openDiary();
  const preventDefault = vi.fn();
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault }));
  expect(preventDefault).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeNull();
});

it("releases native listeners that resolve after the diary unmounts", async () => {
  const pending: ((cleanup: () => void) => void)[] = [];
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  const deferred = (): Promise<() => void> =>
    new Promise((resolve) => {
      pending.push(resolve);
    });
  vi.mocked(listen).mockImplementation(async (name) =>
    ["planner-note", "planner-view-target", "planner-tab"].includes(name)
      ? deferred()
      : () => undefined,
  );
  native.onCloseRequested.mockImplementation(deferred);
  const view = render(<Diary />);
  await screen.findByRole("navigation", { name: "내 다이어리 목차" });
  await waitFor(() => expect(pending).toHaveLength(4));
  view.unmount();
  await act(async () => {
    for (const resolve of pending) {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      resolve(cleanup);
    }
  });
  for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
  expect(command).not.toHaveBeenCalledWith("get_planner_note_target");
});
