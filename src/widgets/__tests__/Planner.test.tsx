import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { command } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { Planner } from "../Planner/Planner";
import { PlannerTemplates } from "../Planner/PlannerTemplates";
import { PlannerCalendar } from "../Planner/PlannerCalendar";
import { TodoEditor } from "../Planner/TodoEditor";
import { eventsOn, frequencyRecords, inPeriod, plannedDay } from "../Planner/plannerData";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
const native = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
  startDragging: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => native,
}));

const TODAY = "2026-09-21";
const LISTS = [{ id: "default", name: "내 할 일" }];
const reload = vi.fn();

function widget(kind: string, data: DataRecord): WidgetView {
  return {
    id: `${kind}-id`,
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
function item(id: string, title: string, extra: DataRecord = {}): DataRecord {
  return {
    id,
    title,
    listId: "default",
    memo: "",
    dueDate: null,
    dueAt: null,
    plannedDate: TODAY,
    planPeriod: "none",
    planAnchor: null,
    completedAt: null,
    repeat: "none",
    repeatRule: null,
    ...extra,
  };
}
function snapshot(items: DataRecord[], extra: WidgetView[] = []): WidgetSnapshot {
  return {
    catalog: [],
    onboardingDone: true,
    widgets: [widget("todo", { lists: LISTS, items }), ...extra],
  };
}
function useSnapshot(value: WidgetSnapshot): void {
  vi.mocked(useWidgets).mockReturnValue({ snapshot: value, error: null, reload });
}
async function renderPlanner(value: WidgetSnapshot): Promise<ReturnType<typeof render>> {
  useSnapshot(value);
  const view = render(<Planner />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_tab"));
  return view;
}
function expectAction(action: string, input: DataRecord): void {
  expect(command).toHaveBeenCalledWith("execute_widget", {
    request: {
      requestId: expect.any(String),
      instanceId: "todo-id",
      expectedRevision: 7,
      action,
      input,
    },
  });
}

it("destroys a clean planner window from the header close button", async () => {
  await renderPlanner(snapshot([]));
  fireEvent.click(screen.getByRole("button", { name: "플래너 닫기" }));
  await waitFor(() => expect(native.destroy).toHaveBeenCalledTimes(1));
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue("today");
  native.onCloseRequested.mockReset().mockResolvedValue(() => undefined);
  native.close.mockReset().mockResolvedValue(undefined);
  native.destroy.mockReset().mockResolvedValue(undefined);
  native.startDragging.mockReset().mockResolvedValue(undefined);
  reload.mockReset();
  window.history.replaceState(null, "", "/?view=planner");
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("creates a local Today task without a connected account or an invented due date", async () => {
  await renderPlanner(snapshot([]));
  expect(screen.getByText("할 일은 계정 없이 사용할 수 있어요.")).toBeTruthy();
  const today = within(screen.getByRole("region", { name: "오늘 할 일" }));
  fireEvent.change(today.getByLabelText("새 할 일"), { target: { value: "우산 챙기기" } });
  fireEvent.click(today.getByRole("button", { name: "추가" }));
  await waitFor(() =>
    expectAction("add", {
      title: "우산 챙기기",
      listId: "default",
      plannedDate: TODAY,
      planPeriod: "none",
      planAnchor: null,
    }),
  );
  expect(command).not.toHaveBeenCalledWith("connect_calendar_google", expect.anything());
  expect(command).not.toHaveBeenCalledWith("list_apple_calendars", expect.anything());
});

it("puts a period task into Today by changing only its planned date", async () => {
  const work = item("review", "월말 자료 살피기", {
    plannedDate: null,
    dueDate: "2026-09-30",
    planPeriod: "week",
    planAnchor: TODAY,
    repeatRule: {
      mode: "calendar",
      unit: "month",
      interval: 1,
      monthlyMode: "last-day",
      timeZone: "local",
    },
  });
  const before = structuredClone(work);
  await renderPlanner(snapshot([work]));
  fireEvent.click(screen.getByRole("tab", { name: "기간 계획" }));
  fireEvent.click(screen.getByRole("button", { name: "오늘에 넣기" }));
  await waitFor(() => expectAction("plan", { ids: ["review"], date: TODAY }));
  expect(work).toEqual(before);
});

it("adds a period task to the actual Today after previously viewing another date", async () => {
  await renderPlanner(
    snapshot([
      item("period-work", "이번 주 검토", {
        plannedDate: null,
        dueDate: "2026-09-30",
        planPeriod: "week",
        planAnchor: TODAY,
      }),
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "이전 날짜" }));
  fireEvent.click(screen.getByRole("tab", { name: "기간 계획" }));
  fireEvent.click(screen.getByRole("button", { name: "오늘에 넣기" }));
  await waitFor(() => expectAction("plan", { ids: ["period-work"], date: TODAY }));
});

it("moves only checked unfinished tasks at day end without changing their deadlines", async () => {
  await renderPlanner(
    snapshot([
      item("one", "서류 챙기기", { dueDate: "2026-09-30" }),
      item("two", "산책하기"),
      item("done", "책 반납하기", { completedAt: Date.now() }),
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "하루 마무리" }));
  const wrap = within(screen.getByRole("dialog", { name: "오늘은 여기까지" }));
  expect(wrap.queryByRole("checkbox", { name: "책 반납하기" })).toBeNull();
  fireEvent.click(wrap.getByRole("checkbox", { name: "서류 챙기기" }));
  fireEvent.change(wrap.getByLabelText("옮길 날짜"), { target: { value: "2026-09-23" } });
  fireEvent.click(wrap.getByRole("button", { name: "선택한 1개 옮기기" }));
  await waitFor(() => expectAction("plan", { ids: ["one"], date: "2026-09-23" }));
});

it("records and undoes a weekly frequency entry without marking the whole goal complete", async () => {
  const goal = item("walk", "20분 산책", {
    planPeriod: "week",
    planAnchor: TODAY,
    repeatRule: {
      mode: "frequency",
      unit: "week",
      interval: 1,
      timesPerWeek: 3,
      timeZone: "local",
    },
    frequencyRecords: [],
  });
  const view = await renderPlanner(snapshot([goal]));
  fireEvent.click(
    within(screen.getByRole("region", { name: "오늘 할 일" })).getByRole("checkbox", {
      name: /20분 산책/,
    }),
  );
  await waitFor(() => expectAction("record-frequency", { id: "walk", date: TODAY }));
  await waitFor(() => expect(screen.queryByText("저장하고 있어요…")).toBeNull());
  useSnapshot(
    snapshot([
      { ...goal, frequencyRecords: [{ id: "record-one", date: TODAY, createdAt: Date.now() }] },
    ]),
  );
  view.rerender(<Planner />);
  fireEvent.click(
    within(screen.getByRole("region", { name: "오늘 할 일" })).getByRole("checkbox", {
      name: /20분 산책/,
    }),
  );
  await waitFor(() => expectAction("undo-frequency", { id: "walk", recordId: "record-one" }));
  expect(command).not.toHaveBeenCalledWith(
    "execute_widget",
    expect.objectContaining({ request: expect.objectContaining({ action: "complete" }) }),
  );
});

it("counts today's frequency record as done today and excludes it from day-end carryover", async () => {
  await renderPlanner(
    snapshot([
      item("walk", "오늘 산책 목표", {
        repeatRule: {
          mode: "frequency",
          unit: "week",
          interval: 1,
          timesPerWeek: 3,
          timeZone: "local",
        },
        frequencyRecords: [{ id: "walk-record", date: TODAY, createdAt: Date.now() }],
        completedAt: null,
      }),
    ]),
  );
  expect(screen.getByText("할 일 1개 · 완료 1개")).toBeTruthy();
  const checkbox = within(screen.getByRole("region", { name: "오늘 할 일" })).getByRole(
    "checkbox",
    { name: /오늘 산책 목표/ },
  );
  expect(checkbox).toHaveProperty("checked", true);
  const row = checkbox.closest("article");
  if (!row) throw new Error("주간 목표 행이 없습니다.");
  fireEvent.click(row);
  expect(screen.getByRole("button", { name: "오늘에서 빼기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "하루 마무리" }));
  const wrap = within(screen.getByRole("dialog", { name: "오늘은 여기까지" }));
  expect(wrap.queryByRole("checkbox", { name: /오늘 산책 목표/ })).toBeNull();
  expect(wrap.getByText(/오늘 1개를 마쳤어요/)).toBeTruthy();
  expect(wrap.getByRole("button", { name: "선택한 0개 옮기기" })).toHaveProperty("disabled", true);
});

it("records frequency on the displayed past date and disables future completion", async () => {
  const rule = { mode: "frequency", unit: "week", interval: 1, timesPerWeek: 3, timeZone: "local" };
  await renderPlanner(
    snapshot([
      item("past", "어제 산책", {
        plannedDate: "2026-09-20",
        repeatRule: rule,
        frequencyRecords: [],
      }),
      item("future", "내일 산책", {
        plannedDate: "2026-09-22",
        repeatRule: rule,
        frequencyRecords: [],
      }),
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "이전 날짜" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "오늘 할 일" })).getByRole("checkbox", {
      name: /어제 산책/,
    }),
  );
  await waitFor(() => expectAction("record-frequency", { id: "past", date: "2026-09-20" }));
  await waitFor(() => expect(screen.queryByText("저장하고 있어요…")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "다음 날짜" }));
  fireEvent.click(screen.getByRole("button", { name: "다음 날짜" }));
  expect(
    within(screen.getByRole("region", { name: "오늘 할 일" })).getByRole("checkbox", {
      name: /내일 산책/,
    }),
  ).toHaveProperty("disabled", true);
});

it("keeps an edited task draft after a rejected save and lets the same draft be retried", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onClose = vi.fn();
  render(
    <TodoEditor
      item={item("draft", "원래 제목", { dueDate: "2026-09-25" })}
      lists={LISTS}
      busy={false}
      act={act}
      onClose={onClose}
    />,
  );
  const editor = within(screen.getByRole("dialog", { name: "할 일 편집" }));
  fireEvent.change(editor.getByLabelText("할 일 제목"), { target: { value: "고친 제목" } });
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
  expect(onClose).not.toHaveBeenCalled();
  expect(editor.getByLabelText("할 일 제목")).toHaveProperty("value", "고친 제목");
  expect(editor.getByRole("alert").textContent).toContain("저장하지 못했어요");
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(act.mock.calls[1]).toEqual(act.mock.calls[0]);
});

it("renders no native date or time input until explicitly added and clears both when removing the due date", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(false);
  render(
    <TodoEditor
      item={item("undated", "날짜 없는 일")}
      lists={LISTS}
      busy={false}
      act={act}
      onClose={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "할 일 편집" });
  const editor = within(dialog);
  expect(dialog.querySelector('input[type="date"]')).toBeNull();
  expect(dialog.querySelector('input[type="time"]')).toBeNull();
  expect(editor.getByRole("button", { name: "날짜 지정" })).toBeTruthy();
  expect(editor.getByRole("button", { name: "시각 추가" })).toBeTruthy();
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith(
      "update",
      expect.objectContaining({ id: "undated", dueDate: null, dueAt: null }),
    ),
  );
  fireEvent.click(editor.getByRole("button", { name: "시각 추가" }));
  expect(editor.getByLabelText("기한 · 첫 날짜")).toHaveProperty("value", TODAY);
  expect(editor.getByLabelText("시각 (선택)")).toHaveProperty("value", "09:00");
  fireEvent.click(editor.getByRole("button", { name: "시각 지우기" }));
  expect(editor.getByLabelText("기한 · 첫 날짜")).toHaveProperty("value", TODAY);
  expect(dialog.querySelector('input[type="time"]')).toBeNull();
  fireEvent.click(editor.getByRole("button", { name: "시각 추가" }));
  fireEvent.click(editor.getByRole("button", { name: "기한 지우기" }));
  expect(dialog.querySelector('input[type="date"]')).toBeNull();
  expect(dialog.querySelector('input[type="time"]')).toBeNull();
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(act).toHaveBeenCalledTimes(2));
  expect(act.mock.calls[1][1]).toEqual(expect.objectContaining({ dueDate: null, dueAt: null }));
  fireEvent.click(editor.getByRole("button", { name: "날짜 지정" }));
  expect(editor.getByLabelText("기한 · 첫 날짜")).toHaveProperty("value", TODAY);
  expect(dialog.querySelector('input[type="time"]')).toBeNull();
});

it("retries a preserved draft using the latest widget revision after an unrelated update", async () => {
  const original = item("draft", "수정할 일");
  const view = await renderPlanner(snapshot([original]));
  fireEvent.click(screen.getByRole("button", { name: "수정할 일 편집" }));
  const editor = within(screen.getByRole("dialog", { name: "할 일 편집" }));
  fireEvent.change(editor.getByLabelText("할 일 제목"), { target: { value: "내가 고친 제목" } });
  vi.mocked(command).mockRejectedValueOnce("다른 화면에서 목록이 바뀌었습니다.");
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  const updated = snapshot([original, item("other", "다른 화면의 새 할 일")]);
  updated.widgets[0].revision = 8;
  useSnapshot(updated);
  view.rerender(<Planner />);
  expect(editor.getByLabelText("할 일 제목")).toHaveProperty("value", "내가 고친 제목");
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: expect.objectContaining({
        expectedRevision: 8,
        action: "update",
        input: expect.objectContaining({ id: "draft", title: "내가 고친 제목" }),
      }),
    }),
  );
});

it("does not overwrite an externally changed task and reloads it only on request", async () => {
  const original = item("conflict", "원래 할 일");
  const view = await renderPlanner(snapshot([original]));
  fireEvent.click(screen.getByRole("button", { name: "원래 할 일 편집" }));
  const editor = within(screen.getByRole("dialog", { name: "할 일 편집" }));
  fireEvent.change(editor.getByLabelText("할 일 제목"), { target: { value: "내 초안" } });
  const newer = snapshot([{ ...original, title: "다른 화면에서 수정한 제목" }]);
  newer.widgets[0].revision = 8;
  useSnapshot(newer);
  view.rerender(<Planner />);
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(editor.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(editor.getByLabelText("할 일 제목")).toHaveProperty("value", "내 초안");
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
  fireEvent.click(editor.getByRole("button", { name: "최신 내용 다시 불러오기" }));
  expect(screen.getByLabelText("할 일 제목")).toHaveProperty("value", "다른 화면에서 수정한 제목");
});

it("clears task actions when the selected task is outside the displayed date", async () => {
  await renderPlanner(snapshot([item("chosen", "현재 날짜 할 일")]));
  const row = screen.getByRole("checkbox", { name: "현재 날짜 할 일" }).closest("article");
  if (!row) throw new Error("오늘 할 일 행이 없습니다.");
  fireEvent.click(row);
  expect(screen.getByRole("button", { name: "오늘에서 빼기" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "다음 날짜" }));
  expect(screen.getByRole("button", { name: /에서 빼기/ })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "25분 집중" })).toHaveProperty("disabled", true);
});

it("keeps overnight event segments inside the visible weekly time range", () => {
  render(
    <PlannerCalendar
      day={TODAY}
      setDay={vi.fn()}
      events={[
        {
          id: "night",
          connectionId: "c",
          title: "밤 이동",
          startAt: new Date(`${TODAY}T23:00:00`).getTime(),
          endAt: new Date("2026-09-22T01:00:00").getTime(),
        },
      ]}
      selected=""
      onSelect={vi.fn()}
      connections={[{ id: "c", provider: "google" }]}
      side={null}
    />,
  );
  expect(screen.getByText("00", { exact: true })).toBeTruthy();
  expect(screen.getByText("23", { exact: true })).toBeTruthy();
  const segments = screen.getAllByRole("button", { name: "23:00–01:00 밤 이동" });
  expect(segments).toHaveLength(2);
  for (const segment of segments) {
    const top = Number.parseFloat(segment.style.top);
    const height = Number.parseFloat(segment.style.height);
    const columnHeight = Number.parseFloat(segment.parentElement?.style.height ?? "0");
    expect(top).toBeGreaterThanOrEqual(0);
    expect(height).toBeGreaterThan(0);
    expect(top + height).toBeLessThanOrEqual(columnHeight);
  }
});

it("submits selected template rows as one batch and preserves the choices when it fails", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PlannerTemplates act={act} busy={false} />);
  const categories = within(screen.getByRole("navigation", { name: "템플릿 종류" }));
  expect(categories.getAllByRole("button")).toHaveLength(6);
  fireEvent.click(categories.getByRole("button", { name: "건강 관리" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "가볍게 스트레칭하기" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "잠들기 전 화면 내려놓기" }));
  fireEvent.change(screen.getByLabelText("건강검진 날짜 알아보기 첫 날짜"), {
    target: { value: "2026-09-24" },
  });
  fireEvent.click(screen.getByRole("button", { name: "선택한 2개 추가" }));
  await waitFor(() => expect(act).toHaveBeenCalledTimes(1));
  expect(act).toHaveBeenCalledWith("batch-add", {
    listName: "건강 관리",
    items: [
      expect.objectContaining({
        title: "20분 산책하기",
        dueDate: TODAY,
        plannedDate: null,
        repeatRule: expect.objectContaining({ mode: "frequency", timesPerWeek: 3 }),
      }),
      expect.objectContaining({
        title: "건강검진 날짜 알아보기",
        dueDate: "2026-09-24",
        plannedDate: null,
        repeatRule: null,
      }),
    ],
  });
  expect(screen.getByLabelText("건강검진 날짜 알아보기 첫 날짜")).toHaveProperty(
    "value",
    "2026-09-24",
  );
  fireEvent.click(screen.getByRole("button", { name: "선택한 2개 추가" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "추가했어요" })).toHaveProperty("disabled", true),
  );
  expect(act.mock.calls[1]).toEqual(act.mock.calls[0]);
});

it("keeps cached external events readable without exposing task completion or calendar writes", async () => {
  const event = {
    id: "event-one",
    connectionId: "google-one",
    title: "캐시된 독서 모임",
    startAt: new Date(`${TODAY}T14:00:00`).getTime(),
    endAt: new Date(`${TODAY}T15:00:00`).getTime(),
    allDay: false,
    cancelled: false,
    url: "https://calendar.google.com/event",
  };
  await renderPlanner(
    snapshot(
      [],
      [
        widget("calendar", {
          connections: [
            {
              id: "google-one",
              name: "개인",
              provider: "google",
              status: "offline",
              lastSuccessAt: Date.now() - 3600000,
            },
          ],
          events: [event],
        }),
      ],
    ),
  );
  expect(screen.getByText("캐시된 독서 모임")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /캐시된 독서 모임/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "원본 일정 ↗" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_widget_link", {
      id: "calendar-id",
      url: "https://calendar.google.com/event",
    }),
  );
  expect(command).not.toHaveBeenCalledWith("execute_widget", expect.anything());
});

it("keeps a task visible and editable after scheduling it and orders local due times independently of Today selection", async () => {
  const toSchedule = item("schedule", "시간 정할 일");
  const morning = item("morning", "오전 기한", {
    plannedDate: null,
    dueAt: new Date(`${TODAY}T09:00:00`).getTime(),
  });
  const evening = item("evening", "오후 기한", {
    plannedDate: null,
    dueAt: new Date(`${TODAY}T17:00:00`).getTime(),
  });
  const completed = item("completed", "끝낸 일", {
    dueAt: new Date(`${TODAY}T10:00:00`).getTime(),
    completedAt: Date.now(),
  });
  const tomorrow = item("tomorrow", "다음 날 기한", {
    plannedDate: null,
    dueAt: new Date("2026-09-22T11:00:00").getTime(),
  });
  const view = await renderPlanner(snapshot([evening, toSchedule, morning, completed, tomorrow]));
  fireEvent.click(screen.getByRole("tab", { name: "캘린더" }));
  const calendar = within(screen.getByRole("tabpanel", { name: "캘린더" }));
  fireEvent.click(calendar.getByRole("button", { name: "시간 정할 일 시간 잡기" }));
  const editor = within(screen.getByRole("dialog", { name: "할 일 편집" }));
  fireEvent.click(editor.getByRole("button", { name: "날짜 지정" }));
  fireEvent.change(editor.getByLabelText("기한 · 첫 날짜"), { target: { value: TODAY } });
  fireEvent.click(editor.getByRole("button", { name: "시각 추가" }));
  fireEvent.change(editor.getByLabelText("시각 (선택)"), { target: { value: "13:30" } });
  fireEvent.click(editor.getByRole("button", { name: "저장" }));
  const dueAt = new Date(`${TODAY}T13:30:00`).getTime();
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("execute_widget", {
      request: expect.objectContaining({
        instanceId: "todo-id",
        action: "update",
        input: expect.objectContaining({ id: "schedule", dueAt, dueDate: null }),
      }),
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "할 일 편집" })).toBeNull());
  useSnapshot(snapshot([evening, { ...toSchedule, dueAt }, morning, completed, tomorrow]));
  view.rerender(<Planner />);
  expect(calendar.getByRole("heading", { name: "시간을 정한 할 일" })).toBeTruthy();
  expect(calendar.getAllByRole("checkbox")).toEqual([
    calendar.getByRole("checkbox", { name: "오전 기한" }),
    calendar.getByRole("checkbox", { name: "시간 정할 일" }),
    calendar.getByRole("checkbox", { name: "오후 기한" }),
  ]);
  expect(calendar.queryByRole("button", { name: "시간 정할 일 시간 잡기" })).toBeNull();
  expect(calendar.queryByRole("checkbox", { name: "끝낸 일" })).toBeNull();
  expect(calendar.queryByRole("checkbox", { name: "다음 날 기한" })).toBeNull();
  fireEvent.click(calendar.getByRole("button", { name: "시간 정할 일 시간 수정" }));
  expect(screen.getByLabelText("시각 (선택)")).toHaveProperty("value", "13:30");
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "할 일 편집" })).getByRole("button", {
      name: "취소",
    }),
  );
  fireEvent.click(calendar.getByRole("checkbox", { name: "시간 정할 일" }));
  await waitFor(() => expectAction("complete", { id: "schedule" }));
});

it("locks template selection while a batch is saving so completion belongs to the submitted category", async () => {
  let finish: (value: boolean) => void = () => undefined;
  const pending = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const act = vi.fn<ToolAction>().mockReturnValue(pending);
  const view = render(<PlannerTemplates act={act} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "선택한 4개 추가" }));
  view.rerender(<PlannerTemplates act={act} busy />);
  const health = screen.getByRole("button", { name: "건강 관리" });
  expect(health.matches(":disabled")).toBe(true);
  expect(screen.getByRole("checkbox", { name: "빨래하기" }).matches(":disabled")).toBe(true);
  await userEvent.click(health);
  expect(screen.getByRole("heading", { name: "집안일" })).toBeTruthy();
  finish(true);
  await waitFor(() => expect(screen.getByRole("button", { name: "추가했어요" })).toBeTruthy());
  expect(act).toHaveBeenCalledTimes(1);
});

it("preserves an explicit removal from Today while retaining its period and due date", () => {
  const task = item("removed", "이번 주에 할 일", {
    dueDate: TODAY,
    plannedDate: null,
    planPeriod: "week",
    planAnchor: TODAY,
  });
  expect(plannedDay(task)).toBe("");
  expect(inPeriod(task, "week", TODAY)).toBe(true);
  expect(inPeriod(task, "inbox", TODAY)).toBe(false);
  const legacy = { id: "legacy", title: "이전 형식", dueDate: TODAY };
  expect(plannedDay(legacy)).toBe(TODAY);
});

it("uses exclusive all-day end dates and splits overnight event coverage across dates", () => {
  const allDay = { id: "all-day", allDay: true, startDate: TODAY, endDate: "2026-09-22" };
  const overnight = {
    id: "night",
    startAt: new Date(`${TODAY}T23:00:00`).getTime(),
    endAt: new Date("2026-09-22T01:00:00").getTime(),
  };
  expect(eventsOn([allDay, overnight], TODAY).map((event) => event.id)).toEqual([
    "all-day",
    "night",
  ]);
  expect(eventsOn([allDay, overnight], "2026-09-22").map((event) => event.id)).toEqual(["night"]);
});

it("resets the displayed weekly count while retaining historical frequency records", () => {
  const goal = item("walk", "산책", {
    planPeriod: "week",
    planAnchor: TODAY,
    repeatRule: { mode: "frequency" },
    frequencyRecords: [
      { id: "old", date: "2026-09-20" },
      { id: "current", date: TODAY },
      { id: "next", date: "2026-09-28" },
    ],
  });
  expect(frequencyRecords(goal, TODAY).map((entry) => entry.id)).toEqual(["current"]);
  expect(frequencyRecords(goal, "2026-09-28").map((entry) => entry.id)).toEqual(["next"]);
  expect(inPeriod(goal, "week", "2026-09-28")).toBe(true);
  expect(inPeriod(goal, "week", "2026-09-14")).toBe(false);
});
