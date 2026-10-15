import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PreparationCreate } from "../PreparationTool/PreparationCreate";
import { PreparationSettings } from "../PreparationTool/PreparationSettings";
import type { WidgetView } from "../types";

afterEach(cleanup);

it("keeps the identical creation request after a lost response and guards double submits", async () => {
  let rejectRequest: (cause: Error) => void = () => {};
  const onCreate = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((_, reject) => {
          rejectRequest = reject;
        }),
    )
    .mockResolvedValueOnce(true);
  render(<PreparationCreate events={[]} busy={false} onCreate={onCreate} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "봉투 이름" }), {
    target: { value: "여행 준비" },
  });
  fireEvent.change(screen.getByLabelText("챙길 것"), { target: { value: "카메라\n충전기" } });
  fireEvent.change(screen.getByLabelText("준비할 일"), { target: { value: "occasion" } });
  fireEvent.change(screen.getByLabelText("알림"), { target: { value: "3" } });
  const form = screen.getByRole("button", { name: "만들기" }).closest("form");
  if (!form) throw new Error("missing creation form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(onCreate.mock.calls[0][0]).toMatchObject({
    title: "여행 준비",
    checks: ["카메라", "충전기"],
    reminderDays: 3,
  });
  expect(onCreate.mock.calls[0][0].tasks).toHaveLength(5);
  rejectRequest(new Error("response lost"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장"));
  expect(screen.getByRole("textbox", { name: "봉투 이름" })).toHaveProperty("value", "여행 준비");
  fireEvent.click(screen.getByRole("button", { name: "같은 요청으로 다시 시도" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  expect(onCreate.mock.calls[1]).toEqual(onCreate.mock.calls[0]);
});

it("creates a dated envelope and excludes an unselected event", async () => {
  const onCreate = vi.fn().mockResolvedValue(false);
  render(
    <PreparationCreate
      events={[{ id: "event", title: "모임", allDay: true, startDate: "2026-10-31" }]}
      busy={false}
      onCreate={onCreate}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "봉투 이름" }), {
    target: { value: "모임 준비" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "날짜만" }));
  fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-10-31" } });
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  expect(onCreate.mock.calls[0][0]).toEqual({
    title: "모임 준비",
    date: "2026-10-31",
    checks: [],
    tasks: [],
    reminderDays: null,
  });
});

it("saves preparation settings independently and preserves the saved value on failure", async () => {
  const widget: WidgetView = {
    id: "preparation",
    kind: "preparation",
    version: 1,
    installed: true,
    enabled: true,
    revision: 2,
    data: { envelopes: [], reminderDays: 0, askArchiveAfterEnd: false },
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 1,
  };
  const act = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<PreparationSettings widget={widget} widgets={[]} act={act} />);
  fireEvent.change(screen.getByRole("combobox", { name: "준비 알림" }), { target: { value: "3" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요"));
  expect(screen.getByRole("combobox", { name: "준비 알림" })).toHaveProperty("value", "0");
  fireEvent.click(screen.getByRole("switch", { name: "일정이 끝나면 보관할지 묻기" }));
  await waitFor(() =>
    expect(act).toHaveBeenLastCalledWith("configure", { askArchiveAfterEnd: true }, widget),
  );
});
