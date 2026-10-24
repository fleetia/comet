import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiaryEnvelope } from "../Planner/DiaryEnvelope";
import { DiaryNotes } from "../Planner/DiaryNotes";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import * as nativeCommands from "../../hooks/useSnapshot";
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

it("opens the canonical preparation collection for creation without duplicating its request controller", async () => {
  const command = vi.spyOn(nativeCommands, "command").mockResolvedValue(undefined);
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  try {
    render(<PreparationTool widget={preparation} widgets={[]} act={act} />);
    fireEvent.click(screen.getByRole("button", { name: "준비 봉투 만들기" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("open_planner_view", { tab: "envelopes" }),
    );
    expect(act).not.toHaveBeenCalled();
  } finally {
    command.mockRestore();
  }
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
  expect(screen.queryByRole("button", { name: "메모 저장" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투 메뉴" }));
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
    expect(screen.getByRole("button", { name: "목록 위에 고정" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "목록 위에 고정" }));
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
  fireEvent.change(tasks.getByLabelText("봉투에 추가할 할 일"), {
    target: { value: "플레이리스트 고르기" },
  });
  const taskForm = tasks.getByLabelText("봉투에 추가할 할 일").closest("form");
  if (!taskForm) throw new Error("missing task form");
  fireEvent.submit(taskForm);
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
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("자동 저장됨"));
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
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "숲에서 만난 사람",
  );
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
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투 메뉴" }));
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
  fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "  저장 전\n내용  " } });
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value: "다른 메모" },
  });
  expect(screen.queryByRole("textbox", { name: "메모 내용" })).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), { target: { value: "" } });
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

it("shows stored notes in the shared list and restores selection after search without pinning", () => {
  const stored = { ...note, pinned: false, body: "  회의 뒤에\n이어 쓸 내용  " };
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(<DiaryNotes notes={[stored]} diaryAction={diaryAction} busy={false} />);
  const search = screen.getByRole("searchbox", { name: "메모 검색" });
  expect(screen.getByRole("button", { name: "세션 아이디어 메모 열기" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "회의" } });
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", stored.body);
  fireEvent.change(search, { target: { value: "없는 내용" } });
  expect(screen.queryByRole("article", { name: "세션 아이디어 메모" })).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", stored.body);
  expect(diaryAction).not.toHaveBeenCalled();
  expect(stored).toEqual({ ...note, pinned: false, body: "  회의 뒤에\n이어 쓸 내용  " });
});

it("keeps a selected stored draft through search and save failure using the original ID", async () => {
  const stored = { ...note, pinned: false };
  const rawDraft = "  저장 전\n넣어둔 생각  ";
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onDirtyChange = vi.fn();
  render(
    <DiaryNotes
      notes={[stored]}
      diaryAction={diaryAction}
      busy={false}
      onDirtyChange={onDirtyChange}
    />,
  );
  const search = screen.getByRole("searchbox", { name: "메모 검색" });
  fireEvent.change(search, { target: { value: "숲" } });
  fireEvent.click(screen.getByRole("button", { name: "세션 아이디어 메모 열기" }));
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", note.body);
  expect(diaryAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: rawDraft },
  });
  fireEvent.change(search, { target: { value: "없는 메모" } });
  expect(screen.queryByRole("textbox", { name: "메모 내용" })).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", rawDraft);

  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", rawDraft);
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  const update = {
    id: note.id,
    title: note.title,
    body: rawDraft,
    expectedTitle: note.title,
    expectedBody: note.body,
  };
  expect(diaryAction.mock.calls).toEqual([["note-update", update]]);
  fireEvent.click(screen.getByRole("button", { name: "다시 저장" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(diaryAction.mock.calls).toEqual([
    ["note-update", update],
    ["note-update", update],
  ]);
  expect(stored).toEqual({ ...note, pinned: false });
});

it("separates tasks from things and asks to archive only once for the ended schedule", async () => {
  const props = envelopeProps();
  const ended = { id: "event", title: "끝난 모임", endAt: 1, startAt: 0, allDay: false };
  const activeEnvelope = {
    ...envelope,
    eventId: "event",
    checks: [{ id: "check", text: "챙길 책", done: false }],
    todoIds: ["todo"],
  };
  const configured = { ...preparation, data: { envelopes: [], askArchiveAfterEnd: true } };
  const view = render(
    <DiaryEnvelope
      {...props}
      envelope={activeEnvelope}
      preparation={configured}
      events={[ended]}
      items={[{ id: "todo", title: "읽을 부분 정하기", completedAt: null }]}
    />,
  );
  expect(
    within(screen.getByRole("region", { name: "봉투 할 일" })).queryByRole("checkbox", {
      name: "챙길 책",
    }),
  ).toBeNull();
  expect(
    within(screen.getByRole("region", { name: "봉투 챙길 것" })).getByRole("checkbox", {
      name: "챙길 책",
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 준비하기" }));
  await waitFor(() =>
    expect(props.act).toHaveBeenCalledWith(
      "update",
      { id: "envelope", archivePromptDismissedFor: "event:1" },
      configured,
    ),
  );
  view.rerender(
    <DiaryEnvelope
      {...props}
      envelope={{ ...activeEnvelope, archivePromptDismissedFor: "event:1" }}
      preparation={configured}
      events={[ended]}
    />,
  );
  expect(screen.queryByRole("region", { name: "끝난 일정의 준비 봉투 보관" })).toBeNull();
  view.rerender(
    <DiaryEnvelope {...props} envelope={activeEnvelope} preparation={configured} events={[]} />,
  );
  expect(screen.queryByRole("region", { name: "끝난 일정의 준비 봉투 보관" })).toBeNull();
});

it("keeps a date draft from overwriting a schedule changed while the editor was open", async () => {
  const props = envelopeProps();
  const view = render(<DiaryEnvelope {...props} envelope={{ ...envelope, date: "2026-10-20" }} />);
  fireEvent.click(screen.getByRole("button", { name: "날짜 바꾸기" }));
  fireEvent.change(screen.getByLabelText("봉투 날짜"), { target: { value: "2026-10-21" } });
  view.rerender(
    <DiaryEnvelope
      {...props}
      envelope={{ ...envelope, date: "2026-10-22" }}
      preparation={{ ...preparation, revision: 2 }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "날짜 저장" }));
  const dialog = within(screen.getByRole("dialog", { name: "봉투 날짜와 일정" }));
  await waitFor(() =>
    expect(dialog.getByRole("alert").textContent).toContain(
      "다른 곳에서 봉투 날짜나 연결이 바뀌었어요",
    ),
  );
  expect(dialog.getByLabelText("봉투 날짜")).toHaveProperty("value", "2026-10-21");
  expect(props.act).not.toHaveBeenCalled();
});

it("keeps the empty resource card ready for adding links without an extra message", () => {
  const view = render(<DiaryEnvelope {...envelopeProps()} />);
  const resources = within(screen.getByRole("region", { name: "봉투 자료" }));
  expect(resources.queryByText("아직 모아 둔 자료가 없어요.")).toBeNull();
  fireEvent.click(resources.getByText("자료 추가"));
  expect(resources.getByRole("textbox", { name: "자료 이름" })).toBeTruthy();
  view.rerender(
    <DiaryEnvelope
      {...envelopeProps()}
      envelope={{
        ...envelope,
        links: [{ id: "link", title: "준비 자료", url: "https://example.com" }],
      }}
    />,
  );
  expect(resources.queryByText("아직 모아 둔 자료가 없어요.")).toBeNull();
  expect(resources.getByRole("link", { name: /준비 자료/ })).toBeTruthy();
});

it("lists pinned notes first, most recently pinned on top, also while searching", () => {
  const make = (id: string, extra: Partial<DiaryNote> = {}): DiaryNote => ({
    id,
    title: `${id} 메모`,
    body: "공통 본문",
    pinned: false,
    ...extra,
  });
  const notes = [
    make("첫째"),
    make("옛 고정", { pinned: true, pinnedAt: 100 }),
    make("둘째"),
    make("새 고정", { pinned: true, pinnedAt: 200 }),
    make("기록 전 고정", { pinned: true }),
  ];
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(<DiaryNotes notes={notes} diaryAction={diaryAction} busy={false} />);
  const order = () =>
    within(screen.getByLabelText("메모 목록"))
      .getAllByText(/ 메모$|^고정한 메모$|^다른 메모$/)
      .map((element) => element.textContent);
  expect(order()).toEqual([
    "고정한 메모",
    "새 고정 메모",
    "옛 고정 메모",
    "기록 전 고정 메모",
    "다른 메모",
    "첫째 메모",
    "둘째 메모",
  ]);
  expect(screen.getByRole("button", { name: "고정 풀기" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value: "째" },
  });
  expect(order()).toEqual(["첫째 메모", "둘째 메모"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "메모 검색" }), {
    target: { value: "고정" },
  });
  expect(order()).toEqual(["고정한 메모", "새 고정 메모", "옛 고정 메모", "기록 전 고정 메모"]);
  fireEvent.click(screen.getByRole("radio", { name: "바탕화면에 꺼낸 것" }));
  expect(screen.queryByText("고정한 메모")).toBeNull();
});
