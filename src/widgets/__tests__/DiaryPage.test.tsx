import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiaryPage, discardDiaryPageDraft, type DiaryPageProps } from "../Planner/DiaryPage";
import type { DiaryPage as Page } from "../Planner/diaryTypes";
import type { DataRecord } from "../toolData";
import type { WidgetView } from "../types";

const DAY = "2026-10-03";
const initialPage: Page = { id: "page-1", title: "", date: DAY, entries: [] };

function task(id: string, title: string): DataRecord {
  return { id, title, plannedDate: DAY, completedAt: null, repeatRule: null };
}

function props(overrides: Partial<DiaryPageProps> = {}): DiaryPageProps {
  return {
    page: initialPage,
    date: DAY,
    items: [],
    events: [],
    envelopes: [],
    moves: [],
    busy: false,
    onDiaryAction: vi.fn().mockResolvedValue(true),
    onAddTask: vi.fn().mockResolvedValue("new-todo"),
    onToggleTask: vi.fn(),
    onEditTask: vi.fn(),
    onMoveTask: vi.fn().mockResolvedValue(true),
    onOpenEnvelope: vi.fn(),
    onCreatePage: vi.fn().mockResolvedValue("page-1"),
    onDirtyChange: vi.fn(),
    ...overrides,
  };
}

function openComposer(): void {
  fireEvent.click(screen.getByRole("button", { name: "할 일, 떠오른 생각, 오늘의 일을 한 줄로…" }));
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

it("uses the same task once and keeps external appointments read-only", () => {
  const item = task("todo-1", "세션 자료 읽기");
  const callbacks = props({
    page: {
      ...initialPage,
      entries: [
        { id: "entry-1", kind: "todo", refId: "todo-1", text: "예전 제목" },
        { id: "entry-duplicate", kind: "todo", refId: "todo-1", text: "같은 할 일 참조" },
      ],
    },
    items: [item, { ...task("tomorrow", "내일 할 일"), plannedDate: "2026-10-04" }],
    events: [
      {
        id: "event-1",
        title: "토요일 TRPG",
        allDay: false,
        startAt: new Date(`${DAY}T21:00:00`).getTime(),
        endAt: new Date(`${DAY}T22:00:00`).getTime(),
      },
    ],
    envelopes: [{ id: "envelope-1", eventId: "event-1", eventLabel: "TRPG 준비" }],
  });
  render(<DiaryPage {...callbacks} />);

  expect(screen.getAllByRole("checkbox", { name: "세션 자료 읽기" })).toHaveLength(1);
  expect(screen.queryByText("내일 할 일")).toBeNull();
  const appointments = within(screen.getByRole("region", { name: "오늘의 약속" }));
  expect(appointments.getByText("연결 일정 · 읽기 전용")).toBeTruthy();
  expect(appointments.queryByRole("checkbox")).toBeNull();
  expect(appointments.queryByRole("textbox")).toBeNull();
  fireEvent.click(appointments.getByRole("button", { name: "TRPG 준비 열기 ↗" }));
  expect(callbacks.onOpenEnvelope).toHaveBeenCalledWith("envelope-1");
  fireEvent.click(screen.getByRole("checkbox", { name: "세션 자료 읽기" }));
  expect(callbacks.onToggleTask).toHaveBeenCalledWith(item);
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
});

it("preserves failed edits through reopening and refuses to overwrite a changed source", async () => {
  const page: Page = {
    ...initialPage,
    entries: [{ id: "note-1", kind: "note", text: "원래 기록" }],
  };
  const callbacks = props({ page, onDiaryAction: vi.fn().mockResolvedValue(false) });
  const view = render(<DiaryPage {...callbacks} />);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "지금 적은 내용\n한 줄 더" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "메모 내용" }));
  await waitFor(() =>
    expect(screen.getByText("저장하지 못했어요. 작성한 내용은 남아 있어요.")).toBeTruthy(),
  );
  expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-update", {
    pageId: "page-1",
    id: "note-1",
    text: "지금 적은 내용\n한 줄 더",
    expectedText: "원래 기록",
    expectedTime: null,
    expectedRefId: null,
  });
  expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  view.unmount();

  const changed = props({
    ...callbacks,
    page: { ...page, entries: [{ ...page.entries[0], text: "다른 창에서 바뀐 기록" }] },
  });
  render(<DiaryPage {...changed} />);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메모 내용" }).value).toBe(
    "지금 적은 내용\n한 줄 더",
  );
  fireEvent.blur(screen.getByRole("textbox", { name: "메모 내용" }));
  expect(callbacks.onDiaryAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "저장" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 보기" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메모 내용" }).value).toBe(
    "다른 창에서 바뀐 기록",
  );
  expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("shows active envelopes dated for this day without calendar setup and opens their original page", () => {
  const callbacks = props({
    envelopes: [
      { id: "today", title: "여행 준비", date: DAY, eventId: "", archived: false },
      { id: "tomorrow", title: "내일 봉투", date: "2026-10-04", eventId: "" },
      { id: "undated", title: "언젠가 할 일", date: null, eventId: "" },
      { id: "archived", title: "보관한 준비", date: DAY, eventId: "", archived: true },
      { id: "external", title: "외부 일정 봉투", date: DAY, eventId: "missing-event" },
    ],
  });
  const view = render(<DiaryPage {...callbacks} />);
  const appointments = within(screen.getByRole("region", { name: "오늘의 약속" }));
  expect(appointments.getByText("여행 준비")).toBeTruthy();
  expect(appointments.queryByText("내일 봉투")).toBeNull();
  expect(appointments.queryByText("언젠가 할 일")).toBeNull();
  expect(appointments.queryByText("보관한 준비")).toBeNull();
  expect(appointments.queryByText("외부 일정 봉투")).toBeNull();
  fireEvent.click(appointments.getByRole("button", { name: "여행 준비 열기 ↗" }));
  expect(callbacks.onOpenEnvelope).toHaveBeenCalledWith("today");
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
  view.rerender(
    <DiaryPage {...callbacks} page={{ ...initialPage, date: null, title: "모아둔 페이지" }} />,
  );
  expect(screen.queryByRole("region", { name: "오늘의 약속" })).toBeNull();
});

it("keeps newer writing when an earlier save resolves and saves against that accepted version", async () => {
  let finish: (ok: boolean) => void = () => undefined;
  const saving = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const save = vi.fn().mockReturnValueOnce(saving).mockResolvedValue(true);
  const page: Page = { ...initialPage, entries: [{ id: "note-1", kind: "note", text: "처음" }] };
  const callbacks = props({ page, onDiaryAction: save });
  const view = render(<DiaryPage {...callbacks} />);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메모 내용" });
  fireEvent.change(field, { target: { value: "먼저 저장" } });
  fireEvent.blur(field);
  fireEvent.change(field, { target: { value: "저장 중에 더 쓴 내용" } });
  const accepted: Page = { ...page, entries: [{ ...page.entries[0], text: "먼저 저장" }] };
  await act(async () => {
    view.rerender(<DiaryPage {...callbacks} page={accepted} />);
    finish(true);
    await saving;
  });
  expect(field.value).toBe("저장 중에 더 쓴 내용");
  expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      "entry-update",
      expect.objectContaining({ text: "저장 중에 더 쓴 내용", expectedText: "먼저 저장" }),
    ),
  );
});

it("does not submit Korean composition and reuses a task after its page link failed", async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const callbacks = props({ page: undefined, onDiaryAction: save });
  const view = render(<DiaryPage {...callbacks} />);
  openComposer();
  fireEvent.click(screen.getByRole("button", { name: "할 일" }));
  const field = screen.getByRole("textbox", { name: "새 기록 내용" });
  fireEvent.change(field, { target: { value: "질문 세 개 준비" } });
  fireEvent.keyDown(field, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(callbacks.onAddTask).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() =>
    expect(screen.getByText("할 일은 저장됐어요. 페이지 연결을 다시 시도해 주세요.")).toBeTruthy(),
  );
  expect(callbacks.onAddTask).toHaveBeenCalledTimes(1);
  expect(callbacks.onCreatePage).toHaveBeenCalledTimes(1);
  view.unmount();

  render(
    <DiaryPage {...callbacks} page={initialPage} items={[task("new-todo", "질문 세 개 준비")]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "페이지에 연결" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(callbacks.onAddTask).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenLastCalledWith("entry-add", {
    pageId: "page-1",
    kind: "todo",
    text: "질문 세 개 준비",
    refId: "new-todo",
  });
});

it("adds local appointments and envelope references without changing the external calendar", async () => {
  const callbacks = props({ envelopes: [{ id: "envelope-1", eventLabel: "토요일 TRPG 준비" }] });
  render(<DiaryPage {...callbacks} />);
  openComposer();
  fireEvent.click(screen.getByRole("button", { name: "일정" }));
  fireEvent.change(screen.getByLabelText("새 일정 시간"), { target: { value: "21:00" } });
  fireEvent.change(screen.getByRole("textbox", { name: "새 기록 내용" }), {
    target: { value: "동네 산책" },
  });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-add", {
      pageId: "page-1",
      kind: "event",
      text: "동네 산책",
      time: "21:00",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "준비 봉투" }).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투" }));
  fireEvent.change(screen.getByRole("combobox", { name: "연결할 준비 봉투" }), {
    target: { value: "envelope-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenLastCalledWith("entry-add", {
      pageId: "page-1",
      kind: "envelope",
      text: "토요일 TRPG 준비",
      refId: "envelope-1",
    }),
  );
  expect(callbacks.onAddTask).not.toHaveBeenCalled();
});

it("keeps the task on a failed move, then shows its migration without another active checkbox", async () => {
  const item = task("todo-1", "책상 정리");
  const page: Page = {
    ...initialPage,
    entries: [{ id: "entry-1", kind: "todo", refId: "todo-1", text: "책상 정리" }],
  };
  const move = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const callbacks = props({ page, items: [item], onMoveTask: move });
  const view = render(<DiaryPage {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "책상 정리 날짜 옮기기" }));
  fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
  await waitFor(() =>
    expect(screen.getByText("옮기지 못했어요. 다시 시도해 주세요.")).toBeTruthy(),
  );
  expect(screen.getByRole("checkbox", { name: "책상 정리" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이 날짜로 옮기기" }));
  await waitFor(() => expect(move).toHaveBeenCalledTimes(2));
  expect(move).toHaveBeenLastCalledWith(item, "2026-10-04");
  view.rerender(
    <DiaryPage
      {...callbacks}
      items={[{ ...item, plannedDate: "2026-10-04" }]}
      moves={[
        { id: "move-1", todoId: "todo-1", fromDate: DAY, toDate: "2026-10-04", title: "책상 정리" },
      ]}
    />,
  );
  expect(screen.queryByRole("checkbox", { name: "책상 정리" })).toBeNull();
  expect(screen.getAllByText("10월 4일로 옮김")).toHaveLength(1);
  view.rerender(
    <DiaryPage
      {...callbacks}
      items={[]}
      moves={[
        { id: "move-1", todoId: "todo-1", fromDate: DAY, toDate: "2026-10-04", title: "책상 정리" },
      ]}
    />,
  );
  expect(screen.getByText("책상 정리")).toBeTruthy();
  expect(screen.getAllByText("10월 4일로 옮김")).toHaveLength(1);
});

it("does not autosave when cancelling an edit, and explicitly discarded drafts do not return", async () => {
  const user = userEvent.setup();
  const page: Page = {
    ...initialPage,
    entries: [{ id: "note-1", kind: "note", text: "원래 기록" }],
  };
  const callbacks = props({ page });
  const view = render(<DiaryPage {...callbacks} />);
  const field = screen.getByRole("textbox", { name: "메모 내용" });
  await user.click(field);
  fireEvent.change(field, { target: { value: "취소할 내용" } });
  await user.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "메모 내용" }).value).toBe(
    "원래 기록",
  );
  openComposer();
  fireEvent.change(screen.getByRole("textbox", { name: "새 기록 내용" }), {
    target: { value: "닫기 전에 쓰던 내용" },
  });
  discardDiaryPageDraft(page, DAY);
  view.unmount();
  render(<DiaryPage {...callbacks} />);
  expect(screen.queryByRole("textbox", { name: "새 기록 내용" })).toBeNull();
  expect(callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("reads a linked memo from its live source, opens the same note, and only unlinks the diary entry", async () => {
  const entry: Page["entries"][number] = {
    id: "memo-link",
    kind: "widget",
    refId: "memo-widget",
    itemId: "memo-1",
    text: "연결 당시 메모",
  };
  const memo: WidgetView = {
    id: "memo-widget",
    kind: "memo",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: { notes: [{ id: "memo-1", title: "여행 메모", body: "  원문\n둘째 줄  " }] },
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 1,
  };
  const callbacks = props({
    page: { ...initialPage, entries: [entry] },
    widgets: [memo],
    onOpenWidgetEntry: vi.fn(),
  });
  const view = render(<DiaryPage {...callbacks} />);
  expect(
    screen.getByText(
      (_, element) => element?.tagName === "P" && element.textContent === "  원문\n둘째 줄  ",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "여행 메모 열기 ↗" }));
  expect(callbacks.onOpenWidgetEntry).toHaveBeenCalledWith(entry);
  const updated = {
    ...memo,
    revision: 2,
    data: { notes: [{ id: "memo-1", title: "수정된 여행 메모", body: "메모 창에서 고친 본문" }] },
  };
  view.rerender(<DiaryPage {...callbacks} widgets={[updated]} />);
  expect(screen.getByText("메모 창에서 고친 본문")).toBeTruthy();
  expect(screen.queryByText("연결 당시 메모")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "수정된 여행 메모 연결 해제" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-delete", {
      pageId: "page-1",
      id: "memo-link",
    }),
  );
  expect(callbacks.onDiaryAction).toHaveBeenCalledTimes(1);
  expect(callbacks.onAddTask).not.toHaveBeenCalled();
  expect(updated.data.notes[0].body).toBe("메모 창에서 고친 본문");
});

it("keeps the saved reference label when its widget or memo disappears", () => {
  const memo: WidgetView = {
    id: "memo-widget",
    kind: "memo",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: { notes: [] },
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 1,
  };
  const callbacks = props({
    page: {
      ...initialPage,
      entries: [
        {
          id: "memo-link",
          kind: "widget",
          refId: "memo-widget",
          itemId: "missing-note",
          text: "남겨 둔 메모",
        },
        { id: "tool-link", kind: "widget", refId: "missing-widget", text: "집중 타이머" },
      ],
    },
    widgets: [memo],
    onOpenWidgetEntry: vi.fn(),
  });
  render(<DiaryPage {...callbacks} />);
  expect(screen.getByText("남겨 둔 메모 · 원본을 찾을 수 없어요.")).toBeTruthy();
  expect(screen.getByText("집중 타이머 · 원본을 찾을 수 없어요.")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "남겨 둔 메모 열기 ↗" }).disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "집중 타이머 열기 ↗" }).disabled,
  ).toBe(true);
  expect(callbacks.onOpenWidgetEntry).not.toHaveBeenCalled();
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
});
