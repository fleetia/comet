// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlannerTemplates, PLANNER_TEMPLATE_DRAFT_KEY } from "./PlannerTemplates";
import { PlannerListManager, PLANNER_LIST_DRAFT_KEY } from "./PlannerListManager";
import { TodoEditor, PLANNER_TODO_EDITOR_DRAFT_KEY, readTodoEditorDraft } from "./TodoEditor";
import type { ToolAction } from "../toolData";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("restores template choices after restart and clears the draft on successful save", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const view = render(<PlannerTemplates persistDraft act={act} busy={false} />);
  fireEvent.click(screen.getByRole("button", { name: "건강 관리" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "20분 산책하기" }));
  expect(localStorage.getItem(PLANNER_TEMPLATE_DRAFT_KEY)).not.toBeNull();
  view.unmount();
  render(<PlannerTemplates persistDraft act={act} busy={false} />);
  expect(screen.getByRole("checkbox", { name: "20분 산책하기" })).toHaveProperty("checked", false);
  fireEvent.click(screen.getByRole("button", { name: /선택한 .*개 추가/ }));
  await waitFor(() => expect(localStorage.getItem(PLANNER_TEMPLATE_DRAFT_KEY)).toBeNull());
});

it("restores list edits, refuses an externally changed original and clears an explicitly closed draft", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const props = {
    persistDraft: true,
    isOpen: true,
    lists: [{ id: "one", name: "원래" }],
    items: [],
    act,
    busy: false,
    failure: null,
    onClose: vi.fn(),
  };
  const view = render(<PlannerListManager {...props} />);
  fireEvent.change(screen.getByLabelText("새 목록 이름"), { target: { value: "새 목록" } });
  fireEvent.change(screen.getByLabelText("원래 이름"), { target: { value: "내 수정" } });
  expect(localStorage.getItem(PLANNER_LIST_DRAFT_KEY)).not.toBeNull();
  view.unmount();
  const restored = render(
    <PlannerListManager {...props} lists={[{ id: "one", name: "바뀐 원문" }]} />,
  );
  expect(screen.getByLabelText("새 목록 이름")).toHaveProperty("value", "새 목록");
  const input = screen.getByLabelText("바뀐 원문 이름");
  expect(input).toHaveProperty("value", "내 수정");
  const form = input.closest("form");
  if (!form) throw new Error("목록 이름 폼이 없습니다.");
  fireEvent.click(within(form).getByRole("button", { name: "이름 저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("다른 곳에서 바뀌었어요");
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "최신 이름 확인하고 계속 편집" }));
  expect(screen.getByLabelText("바뀐 원문 이름")).toHaveProperty("value", "내 수정");
  fireEvent.click(within(form).getByRole("button", { name: "이름 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("list-rename", { id: "one", name: "내 수정" }),
  );
  restored.rerender(<PlannerListManager {...props} isOpen={false} />);
  await waitFor(() => expect(localStorage.getItem(PLANNER_LIST_DRAFT_KEY)).toBeNull());
});

it("clears a list draft after the edited name is saved", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <PlannerListManager
      persistDraft
      isOpen
      lists={[{ id: "one", name: "원래" }]}
      items={[]}
      act={act}
      busy={false}
      failure={null}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("원래 이름");
  fireEvent.change(input, { target: { value: "새 이름" } });
  const form = input.closest("form");
  if (!form) throw new Error("목록 이름 폼이 없습니다.");
  fireEvent.click(within(form).getByRole("button", { name: "이름 저장" }));
  await waitFor(() => expect(localStorage.getItem(PLANNER_LIST_DRAFT_KEY)).toBeNull());
  expect(act).toHaveBeenCalledWith("list-rename", { id: "one", name: "새 이름" });
});

it("restores task fields with the editing snapshot and clears them only after discard", () => {
  const item = {
    id: "one",
    title: "원래 제목",
    memo: "원래 메모",
    listId: "default",
    repeat: "none",
  };
  const props = {
    item,
    lists: [{ id: "default", name: "내 할 일" }],
    act: vi.fn<ToolAction>(),
    busy: false,
    onClose: vi.fn(),
    draftKey: PLANNER_TODO_EDITOR_DRAFT_KEY,
    widgetId: "todo-one",
  };
  const view = render(<TodoEditor {...props} />);
  fireEvent.change(screen.getByLabelText("할 일 제목"), { target: { value: "고친 제목" } });
  fireEvent.change(screen.getByLabelText("메모"), { target: { value: "고친 메모" } });
  expect(readTodoEditorDraft(PLANNER_TODO_EDITOR_DRAFT_KEY).item).toEqual(item);
  expect(readTodoEditorDraft(PLANNER_TODO_EDITOR_DRAFT_KEY).widgetId).toBe("todo-one");
  view.unmount();
  const otherWidget = render(<TodoEditor {...props} widgetId="todo-two" />);
  expect(screen.getByLabelText("할 일 제목")).toHaveProperty("value", "원래 제목");
  expect(readTodoEditorDraft(PLANNER_TODO_EDITOR_DRAFT_KEY).widgetId).toBe("todo-one");
  otherWidget.unmount();
  render(<TodoEditor {...props} />);
  expect(screen.getByLabelText("할 일 제목")).toHaveProperty("value", "고친 제목");
  expect(screen.getByLabelText("메모")).toHaveProperty("value", "고친 메모");
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "할 일 편집" })).getByRole("button", {
      name: "취소",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "변경 버리고 닫기" }));
  expect(localStorage.getItem(PLANNER_TODO_EDITOR_DRAFT_KEY)).toBeNull();
});
