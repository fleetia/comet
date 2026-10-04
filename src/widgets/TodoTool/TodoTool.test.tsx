import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodoTool } from "./TodoTool";
import { localDay, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";

function task(overrides: DataRecord = {}): DataRecord {
  return {
    id: "task",
    title: "자료 검토",
    memo: "  첫째 줄\n둘째 줄  ",
    listId: "default",
    completedAt: null,
    plannedDate: "2026-10-04",
    dueDate: "2026-10-08",
    dueAt: null,
    repeat: "none",
    ...overrides,
  };
}
function widget(items = [task()], revision = 1): WidgetView {
  return {
    id: "todo-instance",
    kind: "todo",
    installed: true,
    enabled: true,
    revision,
    version: 1,
    data: { lists: [{ id: "default", name: "할 일" }], items },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
const act = vi.fn<ToolAction>();
beforeEach(() => {
  act.mockReset();
  act.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("opens read-only details from the title without completing or editing the task", () => {
  const source = widget();
  const original = structuredClone(source);
  render(<TodoTool widget={source} act={act} />);
  const title = screen.getByRole("button", { name: "자료 검토 상세 보기" });
  const checkbox = screen.getByRole("checkbox", { name: "자료 검토" });
  expect(title.closest("label")).toBeNull();
  expect(screen.queryByRole("region", { name: "자료 검토 상세" })).toBeNull();
  fireEvent.click(title);
  expect(title).toHaveProperty("ariaExpanded", "true");
  const detail = screen.getByRole("region", { name: "자료 검토 상세" });
  expect(title.getAttribute("aria-controls")).toBe(detail.id);
  expect(within(detail).queryByRole("textbox")).toBeNull();
  expect(detail.textContent).toContain("계획 날짜2026-10-04");
  expect(detail.textContent).toContain("기한마감 2026-10-08");
  const memo = within(detail).getByText("첫째 줄 둘째 줄");
  expect(memo.textContent).toBe("  첫째 줄\n둘째 줄  ");
  fireEvent.click(memo);
  fireEvent.click(checkbox.closest("article")!);
  expect(checkbox).toHaveProperty("checked", false);
  expect(screen.getByRole("textbox", { name: "할 일 제목" })).toHaveProperty("value", "");
  expect(act).not.toHaveBeenCalled();
  expect(source).toEqual(original);
  fireEvent.click(title);
  expect(title).toHaveProperty("ariaExpanded", "false");
  expect(screen.queryByRole("region", { name: "자료 검토 상세" })).toBeNull();
});

it("gives the checkbox, title disclosure, and explicit edit separate keyboard actions", async () => {
  const user = userEvent.setup();
  render(<TodoTool widget={widget()} act={act} />);
  const checkbox = screen.getByRole("checkbox", { name: "자료 검토" });
  checkbox.focus();
  await user.tab();
  const title = screen.getByRole("button", { name: "자료 검토 상세 보기" });
  expect(document.activeElement).toBe(title);
  await user.keyboard("{Enter}");
  expect(title).toHaveProperty("ariaExpanded", "true");
  expect(checkbox).toHaveProperty("checked", false);
  await user.keyboard(" ");
  expect(title).toHaveProperty("ariaExpanded", "false");
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "수정" }));
  await user.keyboard("{Enter}");
  const input = screen.getByRole("textbox", { name: "할 일 제목" });
  expect(document.activeElement).toBe(input);
  expect(input).toHaveProperty("value", "자료 검토");
  expect(act).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(input).toHaveProperty("value", "");
  expect(act).not.toHaveBeenCalled();
});

it("completes only from the checkbox and offers a keyboard-operable undo on the same task", async () => {
  const user = userEvent.setup();
  const source = widget();
  const original = structuredClone(source);
  const view = render(<TodoTool widget={source} act={act} />);
  screen.getByRole("checkbox", { name: "자료 검토" }).focus();
  await user.keyboard(" ");
  expect(act).toHaveBeenCalledExactlyOnceWith("complete", { id: "task" });
  expect(source).toEqual(original);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "자료 검토 완료했어요.");
  const undo = screen.getByRole("button", { name: "완료 되돌리기" });
  expect(undo).toHaveProperty("disabled", true);
  view.rerender(<TodoTool widget={widget([task({ completedAt: 123 })], 2)} act={act} />);
  expect(undo).toHaveProperty("disabled", false);
  expect(screen.getByRole("checkbox", { name: "자료 검토" })).toHaveProperty("checked", true);
  undo.focus();
  await user.keyboard("{Enter}");
  expect(act).toHaveBeenLastCalledWith("undo", { id: "task" });
  expect(act).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "완료 되돌리기" })).toBeNull();
});

it("keeps completion undo available when a completed task leaves the wrap-up filter", async () => {
  const view = render(<TodoTool widget={widget()} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "하루 마무리" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "자료 검토" }));
  await screen.findByRole("status");
  view.rerender(<TodoTool widget={widget([task({ completedAt: 123 })], 2)} act={act} />);
  expect(screen.queryByRole("checkbox", { name: "자료 검토" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "완료 되돌리기" }));
  await waitFor(() => expect(act).toHaveBeenLastCalledWith("undo", { id: "task" }));
});

it("blocks repeated completion while pending and does not report success after failure", async () => {
  let finish: ((ok: boolean) => void) | undefined;
  act.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<TodoTool widget={widget()} act={act} />);
  const checkbox = screen.getByRole("checkbox", { name: "자료 검토" });
  fireEvent.click(checkbox);
  expect(checkbox).toHaveProperty("disabled", true);
  fireEvent.click(checkbox);
  expect(act).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("status")).toBeNull();
  await reactAct(async () => finish?.(false));
  expect(checkbox).toHaveProperty("disabled", false);
  expect(checkbox).toHaveProperty("checked", false);
  expect(screen.queryByRole("button", { name: "완료 되돌리기" })).toBeNull();
});

it("retains the undo action after a failed undo and removes stale feedback after an external undo", async () => {
  const view = render(<TodoTool widget={widget()} act={act} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "자료 검토" }));
  await screen.findByRole("status");
  view.rerender(<TodoTool widget={widget([task({ completedAt: 123 })], 2)} act={act} />);
  act.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "완료 되돌리기" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "완료 되돌리기" })).toHaveProperty("disabled", false),
  );
  expect(screen.getByRole("checkbox", { name: "자료 검토" })).toHaveProperty("checked", true);
  view.rerender(<TodoTool widget={widget([task()], 3)} act={act} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "완료 되돌리기" })).toBeNull();
  view.rerender(<TodoTool widget={widget([task({ completedAt: 456 })], 4)} act={act} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "완료 되돌리기" })).toBeNull();
});

it("undoes an existing completed task only from its checkbox", async () => {
  render(<TodoTool widget={widget([task({ completedAt: 123 })])} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "자료 검토 상세 보기" }));
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "자료 검토" }));
  await waitFor(() => expect(act).toHaveBeenCalledExactlyOnceWith("undo", { id: "task" }));
});

it("shows the full local deadline and device time zone separately from the planned date", () => {
  vi.stubEnv("TZ", "Asia/Seoul");
  const item = task({
    plannedDate: "2026-10-04",
    dueDate: null,
    dueAt: new Date("2026-10-08T00:30:00+09:00").getTime(),
  });
  render(<TodoTool widget={widget([item])} act={act} />);
  expect(screen.getByText(/계획 날짜 2026-10-04 · 마감 2026-10-08 00:30/).textContent).toContain(
    "Asia/Seoul 기준",
  );
  fireEvent.click(screen.getByRole("button", { name: "자료 검토 상세 보기" }));
  const detail = screen.getByRole("region", { name: "자료 검토 상세" });
  expect(detail.textContent).toContain("2026-10-08 00:30");
  expect(detail.textContent).toContain("Asia/Seoul 기준");
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  const due = screen.getByLabelText(/^기한\s*\*?$/);
  expect(due).toHaveProperty("value", "2026-10-08T00:30");
  const description = document.getElementById(due.getAttribute("aria-describedby")!);
  expect(description?.textContent).toBe("기기 시간대 Asia/Seoul 기준");
  expect(act).not.toHaveBeenCalled();
});

it("uses planned dates for Today, preserving explicit removal and legacy due-date fallback", () => {
  const today = localDay();
  const legacy = task({ id: "legacy", title: "기존 기한", dueDate: today });
  delete legacy.plannedDate;
  render(
    <TodoTool
      widget={widget([
        task({ id: "planned", title: "오늘 계획", plannedDate: today, dueDate: "2099-12-31" }),
        task({ id: "removed", title: "계획에서 뺀 일", plannedDate: null, dueDate: today }),
        legacy,
      ])}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "오늘" }));
  expect(screen.getByRole("button", { name: "오늘 계획 상세 보기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "기존 기한 상세 보기" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "계획에서 뺀 일 상세 보기" })).toBeNull();
  expect(act).not.toHaveBeenCalled();
});

it("keeps the open detail read-only and current when the original task is updated elsewhere", () => {
  const view = render(<TodoTool widget={widget()} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "자료 검토 상세 보기" }));
  view.rerender(
    <TodoTool widget={widget([task({ memo: "새 메모", plannedDate: null })], 2)} act={act} />,
  );
  const detail = screen.getByRole("region", { name: "자료 검토 상세" });
  expect(detail.textContent).toContain("계획 날짜미정");
  expect(within(detail).getByText("새 메모")).toBeTruthy();
  expect(within(detail).queryByRole("textbox")).toBeNull();
  expect(act).not.toHaveBeenCalled();
});
