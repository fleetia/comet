import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiaryPageMenu } from "../Planner/DiaryPageMenu";
import type { DiaryAction, DiaryPage } from "../Planner/diaryTypes";

afterEach(cleanup);
const page: DiaryPage = { id: "page", date: null, title: "책 기록", entries: [] };

it("preserves an unsaved free-page title after failure and retries the same change", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<DiaryPageMenu page={page} onAction={onAction} busy={false} onDeleted={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "페이지 메뉴" }));
  fireEvent.change(screen.getByRole("textbox", { name: "페이지 제목" }), {
    target: { value: "읽고 싶은 책" },
  });
  fireEvent.click(screen.getByRole("button", { name: "제목 저장" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("제목을 저장하지 못했어요"),
  );
  expect(screen.getByRole("textbox", { name: "페이지 제목" })).toHaveProperty(
    "value",
    "읽고 싶은 책",
  );
  fireEvent.click(screen.getByRole("button", { name: "제목 저장" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(onAction.mock.calls).toEqual([
    ["page-update", { id: "page", title: "읽고 싶은 책" }],
    ["page-update", { id: "page", title: "읽고 싶은 책" }],
  ]);
});

it("requires a fresh confirmation when the dated page changes while deletion is open", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const onDeleted = vi.fn();
  const dated = { ...page, date: "2026-10-03" };
  const view = render(
    <DiaryPageMenu page={dated} onAction={onAction} busy={false} onDeleted={onDeleted} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "페이지 메뉴" }));
  expect(screen.queryByRole("textbox", { name: "페이지 제목" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "페이지 삭제…" }));
  view.rerender(
    <DiaryPageMenu
      page={{ ...dated, entries: [{ id: "new", kind: "note", text: "다른 창에서 쓴 내용" }] }}
      onAction={onAction}
      busy={false}
      onDeleted={onDeleted}
    />,
  );
  const deleting = screen.getByRole("button", { name: "페이지 삭제" });
  expect(deleting).toHaveProperty("disabled", true);
  fireEvent.click(deleting);
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 다시 불러오기" }));
  fireEvent.click(screen.getByRole("button", { name: "페이지 삭제…" }));
  fireEvent.click(screen.getByRole("button", { name: "페이지 삭제" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  expect(onAction).toHaveBeenCalledWith("page-delete", { id: "page" });
});
