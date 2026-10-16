import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { FocusTimerNotes } from "./FocusTimerNotes";
import type { WidgetView } from "../types";
import type { DiaryState } from "../Planner/diaryTypes";
import type { DataRecord } from "../toolData";

const mocked = vi.hoisted(() => ({
  busy: false,
  mutate: vi.fn(),
  state: {
    revision: 1,
    notes: [{ id: "note", title: "원본 제목", body: "원본 내용", pinned: true }],
    pages: [],
    moves: [],
  },
}));
vi.mock("../Planner/useDiary", () => ({
  useDiary: () => ({
    state: mocked.state as DiaryState,
    busy: mocked.busy,
    error: null,
    mutate: mocked.mutate,
  }),
}));
beforeEach(() => {
  localStorage.clear();
  mocked.busy = false;
  mocked.mutate.mockReset();
  mocked.state.notes = [{ id: "note", title: "원본 제목", body: "원본 내용", pinned: true }];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const props = {
  widgets: [] as WidgetView[],
  noteRef: null,
  memo: "",
  canConnect: true,
  requested: null,
  onRequestedHandled: vi.fn(),
  onConnect: vi.fn<(ref: DataRecord | null) => Promise<boolean>>().mockResolvedValue(true),
  onMemoChange: vi.fn(),
  onSaveMemo: vi.fn().mockResolvedValue(true),
};

it("keeps memo body text out of a note reference even when used as a visible title", async () => {
  const memo: WidgetView = {
    id: "memo-widget",
    kind: "memo",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: { notes: [{ id: "sheet", title: "", body: "복제하면 안 되는 본문\n둘째 줄" }] },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  const connect = vi.fn<(ref: DataRecord | null) => Promise<boolean>>().mockResolvedValue(true);
  render(<FocusTimerNotes {...props} widgets={[memo]} onConnect={connect} />);
  fireEvent.click(screen.getByRole("button", { name: "다른 메모 연결하기" }));
  await reactAct(async () =>
    fireEvent.change(screen.getByLabelText("연결할 노트"), {
      target: { value: JSON.stringify(["memo", "memo-widget", "sheet"]) },
    }),
  );
  expect(connect).toHaveBeenCalledExactlyOnceWith({
    kind: "memo",
    widgetId: "memo-widget",
    id: "sheet",
    title: "바탕화면 메모",
  });
});

it("portals the original-note editor outside its pane and locks it while saving", async () => {
  let finish: ((state: DiaryState) => void) | undefined;
  mocked.mutate.mockImplementation(
    () =>
      new Promise<DiaryState>((resolve) => {
        finish = resolve;
      }),
  );
  const noteRef = { kind: "diary", id: "note", title: "원본 제목" };
  const view = render(<FocusTimerNotes {...props} noteRef={noteRef} />);
  expect(document.querySelector("dialog")).toBeNull();
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "제목 편집" })));
  const dialog = screen.getByRole("dialog", { name: "원본 노트" });
  expect(dialog.parentElement).toBe(document.body);
  expect(view.container.contains(dialog)).toBe(false);
  fireEvent.change(screen.getByLabelText("노트 내용"), { target: { value: "저장할 본문" } });
  fireEvent.click(screen.getByRole("button", { name: "원본에 저장" }));
  mocked.busy = true;
  view.rerender(<FocusTimerNotes {...props} noteRef={noteRef} />);
  expect(screen.getByLabelText("노트 내용")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(/노트 제목/)).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "닫기" })).toHaveProperty("disabled", true);
  expect(mocked.mutate).toHaveBeenCalledWith("note-update", {
    id: "note",
    title: "원본 제목",
    body: "저장할 본문",
    expectedTitle: "원본 제목",
    expectedBody: "원본 내용",
  });
  await reactAct(async () => finish?.(mocked.state));
  expect(document.querySelector("dialog")).toBeNull();
});

async function debounce(): Promise<void> {
  await reactAct(async () => vi.advanceTimersByTimeAsync(550));
}

function SessionNotes({ save }: { save: (memo: string) => Promise<boolean> }): ReactElement {
  const [memo, setMemo] = useState("원문");
  const [base, setBase] = useState("원문");
  return (
    <FocusTimerNotes
      {...props}
      memo={memo}
      memoBase={base}
      onMemoChange={setMemo}
      onSaveMemo={async () => {
        const ok = await save(memo);
        if (ok) setBase(memo);
        return ok;
      }}
    />
  );
}

it("autosaves the session memo after composition and waits for an explicit retry after failure", async () => {
  vi.useFakeTimers();
  const save = vi
    .fn<(memo: string) => Promise<boolean>>()
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  render(<SessionNotes save={save} />);
  const input = screen.getByRole("textbox", { name: "이번 집중 메모" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "  조합 중인 메모\n다음 줄  " } });
  await debounce();
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await debounce();
  expect(save).toHaveBeenCalledExactlyOnceWith("  조합 중인 메모\n다음 줄  ");
  expect(screen.getByRole("alert").textContent).toContain("초안은 남아");
  await debounce();
  expect(save).toHaveBeenCalledTimes(1);
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "다시 저장" })));
  expect(save).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toContain("자동 저장됨");
});

it("edits the linked diary original inline with content guards and preserves a conflicting draft", async () => {
  vi.useFakeTimers();
  mocked.mutate.mockResolvedValue(mocked.state);
  const noteRef = { kind: "diary", id: "note", title: "원본 제목" };
  const view = render(<FocusTimerNotes {...props} noteRef={noteRef} />);
  const input = screen.getByRole("textbox", { name: "연결한 메모 내용" });
  fireEvent.change(input, { target: { value: "  직접 고친 원문\n  " } });
  await debounce();
  expect(mocked.mutate).toHaveBeenCalledExactlyOnceWith("note-update", {
    id: "note",
    title: "원본 제목",
    body: "  직접 고친 원문\n  ",
    expectedTitle: "원본 제목",
    expectedBody: "원본 내용",
  });
  fireEvent.change(input, { target: { value: "새 초안" } });
  mocked.state.notes = [{ id: "note", title: "원본 제목", body: "다른 곳의 수정", pinned: true }];
  view.rerender(<FocusTimerNotes {...props} noteRef={noteRef} />);
  await debounce();
  expect(mocked.mutate).toHaveBeenCalledTimes(1);
  expect(input).toHaveProperty("value", "새 초안");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  view.unmount();
  render(<FocusTimerNotes {...props} noteRef={noteRef} />);
  expect(screen.getByRole("textbox", { name: "연결한 메모 내용" })).toHaveProperty(
    "value",
    "새 초안",
  );
  mocked.state.notes = [{ id: "note", title: "원본 제목", body: "원본 내용", pinned: true }];
});

it("autosaves a linked desktop original in its owning widget without copying its fallback title", async () => {
  vi.useFakeTimers();
  const memo: WidgetView = {
    id: "memo-widget",
    kind: "memo",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: { notes: [{ id: "sheet", title: "", body: "원래 낱장", isOpen: true }] },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  const action = vi.fn().mockResolvedValue(true);
  render(
    <FocusTimerNotes
      {...props}
      widgets={[memo]}
      act={action}
      noteRef={{ kind: "memo", widgetId: memo.id, id: "sheet", title: "바탕화면 메모" }}
    />,
  );
  const input = screen.getByRole("textbox", { name: "연결한 메모 내용" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "  낱장 원문 그대로\n둘째 줄  " } });
  await debounce();
  expect(action).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await debounce();
  expect(action).toHaveBeenCalledExactlyOnceWith(
    "update",
    {
      id: "sheet",
      body: "  낱장 원문 그대로\n둘째 줄  ",
      expectedTitle: "",
      expectedBody: "원래 낱장",
    },
    memo,
  );
  expect(mocked.mutate).not.toHaveBeenCalled();
});

it.each([false, true])(
  "can unlink an unavailable desktop original with missing=%s",
  async (missing) => {
    const memo: WidgetView = {
      id: "memo-widget",
      kind: "memo",
      installed: true,
      enabled: false,
      revision: 1,
      version: 1,
      data: { notes: missing ? [] : [{ id: "sheet", title: "낱장", body: "원문" }] },
      error: null,
      missing: [],
      status: "disabled",
      packageBytes: 1,
    };
    const onConnect = vi.fn<(ref: DataRecord | null) => Promise<boolean>>().mockResolvedValue(true);
    const action = vi.fn().mockResolvedValue(true);
    render(
      <FocusTimerNotes
        {...props}
        widgets={[memo]}
        act={action}
        onConnect={onConnect}
        noteRef={{ kind: "memo", widgetId: memo.id, id: "sheet", title: "낱장" }}
      />,
    );
    const unlink = screen.getByRole("button", { name: "연결 풀기" });
    expect(unlink).toHaveProperty("disabled", false);
    await reactAct(async () => fireEvent.click(unlink));
    expect(onConnect).toHaveBeenCalledExactlyOnceWith(null);
    expect(action).not.toHaveBeenCalled();
    expect(mocked.mutate).not.toHaveBeenCalled();
  },
);
