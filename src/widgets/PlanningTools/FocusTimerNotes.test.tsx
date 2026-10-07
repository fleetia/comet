import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
afterEach(cleanup);
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
  await reactAct(async () =>
    fireEvent.click(screen.getByRole("button", { name: "원본 노트 열기" })),
  );
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
