import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiaryCollectionPage, discardDiaryCollectionDraft } from "./DiaryCollectionPage";
import type { DiaryPageProps } from "./DiaryPage";
import type { DiaryPage } from "./diaryTypes";

const source: DiaryPage = {
  id: "daily",
  title: "",
  date: "2026-10-03",
  entries: [{ id: "original", kind: "note", text: "원문은 그대로" }],
};
const page: DiaryPage = {
  id: "books",
  title: "읽은 책",
  date: null,
  goalId: "year-goal",
  entries: [
    { id: "undated", kind: "note", text: "  날짜 없는 기록  " },
    { id: "old", kind: "note", text: "지난달 책", recordDate: "2026-09-30" },
    {
      id: "new",
      kind: "note",
      text: "  책의 원문\n다음 줄  ",
      recordDate: "2026-10-03",
      rating: 0,
      review: "  한 줄 평  ",
      sourcePageId: "daily",
      sourceEntryId: "original",
    },
  ],
};
function props(overrides: Partial<DiaryPageProps> = {}): DiaryPageProps & { page: DiaryPage } {
  return {
    date: "2026-10-04",
    items: [{ id: "year-goal", title: "올해 책 읽기", planPeriod: "year" }],
    events: [],
    envelopes: [],
    moves: [],
    busy: false,
    onDiaryAction: vi.fn().mockResolvedValue(true),
    onAddTask: vi.fn().mockResolvedValue(null),
    onToggleTask: vi.fn(),
    onEditTask: vi.fn(),
    onMoveTask: vi.fn().mockResolvedValue(true),
    onOpenEnvelope: vi.fn(),
    onCreatePage: vi.fn().mockResolvedValue(null),
    onDirtyChange: vi.fn(),
    ...overrides,
    page: overrides.page ?? page,
  };
}
function openEntry(): ReturnType<typeof within> {
  fireEvent.click(screen.getByRole("button", { name: /책의 원문[\s\S]*다음 줄[\s\S]*기록 수정/ }));
  return within(screen.getByRole("dialog", { name: "페이지 기록 수정" }));
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("groups dated and undated records without rewriting text and opens original pages and goals", async () => {
  const callbacks = props();
  const open = vi.fn();
  render(<DiaryCollectionPage {...callbacks} pages={[page, source]} onOpenSourcePage={open} />);
  expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
    "2026년 10월",
    "2026년 9월",
    "날짜 없음",
  ]);
  expect(screen.getByText(/책의 원문/).textContent).toBe("  책의 원문\n다음 줄  ");
  fireEvent.click(screen.getByRole("link", { name: "10월 3일 한 줄 기록에서" }));
  expect(open).toHaveBeenCalledWith(source);
  fireEvent.click(screen.getByRole("button", { name: "올해 책 읽기 · 기간 계획 열기" }));
  expect(callbacks.onEditTask).toHaveBeenCalledWith(callbacks.items[0]);
  fireEvent.change(screen.getByLabelText("페이지에 기록할 내용"), {
    target: { value: "  새 기록  " },
  });
  fireEvent.change(screen.getByLabelText("기록 날짜"), { target: { value: "" } });
  fireEvent.submit(screen.getByLabelText("페이지에 기록할 내용").closest("form")!);
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-add", {
      pageId: "books",
      kind: "note",
      text: "  새 기록  ",
      recordDate: null,
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("value", ""),
  );
});

it("keeps failed multiline edits and metadata across reopening and sends the complete original snapshot", async () => {
  const callbacks = props({ onDiaryAction: vi.fn().mockResolvedValue(false) });
  let view = render(<DiaryCollectionPage {...callbacks} pages={[page, source]} />);
  let editor = openEntry();
  fireEvent.change(editor.getByLabelText("기록 내용"), {
    target: { value: "  고친 원문\n남길 줄  " },
  });
  fireEvent.click(editor.getByRole("button", { name: "기록 저장" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-update", {
      pageId: "books",
      id: "new",
      text: "  고친 원문\n남길 줄  ",
      recordDate: "2026-10-03",
      rating: 0,
      review: "  한 줄 평  ",
      sourcePageId: "daily",
      sourceEntryId: "original",
      expectedEntry: page.entries[2],
    }),
  );
  await screen.findByRole("alert");
  view.unmount();
  view = render(<DiaryCollectionPage {...callbacks} pages={[page, source]} />);
  editor = within(screen.getByRole("dialog", { name: "페이지 기록 수정" }));
  expect(editor.getByLabelText("기록 내용")).toHaveProperty("value", "  고친 원문\n남길 줄  ");
  expect(editor.getByLabelText("별점")).toHaveProperty("value", "0");
  fireEvent.click(editor.getByRole("button", { name: "닫기" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "입력 버리기 확인" })).getByRole("button", {
      name: "취소",
    }),
  );
  expect(editor.getByLabelText("기록 내용")).toHaveProperty("value", "  고친 원문\n남길 줄  ");
  fireEvent.click(editor.getByRole("button", { name: "닫기" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "입력 버리기 확인" })).getByRole("button", {
      name: "확인",
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(localStorage.getItem("comet:diary-collection-draft:books")).toBeNull();
});

it("does not delete a record changed in another view and preserves the editing draft", async () => {
  const callbacks = props();
  const view = render(<DiaryCollectionPage {...callbacks} />);
  const editor = openEntry();
  fireEvent.change(editor.getByLabelText("기록 내용"), { target: { value: "내 입력" } });
  fireEvent.click(editor.getByRole("button", { name: "기록 삭제…" }));
  view.rerender(
    <DiaryCollectionPage
      {...callbacks}
      page={{
        ...page,
        entries: page.entries.map((entry) =>
          entry.id === "new" ? { ...entry, review: "다른 창에서 수정" } : entry,
        ),
      }}
    />,
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "기록 삭제 확인" })).getByRole("button", {
      name: "확인",
    }),
  );
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("다른 곳에서 기록이 바뀌었어요");
  expect(editor.getByLabelText("기록 내용")).toHaveProperty("value", "내 입력");
});

it("uses deletion snapshots even when local props have not received the concurrent edit", async () => {
  const callbacks = props({ onDiaryAction: vi.fn().mockResolvedValue(false) });
  render(<DiaryCollectionPage {...callbacks} />);
  const editor = openEntry();
  fireEvent.click(editor.getByRole("button", { name: "기록 삭제…" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "기록 삭제 확인" })).getByRole("button", {
      name: "확인",
    }),
  );
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("entry-delete", {
      pageId: "books",
      id: "new",
      expectedEntry: page.entries[2],
    }),
  );
  await screen.findByRole("alert");
  expect(editor.getByLabelText("기록 내용")).toHaveProperty("value", page.entries[2].text);
});

it("restores page information drafts, guards page deletion, and clears only explicitly discarded drafts", async () => {
  const callbacks = props({ onDiaryAction: vi.fn().mockResolvedValue(false) });
  let view = render(<DiaryCollectionPage {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "이름·목표 바꾸기" }));
  fireEvent.change(screen.getByLabelText("페이지 이름"), { target: { value: "  새 이름  " } });
  view.unmount();
  view = render(<DiaryCollectionPage {...callbacks} />);
  expect(screen.getByLabelText("페이지 이름")).toHaveProperty("value", "  새 이름  ");
  fireEvent.click(screen.getByRole("button", { name: "페이지 정보 저장" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("page-update", {
      id: "books",
      title: "  새 이름  ",
      goalId: "year-goal",
      expectedPage: page,
    }),
  );
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "페이지 지우기…" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "페이지 삭제 확인" })).getByRole("button", {
      name: "확인",
    }),
  );
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenCalledWith("page-delete", {
      id: "books",
      expectedPage: page,
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("페이지 이름")).toHaveProperty("value", "  새 이름  "),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "페이지 삭제 확인" })).getByRole("button", {
      name: "취소",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "페이지 지우기…" }));
  view.rerender(<DiaryCollectionPage {...callbacks} page={{ ...page, title: "최신 이름" }} />);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "페이지 삭제 확인" })).getByRole("button", {
      name: "확인",
    }),
  );
  expect(callbacks.onDiaryAction).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert").textContent).toContain("다른 곳에서 페이지가 바뀌었어요");
  view.unmount();
  discardDiaryCollectionDraft(page.id);
  render(<DiaryCollectionPage {...callbacks} />);
  expect(screen.queryByLabelText("페이지 이름")).toBeNull();
});

it("reopens the previous editor when a linked-item draft was saved before the redesign", () => {
  localStorage.setItem(
    "comet:diary-draft:page:books",
    JSON.stringify({
      drafts: {},
      kind: "note",
      body: "  이전 초안\n그대로  ",
      time: "",
      envelopeId: "",
      createdTask: null,
    }),
  );
  render(<DiaryCollectionPage {...props()} />);
  expect(screen.getByRole("textbox", { name: "새 기록 내용" })).toHaveProperty(
    "value",
    "  이전 초안\n그대로  ",
  );
  expect(screen.getByRole("button", { name: "월별 페이지로 돌아가기" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("requires reviewing the latest entry before retrying while retaining all authored fields", async () => {
  const callbacks = props({ onDiaryAction: vi.fn().mockResolvedValue(false) });
  const view = render(<DiaryCollectionPage {...callbacks} pages={[page, source]} />);
  const editor = openEntry();
  fireEvent.change(editor.getByLabelText("기록 내용"), {
    target: { value: "  내 원문\n다음 줄  " },
  });
  fireEvent.change(editor.getByLabelText("한 줄 평"), { target: { value: "  내 감상  " } });
  fireEvent.click(editor.getByRole("button", { name: "기록 저장" }));
  await screen.findByRole("alert");
  const latest = { ...page.entries[2], text: "다른 창 원문", rating: 5, review: "다른 창 감상" };
  view.rerender(
    <DiaryCollectionPage
      {...callbacks}
      pages={[page, source]}
      page={{
        ...page,
        entries: page.entries.map((entry) => (entry.id === latest.id ? latest : entry)),
      }}
    />,
  );
  expect(editor.getByText("다른 창 원문")).toBeTruthy();
  expect(editor.getByText("한 줄 평: 다른 창 감상")).toBeTruthy();
  expect(editor.getByRole("button", { name: "기록 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(editor.getByRole("button", { name: "최신 기록을 기준으로 계속 수정" }));
  expect(editor.getByLabelText("기록 내용")).toHaveProperty("value", "  내 원문\n다음 줄  ");
  expect(editor.getByLabelText("한 줄 평")).toHaveProperty("value", "  내 감상  ");
  expect(editor.getByLabelText("별점")).toHaveProperty("value", "0");
  fireEvent.click(editor.getByRole("button", { name: "기록 저장" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenLastCalledWith(
      "entry-update",
      expect.objectContaining({
        expectedEntry: latest,
        text: "  내 원문\n다음 줄  ",
        rating: 0,
        review: "  내 감상  ",
      }),
    ),
  );
});

it("keeps quick-add writing while page metadata is edited and lets reviewed metadata conflicts retry", async () => {
  const callbacks = props({ onDiaryAction: vi.fn().mockResolvedValue(false) });
  const view = render(<DiaryCollectionPage {...callbacks} />);
  fireEvent.change(screen.getByLabelText("페이지에 기록할 내용"), {
    target: { value: "  나중에 기록할 원문  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "이름·목표 바꾸기" }));
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("기록 날짜")).toHaveProperty("disabled", true);
  fireEvent.submit(screen.getByLabelText("페이지에 기록할 내용").closest("form")!);
  expect(callbacks.onDiaryAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("페이지 이름"), {
    target: { value: "  내 페이지 이름  " },
  });
  fireEvent.change(screen.getByLabelText("이어 볼 기간 목표"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "페이지 정보 저장" }));
  await screen.findByRole("alert");
  const latest = { ...page, title: "다른 창의 이름", goalId: undefined };
  view.rerender(<DiaryCollectionPage {...callbacks} page={latest} />);
  expect(screen.getByText(/최신 이름: 다른 창의 이름/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "페이지 정보 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "최신 페이지를 기준으로 계속 수정" }));
  expect(screen.getByLabelText("페이지 이름")).toHaveProperty("value", "  내 페이지 이름  ");
  expect(screen.getByLabelText("이어 볼 기간 목표")).toHaveProperty("value", "");
  expect(screen.getByLabelText("페이지에 기록할 내용")).toHaveProperty(
    "value",
    "  나중에 기록할 원문  ",
  );
  fireEvent.click(screen.getByRole("button", { name: "페이지 정보 저장" }));
  await waitFor(() =>
    expect(callbacks.onDiaryAction).toHaveBeenLastCalledWith("page-update", {
      id: page.id,
      title: "  내 페이지 이름  ",
      goalId: null,
      expectedPage: latest,
    }),
  );
});
