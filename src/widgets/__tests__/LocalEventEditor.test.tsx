import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalEventEditor } from "../Planner/LocalEventEditor";
import type { DataRecord } from "../toolData";

const DAY = "2026-10-03";
const EVENT: DataRecord = {
  id: "local-1",
  connectionId: "local",
  title: "여행 준비",
  allDay: true,
  startDate: DAY,
  endDate: "2026-10-05",
  startAt: null,
  endAt: null,
  location: "집",
  description: "짐 챙기기",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});

afterEach(cleanup);

it("creates a multi-day all-day event with an exclusive end and keeps the entered details", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(<LocalEventEditor day={DAY} busy={false} onSave={onSave} onClose={onClose} />);
  expect(screen.queryByLabelText("시작 시각")).toBeNull();
  expect(screen.getByRole("checkbox", { name: "종일" })).toHaveProperty("checked", true);
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "가을 여행" } });
  fireEvent.change(screen.getByLabelText("종료 날짜"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("장소"), { target: { value: "부산" } });
  fireEvent.change(screen.getByLabelText("메모"), { target: { value: "예약 확인\n짐 챙기기" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith({
    title: "가을 여행",
    allDay: true,
    startDate: DAY,
    endDate: "2026-10-06",
    startAt: null,
    endAt: null,
    timeZone: null,
    location: "부산",
    description: "예약 확인\n짐 챙기기",
  });
});

it("round-trips an existing all-day event without extending its last day", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <LocalEventEditor event={EVENT} day={DAY} busy={false} onSave={onSave} onClose={vi.fn()} />,
  );
  expect(screen.getByLabelText("종료 날짜")).toHaveProperty("value", "2026-10-04");
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "여행 준비 완료" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ startDate: DAY, endDate: "2026-10-05", title: "여행 준비 완료" }),
  );
  expect(onSave.mock.calls[0][0]).not.toHaveProperty("id");
});

it("rejects a backwards range and saves timed dates in the current local timezone", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<LocalEventEditor day={DAY} busy={false} onSave={onSave} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "야간 작업" } });
  fireEvent.change(screen.getByLabelText("종료 날짜"), { target: { value: "2026-10-02" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(screen.getByRole("alert").textContent).toContain("종료는 시작보다 뒤로");
  expect(onSave).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("종료 날짜"), { target: { value: DAY } });
  fireEvent.click(screen.getByRole("checkbox", { name: "종일" }));
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "00:30" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("종료 날짜"), { target: { value: "2026-10-04" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith({
    title: "야간 작업",
    allDay: false,
    startDate: null,
    endDate: null,
    startAt: new Date(`${DAY}T23:30:00`).getTime(),
    endAt: new Date("2026-10-04T00:30:00").getTime(),
    timeZone: "local",
    location: null,
    description: null,
  });
});

it("preserves failed drafts, guards closing and releases the dirty state on unmount", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(true);
  const onClose = vi.fn();
  const onDirtyChange = vi.fn();
  const { unmount } = render(
    <LocalEventEditor
      event={EVENT}
      day={DAY}
      busy={false}
      onSave={onSave}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
    />,
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText("메모"), { target: { value: "잊지 말아야 할 내용" } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(screen.getByLabelText("메모")).toHaveProperty("value", "잊지 말아야 할 내용");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "일정 편집 닫기" }));
  expect(screen.getByText("저장하지 않은 변경을 버릴까요?")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
  unmount();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("requires deletion confirmation and retains the event on failure", async () => {
  const onDelete = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onClose = vi.fn();
  render(
    <LocalEventEditor
      event={EVENT}
      day={DAY}
      busy={false}
      onSave={vi.fn()}
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "일정 삭제" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("삭제하지 못했어요"));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText("일정 제목")).toHaveProperty("value", "여행 준비");
  fireEvent.click(screen.getByRole("button", { name: "일정 삭제" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("reloads only after explicit discard confirmation and keeps the draft if reloading fails", async () => {
  const onReload = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onClose = vi.fn();
  render(
    <LocalEventEditor
      event={EVENT}
      day={DAY}
      busy={false}
      onSave={vi.fn().mockResolvedValue(false)}
      onReload={onReload}
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "남겨 둘 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByRole("button", { name: "최신 일정 다시 열기" });
  fireEvent.click(screen.getByRole("button", { name: "최신 일정 다시 열기" }));
  expect(onReload).not.toHaveBeenCalled();
  expect(screen.getByLabelText("일정 제목")).toHaveProperty("value", "남겨 둘 초안");
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(onReload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "최신 일정 다시 열기" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 버리고 다시 열기" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("최신 일정을 불러오지 못했어요"),
  );
  expect(screen.getByLabelText("일정 제목")).toHaveProperty("value", "남겨 둘 초안");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "변경 버리고 다시 열기" }));
  await waitFor(() => expect(onReload).toHaveBeenCalledTimes(2));
  expect(onClose).not.toHaveBeenCalled();
});

it("clears obsolete validation feedback as the interval is corrected", () => {
  render(<LocalEventEditor day={DAY} busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "집중 시간" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "종일" }));
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "09:00" } });
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(screen.getByRole("alert").textContent).toContain("종료는 시작보다 뒤로");
  fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "10:00" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("moves an entire timed event across midnight only when length preservation is selected", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<LocalEventEditor day={DAY} busy={false} onSave={onSave} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("일정 제목"), { target: { value: "집중 시간" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "종일" }));
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "09:30" } });
  expect(screen.getByLabelText("종료 시각")).toHaveProperty("value", "10:00");
  fireEvent.click(screen.getByRole("checkbox", { name: /시작 변경 시 종료도 함께 이동/ }));
  fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "23:45" } });
  expect(screen.getByLabelText("종료 시각")).toHaveProperty("value", "00:15");
  expect(screen.getByLabelText("종료 날짜")).toHaveProperty("value", "2026-10-04");
  expect(screen.getByText(/기기 시간대:/).textContent).toContain(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].endAt - onSave.mock.calls[0][0].startAt).toBe(30 * 60000);
});

it("moves all-day dates together without changing inclusive duration", () => {
  render(
    <LocalEventEditor event={EVENT} day={DAY} busy={false} onSave={vi.fn()} onClose={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /시작 변경 시 종료도 함께 이동/ }));
  fireEvent.change(screen.getByLabelText("시작 날짜"), { target: { value: "2026-10-05" } });
  expect(screen.getByLabelText("종료 날짜")).toHaveProperty("value", "2026-10-06");
});

it("shows overlap as advisory, excludes the edited event, and permits saving", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <LocalEventEditor
      event={EVENT}
      events={[EVENT, { ...EVENT, id: "other", title: "다른 일정" }]}
      day={DAY}
      busy={false}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("겹치는 일정 1개: 다른 일정");
  expect(screen.getByRole("status").textContent).toContain("그대로 저장할 수 있어요");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
});

it.skipIf(Intl.DateTimeFormat().resolvedOptions().timeZone !== "America/New_York")(
  "keeps the draft unchanged when a duration-preserving move would create an ambiguous local end",
  () => {
    // Run this timezone-specific regression with TZ=America/New_York.
    render(<LocalEventEditor day="2026-11-01" busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "종일" }));
    fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "00:30" } });
    fireEvent.change(screen.getByLabelText("종료 시각"), { target: { value: "01:30" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /시작 변경 시 종료도 함께 이동/ }));
    fireEvent.change(screen.getByLabelText("시작 시각"), { target: { value: "01:00" } });
    expect(screen.getByRole("alert").textContent).toContain("종료 시각이 두 번 나타나요");
    expect(screen.getByLabelText("시작 시각")).toHaveProperty("value", "00:30");
    expect(screen.getByLabelText("종료 시각")).toHaveProperty("value", "01:30");
  },
);
