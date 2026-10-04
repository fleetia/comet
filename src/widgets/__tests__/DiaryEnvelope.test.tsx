import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiaryEnvelope } from "../Planner/DiaryEnvelope";
import { DiaryNotes } from "../Planner/DiaryNotes";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import type { DiaryAction, DiaryNote } from "../Planner/diaryTypes";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const preparation: WidgetView = {
  id: "preparation",
  kind: "preparation",
  installed: true,
  enabled: true,
  revision: 1,
  version: 1,
  data: { envelopes: [] },
  error: null,
  missing: [],
  status: "enabled",
  packageBytes: 1,
};
const envelope: DataRecord = {
  id: "envelope",
  title: "TRPG 준비",
  eventId: "",
  checks: [],
  links: [],
  todoIds: [],
};
const note: DiaryNote = {
  id: "note",
  title: "세션 아이디어",
  body: "숲에서 만난 사람",
  pinned: true,
  envelopeId: "envelope",
};

function envelopeProps(): Parameters<typeof DiaryEnvelope>[0] {
  return {
    envelope,
    preparation,
    items: [],
    events: [],
    notes: [],
    pages: [],
    busy: false,
    act: vi.fn<ToolAction>().mockResolvedValue(true),
    diaryAction: vi.fn<DiaryAction>().mockResolvedValue(true),
    onPlanTask: vi.fn().mockResolvedValue(true),
    onToggleTask: vi.fn().mockResolvedValue(true),
    onCreateTask: vi.fn().mockResolvedValue("todo-new"),
    onOpenPage: vi.fn(),
  };
}

it("creates a date-free preparation envelope without calendar setup and preserves a failed draft", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PreparationTool widget={preparation} widgets={[]} act={act} />);
  fireEvent.change(screen.getByRole("textbox", { name: "준비 봉투 이름" }), {
    target: { value: "가을 여행" },
  });
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투 만들기" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("입력한 내용은 남아"),
  );
  expect(screen.getByRole("textbox", { name: "준비 봉투 이름" })).toHaveProperty(
    "value",
    "가을 여행",
  );
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투 만들기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "준비 봉투 이름" })).toHaveProperty("value", ""),
  );
  expect(act.mock.calls).toEqual([
    ["create", { title: "가을 여행" }],
    ["create", { title: "가을 여행" }],
  ]);
});

it("keeps note edits after save failure and refuses to overwrite a note changed in its envelope", async () => {
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(false);
  const onDirtyChange = vi.fn();
  const view = render(
    <DiaryNotes
      notes={[note]}
      diaryAction={diaryAction}
      busy={false}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "세션 아이디어 메모 메뉴" }));
  fireEvent.click(screen.getByRole("button", { name: "편집" }));
  fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "내가 쓰던 생각" } });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(screen.getByLabelText("메모 내용")).toHaveProperty("value", "내가 쓰던 생각");
  view.rerender(
    <DiaryNotes
      notes={[{ ...note, body: "봉투에서 고친 생각" }]}
      diaryAction={diaryAction}
      busy={false}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  expect(diaryAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain("다른 곳에서 이 메모가 바뀌었어요");
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 다시 불러오기" }));
  expect(screen.getByLabelText("메모 내용")).toHaveProperty("value", "봉투에서 고친 생각");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("plans and completes the same linked task while pinning the existing envelope note", async () => {
  const props = envelopeProps();
  const task = { id: "todo", title: "시나리오 읽기", completedAt: null, plannedDate: null };
  render(
    <DiaryEnvelope
      {...props}
      envelope={{ ...envelope, todoIds: ["todo"] }}
      items={[task]}
      notes={[{ ...note, pinned: false }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "오늘 할 일로 꺼내기" }));
  fireEvent.click(screen.getByRole("button", { name: "시나리오 읽기 꺼내기" }));
  await waitFor(() => expect(props.onPlanTask).toHaveBeenCalledWith(task));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "시나리오 읽기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "시나리오 읽기" }));
  await waitFor(() => expect(props.onToggleTask).toHaveBeenCalledWith(task));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "세션 아이디어 메모 메뉴" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "세션 아이디어 메모 메뉴" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "곁에 꺼내두기" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "곁에 꺼내두기" }));
  await waitFor(() =>
    expect(props.diaryAction).toHaveBeenCalledWith("note-update", { id: "note", pinned: true }),
  );
  expect(props.onCreateTask).not.toHaveBeenCalled();
  expect(props.act).not.toHaveBeenCalled();
});

it("retries linking a created task without creating a duplicate after partial failure", async () => {
  const props = envelopeProps();
  vi.mocked(props.act).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<DiaryEnvelope {...props} />);
  const tasks = within(screen.getByRole("region", { name: "봉투 할 일" }));
  fireEvent.click(tasks.getByText("+ 준비할 일 추가"));
  fireEvent.change(tasks.getByLabelText("봉투에 추가할 할 일"), {
    target: { value: "플레이리스트 고르기" },
  });
  fireEvent.click(tasks.getByRole("button", { name: "할 일 추가" }));
  await waitFor(() =>
    expect(tasks.getByRole("button", { name: "봉투 연결 다시 시도" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(tasks.getByRole("button", { name: "봉투 연결 다시 시도" }));
  await waitFor(() =>
    expect(tasks.getByLabelText("봉투에 추가할 할 일")).toHaveProperty("value", ""),
  );
  expect(props.onCreateTask).toHaveBeenCalledTimes(1);
  expect(props.act).toHaveBeenCalledTimes(2);
  expect(vi.mocked(props.act).mock.calls[1]).toEqual([
    "todo-link",
    { id: "envelope", todoId: "todo-new" },
    preparation,
  ]);
});

it("restores an unfinished note after reopening and saves against the original content", async () => {
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const view = render(<DiaryNotes notes={[note]} diaryAction={diaryAction} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "세션 아이디어 메모 메뉴" }));
  fireEvent.click(screen.getByRole("button", { name: "편집" }));
  fireEvent.change(screen.getByLabelText("메모 내용"), {
    target: { value: "다음 장면은 숲길에서\n나중에 이어 쓰기" },
  });
  view.unmount();
  render(<DiaryNotes notes={[note]} diaryAction={diaryAction} busy={false} />);
  expect(screen.getByLabelText("메모 내용")).toHaveProperty(
    "value",
    "다음 장면은 숲길에서\n나중에 이어 쓰기",
  );
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await waitFor(() =>
    expect(diaryAction).toHaveBeenCalledWith("note-update", {
      id: "note",
      title: "세션 아이디어",
      body: "다음 장면은 숲길에서\n나중에 이어 쓰기",
      expectedTitle: "세션 아이디어",
      expectedBody: "숲에서 만난 사람",
    }),
  );
  await waitFor(() => expect(screen.queryByLabelText("메모 내용")).toBeNull());
});

it("keeps a memo readable after its envelope is removed without offering a broken link", () => {
  render(
    <DiaryNotes
      notes={[note]}
      diaryAction={vi.fn().mockResolvedValue(true)}
      busy={false}
      onOpenEnvelope={vi.fn()}
      envelopeNames={{}}
    />,
  );
  expect(screen.getByText("숲에서 만난 사람")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /준비 봉투 펼치기/ })).toBeNull();
});

it("keeps a failed direct date choice and clears the external event when it is saved", async () => {
  const props = envelopeProps();
  vi.mocked(props.act).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(
    <DiaryEnvelope
      {...props}
      envelope={{ ...envelope, eventId: "event", eventLabel: "외부 모임" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "날짜 바꾸기" }));
  const dialog = within(screen.getByRole("dialog", { name: "봉투 날짜와 일정" }));
  fireEvent.change(dialog.getByLabelText("봉투 날짜"), { target: { value: "2026-10-10" } });
  fireEvent.click(dialog.getByRole("button", { name: "날짜 저장" }));
  await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(dialog.getByLabelText("봉투 날짜")).toHaveProperty("value", "2026-10-10");
  fireEvent.click(dialog.getByRole("button", { name: "날짜 저장" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "봉투 날짜와 일정" })).toBeNull(),
  );
  expect(props.act).toHaveBeenLastCalledWith(
    "update",
    { id: "envelope", date: "2026-10-10", eventId: null, eventLabel: null },
    preparation,
  );
});

it("promotes a preparation check in one action and archives the envelope without deleting it", async () => {
  const props = envelopeProps();
  render(
    <DiaryEnvelope
      {...props}
      envelope={{ ...envelope, checks: [{ id: "check", text: "질문 세 개 준비", done: false }] }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "오늘 할 일로 꺼내기" }));
  fireEvent.click(screen.getByRole("button", { name: "질문 세 개 준비 꺼내기" }));
  await waitFor(() =>
    expect(props.act).toHaveBeenCalledWith(
      "check-promote",
      expect.objectContaining({
        id: "envelope",
        checkId: "check",
        plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
      preparation,
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "오늘 할 일로 꺼내기" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "준비를 마치고 보관" }));
  await waitFor(() =>
    expect(props.act).toHaveBeenLastCalledWith(
      "update",
      { id: "envelope", archived: true },
      preparation,
    ),
  );
  expect(props.onCreateTask).not.toHaveBeenCalled();
});

it("keeps linked task titles and checklist text independent from completion", async () => {
  const props = envelopeProps();
  const item = {
    id: "todo",
    title: "공유 할 일",
    completedAt: null,
    plannedDate: "2026-10-08",
    dueDate: "2026-10-12",
    memo: "공유 메모\n세부 내용",
  };
  render(
    <DiaryEnvelope
      {...props}
      envelope={{
        ...envelope,
        todoIds: ["todo"],
        checks: [{ id: "check", text: "준비물", done: false }],
      }}
      items={[item]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "공유 할 일 상세 보기" }));
  expect(screen.getByRole("region", { name: "공유 할 일 상세" }).textContent).toContain(
    "세부 내용",
  );
  expect(props.onToggleTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "준비물" }));
  expect(props.act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "준비물" }));
  await waitFor(() =>
    expect(props.act).toHaveBeenCalledWith(
      "check-toggle",
      { id: "envelope", checkId: "check" },
      preparation,
    ),
  );
});

it("keeps an unsaved persistent-note draft mounted while search hides it", async () => {
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const onDirtyChange = vi.fn();
  render(
    <DiaryNotes
      notes={[note]}
      diaryAction={diaryAction}
      busy={false}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "세션 아이디어 메모 메뉴" }));
  fireEvent.click(screen.getByRole("button", { name: "편집" }));
  fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "  저장 전\n내용  " } });
  fireEvent.change(screen.getByRole("textbox", { name: "메모 검색" }), {
    target: { value: "다른 메모" },
  });
  expect(screen.queryByRole("textbox", { name: "메모 내용" })).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 검색" }), { target: { value: "" } });
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "  저장 전\n내용  ",
  );
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await waitFor(() =>
    expect(diaryAction).toHaveBeenCalledWith(
      "note-update",
      expect.objectContaining({ id: note.id, body: "  저장 전\n내용  " }),
    ),
  );
});
