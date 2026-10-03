import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { Diary } from "../Planner/Diary";
import type { DiaryState } from "../Planner/diaryTypes";
import type { DataRecord } from "../toolData";
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
  fireEvent.click(opened().getByRole("button", { name: "추가" }));
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
      if (name === "update_diary") return update(String(args?.action), args?.input as DataRecord);
      if (name === "execute_widget") return execute(args?.request as DataRecord);
      throw new Error(`Unexpected command: ${name}`);
    });
  native.onCloseRequested.mockReset().mockResolvedValue(() => undefined);
  vi.mocked(listen).mockClear();
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.startDragging.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
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
  fireEvent.click(screen.getByRole("button", { name: "새 페이지" }));
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
  fireEvent.click(screen.getByRole("button", { name: `${NEXT_DAY} 기록 열기` }));
  expect(opened().getByRole("checkbox", { name: "내일 준비" })).toBeTruthy();
  expect(opened().queryByRole("checkbox", { name: "오늘 준비" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "읽은 책" }));
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
  fireEvent.click(screen.getByRole("button", { name: "모아둔 생각" }));
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
  fireEvent.click(screen.getByRole("button", { name: "월간" }));
  expect(opened().getByRole("button", { name: /주말 준비/ })).toBeTruthy();
  expect(opened().queryByRole("button", { name: /보관한 준비/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "주간" }));
  fireEvent.click(opened().getByRole("button", { name: /주말 준비/ }));
  expect(opened().getByRole("heading", { name: "주말 준비" })).toBeTruthy();
  expect(opened().getByText("10월 3일 토요일")).toBeTruthy();
  expect(actions("execute_widget")).toEqual([]);
});

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

  fireEvent.click(screen.getByRole("button", { name: "기간 계획" }));
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
  fireEvent.click(screen.getByRole("button", { name: "기간 계획" }));
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
  fireEvent.click(screen.getByRole("button", { name: "기간 계획" }));
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty(
    "value",
    "아직 제출하지 않은 계획",
  );
  expect(vi.mocked(listen).mock.calls.filter(([name]) => name === "planner-tab")).toHaveLength(1);
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
});

it("retains template choices across journal navigation and confirms unsaved template changes on close", async () => {
  setTasks([]);
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "템플릿" }));
  await screen.findByRole("navigation", { name: "템플릿 종류" });
  fireEvent.click(screen.getByRole("button", { name: "건강 관리" }));
  const choice = screen.getAllByRole("checkbox")[0];
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button", { name: "하루" }));
  expect(opened().getByRole("heading", { name: "10월 3일 토요일" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다이어리 닫기" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 내용이 있어요" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  fireEvent.click(screen.getByRole("button", { name: "템플릿" }));
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
  fireEvent.click(screen.getByRole("button", { name: "+ 일정" }));
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
  fireEvent.click(screen.getByRole("button", { name: "템플릿" }));
  await screen.findByRole("navigation", { name: "템플릿 종류" });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "기간 계획" }));
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
  fireEvent.click(screen.getByRole("button", { name: "기간 계획" }));
  expect(screen.getByRole("textbox", { name: "새 할 일" })).toHaveProperty("value", "보존할 계획");
  fireEvent.click(screen.getByRole("button", { name: "템플릿" }));
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
  fireEvent.click(screen.getByRole("button", { name: "월간" }));
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
    fireEvent.click(screen.getByRole("button", { name: "월간" }));
    fireEvent.click(screen.getByRole("button", { name: "산책" }));
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
  fireEvent.click(screen.getByRole("button", { name: "월간" }));
  fireEvent.click(screen.getByRole("button", { name: "산책" }));
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
  fireEvent.click(screen.getByRole("button", { name: "월간" }));
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

it("adds an original memo reference from the shelf to an undated page", async () => {
  widgets.widgets = [widget("memo", { notes: [{ id: "note-1", body: "원본 메모" }] })];
  diary.pages = [{ id: "collection", title: "생각 모음", date: null, entries: [] }];
  update = () => ({ ...diary, revision: 4 });
  await openDiary();
  fireEvent.click(screen.getByRole("button", { name: "생각 모음" }));
  fireEvent.click(screen.getByText("위젯"));
  fireEvent.click(screen.getByText("내용 1개"));
  fireEvent.click(screen.getByRole("button", { name: "원본 메모 연결" }));
  await screen.findByText("이 페이지에 연결했어요.");
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
