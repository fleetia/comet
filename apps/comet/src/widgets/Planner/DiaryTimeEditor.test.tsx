import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiaryTimeEditor } from "./DiaryTimeEditor";
import { manualTimeSegments, parseTimeInput, recordedTimeMinutes } from "./diaryTime";
import type { DiaryState } from "./diaryTypes";

afterEach(cleanup);
const empty: DiaryState = { revision: 0, pages: [], notes: [], moves: [] };

describe("diary manual time", () => {
  it("uses keyboard ring selection, exact midnight boundary and original entered text", async () => {
    const action = vi.fn().mockResolvedValue(true);
    const dirty = vi.fn();
    render(
      <DiaryTimeEditor
        state={empty}
        date="2026-10-15"
        onAction={action}
        busy={false}
        onDirtyChange={dirty}
      />,
    );
    const ring = screen.getByRole("group", { name: "하루 시간 기록" });
    fireEvent.keyDown(ring, { key: "End" });
    fireEvent.keyDown(ring, { key: "Enter" });
    const dialog = within(screen.getByRole("dialog", { name: "시간 칠하기" }));
    fireEvent.change(dialog.getByLabelText("시간 기록 제목"), {
      target: { value: "  마무리\n  " },
    });
    fireEvent.click(dialog.getByRole("button", { name: "생활" }));
    fireEvent.click(dialog.getByRole("button", { name: "칠하기" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action).toHaveBeenCalledWith("time-record-save", {
      date: "2026-10-15",
      startMinute: 1430,
      endMinute: 1440,
      categoryId: "life",
      title: "  마무리  ",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps invalid or failed time edits and guards duplicate saves", async () => {
    const action = vi.fn().mockResolvedValue(false);
    render(<DiaryTimeEditor state={empty} date="2026-10-15" onAction={action} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "시간 입력" }));
    fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "23:50" } });
    fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "00:10" } });
    fireEvent.click(screen.getByRole("button", { name: "칠하기" }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("자정을 넘으면");
    fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "24:00" } });
    fireEvent.change(screen.getByLabelText("시간 기록 제목"), {
      target: { value: "남겨 둘 입력" },
    });
    fireEvent.click(screen.getByRole("button", { name: "칠하기" }));
    fireEvent.click(screen.getByRole("button", { name: "칠하기" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("입력을 유지"));
    expect(action).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("시간 기록 제목") as HTMLInputElement).value).toBe(
      "남겨 둘 입력",
    );
  });

  it("requires confirmation and reassignment when deleting a category with history", async () => {
    const action = vi.fn().mockResolvedValue(true);
    const record = {
      id: "old",
      date: "2026-10-14",
      startMinute: 540,
      endMinute: 600,
      categoryId: "work",
      title: "지난 기록",
    };
    render(
      <DiaryTimeEditor
        state={{ ...empty, timeRecords: [record] }}
        date="2026-10-15"
        onAction={action}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "분류 관리" }));
    fireEvent.change(screen.getByLabelText("삭제할 때 기존 기록 이동"), {
      target: { value: "life" },
    });
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("time-category-delete", {
        id: "work",
        reassignTo: "life",
        expectedCategory: { id: "work", name: "일", color: "work" },
      }),
    );
    expect(record.categoryId).toBe("work");
  });

  it("splits future paint from recorded time and does not double count overlapping focus", () => {
    const state = {
      ...empty,
      timeRecords: [
        {
          id: "one",
          date: "2026-10-15",
          startMinute: 540,
          endMinute: 660,
          categoryId: "work",
          title: "원고",
        },
      ],
    };
    const manual = manualTimeSegments(state, "2026-10-15", 600);
    expect(
      manual.map(({ startMinute, endMinute, kind }) => [startMinute, endMinute, kind]),
    ).toEqual([
      [540, 600, undefined],
      [600, 660, "planned"],
    ]);
    expect(
      recordedTimeMinutes([
        ...manual,
        {
          id: "focus",
          startMinute: 570,
          endMinute: 610,
          color: "focus",
          label: "집중",
          kind: "focus",
        },
      ]),
    ).toBe(70);
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("24:00", true)).toBe(1440);
    expect(parseTimeInput("09:05")).toBeNull();
  });
});
