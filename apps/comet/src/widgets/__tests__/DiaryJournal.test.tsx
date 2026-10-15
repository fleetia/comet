import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiaryJournal } from "../Planner/DiaryJournal";
import { command } from "../../hooks/useSnapshot";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
beforeEach(() => vi.mocked(command).mockReset());
const date = "2026-10-05";
const range = { startAt: new Date(2026, 9, 5).getTime(), endAt: new Date(2026, 9, 6).getTime() };

it("starts collapsed and loads only the chosen local date, preserving event text", async () => {
  vi.mocked(command).mockResolvedValueOnce([
    [
      25,
      { id: "old", widgetKind: "fishing", createdAt: range.startAt, text: "  지난 기록\n그대로  " },
    ],
  ]);
  render(<DiaryJournal date={date} />);
  expect(screen.getByText("함께한 기록").closest("details")).toHaveProperty("open", false);
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("함께한 기록"));
  const text = await screen.findByText(
    (_, node) => node?.tagName === "P" && node.textContent === "  지난 기록\n그대로  ",
  );
  expect(text).toBeTruthy();
  expect(command).toHaveBeenCalledExactlyOnceWith("get_widget_journal", { before: null, ...range });
  expect(screen.queryByRole("button", { name: "이전 기록 더 보기" })).toBeNull();
});

it("paginates a full day with its last sequence, excluding duplicates and other dates", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => [
    200 - index,
    {
      id: String(index),
      widgetKind: "ball",
      createdAt: range.startAt + index,
      text: `기록 ${index}`,
    },
  ]);
  vi.mocked(command)
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([
      rows[99],
      [100, { id: "last", widgetKind: "ball", createdAt: range.startAt, text: "마지막 기록" }],
    ]);
  render(<DiaryJournal date={date} />);
  fireEvent.click(screen.getByText("함께한 기록"));
  await screen.findByText("기록 99");
  fireEvent.click(screen.getByRole("button", { name: "이전 기록 더 보기" }));
  await screen.findByText("마지막 기록");
  expect(command).toHaveBeenLastCalledWith("get_widget_journal", { before: 101, ...range });
  expect(screen.getAllByRole("article")).toHaveLength(101);
  expect(screen.queryByRole("button", { name: "이전 기록 더 보기" })).toBeNull();
});

it("keeps a failed load distinct from an empty day and allows retry", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("기록 조회 실패")).mockResolvedValueOnce([]);
  render(<DiaryJournal date={date} />);
  fireEvent.click(screen.getByText("함께한 기록"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "기록 조회 실패");
  expect(screen.queryByText("이날 함께한 기록이 없어요.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "기록 새로고침" }));
  await screen.findByText("이날 함께한 기록이 없어요.");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("ignores a late response from the previous date", async () => {
  let finish: (value: unknown) => void = () => undefined;
  vi.mocked(command)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce([
      [4, { id: "new", widgetKind: "ball", createdAt: range.endAt, text: "다음 날 기록" }],
    ]);
  const view = render(<DiaryJournal date={date} />);
  fireEvent.click(screen.getByText("함께한 기록"));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  view.rerender(<DiaryJournal date="2026-10-06" />);
  await screen.findByText("다음 날 기록");
  await act(async () =>
    finish([
      [5, { id: "old", widgetKind: "ball", createdAt: range.startAt, text: "늦은 전날 기록" }],
    ]),
  );
  expect(screen.queryByText("늦은 전날 기록")).toBeNull();
  expect(screen.getByText("다음 날 기록")).toBeTruthy();
});
