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
import { FocusTimerSettings } from "./FocusTimerSettings";
import type { ToolAction, DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { command } from "../../hooks/useSnapshot";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => String(cause),
}));
beforeEach(() => vi.mocked(command).mockReset().mockResolvedValue("prompt"));
afterEach(cleanup);
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function widget(kind: string, data: DataRecord): WidgetView {
  return {
    id: `${kind}-id`,
    kind,
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
async function click(name: string): Promise<void> {
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name })));
}
function submit(): void {
  const form = screen.getByRole("button", { name: "설정 저장" }).closest("form");
  if (!form) throw new Error("Settings form is missing");
  fireEvent.submit(form);
}
it("saves timer-owned completion and linked-event settings without changing calendar reminders", async () => {
  const timer = widget("focus-timer", {
    settings: { restDurationMs: 600000, linkedEventLeadMinutes: 17 },
  });
  const calendar = widget("calendar", {
    reminders: { enabled: true, leadMinutes: 30, osEnabled: false, soundEnabled: false },
  });
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<FocusTimerSettings widget={timer} calendar={calendar} act={act} onClose={vi.fn()} />);
  expect(screen.getByLabelText("연결한 일정 시작 전 알리기")).toHaveProperty("value", "custom");
  expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", "17");
  fireEvent.click(screen.getByRole("radio", { name: "둘 다" }));
  fireEvent.change(screen.getByLabelText("알림 소리"), { target: { value: "system" } });
  fireEvent.click(screen.getByRole("switch", { name: "집중이 끝나면 휴식 바로 시작" }));
  await click("설정 저장");
  expect(act).toHaveBeenCalledExactlyOnceWith(
    "configure-settings",
    {
      restDurationMs: 600000,
      autoStartRest: true,
      finishNotification: "both",
      finishSoundEnabled: true,
      linkedEventLeadMinutes: 17,
      recordTimeline: true,
    },
    timer,
  );
});
it("keeps focus settings available without a calendar and disables unsupported cheering", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const timer = widget("focus-timer", {});
  render(<FocusTimerSettings widget={timer} act={act} onClose={vi.fn()} />);
  expect(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("switch", { name: "시간표에 집중 칸 칠하기" }));
  fireEvent.change(screen.getByLabelText("연결한 일정 시작 전 알리기"), { target: { value: "0" } });
  await click("설정 저장");
  expect(act).toHaveBeenCalledExactlyOnceWith(
    "configure-settings",
    expect.objectContaining({ recordTimeline: false, linkedEventLeadMinutes: 0 }),
    timer,
  );
});
it("retains invalid duration and lead drafts and rejects them before calling the backend", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<FocusTimerSettings widget={widget("focus-timer", {})} act={save} onClose={vi.fn()} />);
  for (const value of ["", "0", "181"]) {
    fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value } });
    await reactAct(async () => submit());
    expect(screen.getByRole("alert").textContent).toContain("1~180");
    expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", value);
  }
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("연결한 일정 시작 전 알리기"), {
    target: { value: "custom" },
  });
  for (const value of ["", "1.5", "-1", "121"]) {
    fireEvent.change(screen.getByLabelText("알람 시간 직접 입력 (분 전)"), { target: { value } });
    await reactAct(async () => submit());
    expect(screen.getByRole("alert").textContent).toContain("120분");
    expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", value);
  }
  expect(save).not.toHaveBeenCalled();
});
it("syncs pristine fields but preserves dirty conflicts until reset", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const props = { widget: timer, act: save, onClose: vi.fn() };
  const view = render(<FocusTimerSettings {...props} />);
  view.rerender(
    <FocusTimerSettings
      {...props}
      widget={{ ...timer, revision: 2, data: { settings: { restDurationMs: 480000 } } }}
    />,
  );
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "8");
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  view.rerender(
    <FocusTimerSettings
      {...props}
      widget={{ ...timer, revision: 3, data: { settings: { restDurationMs: 540000 } } }}
    />,
  );
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", true);
  await click("변경 취소");
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "9");
  expect(save).not.toHaveBeenCalled();
});
it("reports partial save, preserves failed cheering, and prevents duplicate submissions", async () => {
  const pending = deferred<boolean>();
  const save = vi
    .fn<ToolAction>()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  const close = vi.fn();
  const reminders = { enabled: true, leadMinutes: 10, includeAllDay: true, moodBreak: true };
  const calendar = widget("calendar", { reminders });
  render(
    <FocusTimerSettings
      widget={widget("focus-timer", {})}
      calendar={calendar}
      act={save}
      onClose={close}
    />,
  );
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" }));
  const form = screen.getByRole("button", { name: "설정 저장" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(save).toHaveBeenCalledTimes(1);
  await reactAct(async () => pending.resolve(true));
  expect(screen.getByRole("status").textContent).toContain("집중 설정은 저장");
  expect(screen.getByRole("alert").textContent).toContain("입력은 남아");
  expect(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" })).toHaveProperty(
    "checked",
    true,
  );
  expect(close).not.toHaveBeenCalled();
  await click("응원 설정 저장");
  expect(save).toHaveBeenLastCalledWith(
    "configure-alerts",
    { ...reminders, moodFocusStart: true },
    calendar,
  );
});
it("rejects obsolete successes after a newer same-ID snapshot and A-B-A scope changes", async () => {
  const pending = deferred<boolean>();
  const save = vi.fn<ToolAction>().mockReturnValue(pending.promise);
  const close = vi.fn();
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const view = render(<FocusTimerSettings widget={timer} act={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  submit();
  view.rerender(
    <FocusTimerSettings widget={{ ...timer, revision: 3 }} act={save} onClose={close} />,
  );
  await reactAct(async () => pending.resolve(true));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  const second = deferred<boolean>();
  save.mockReturnValue(second.promise);
  submit();
  view.rerender(
    <FocusTimerSettings widget={{ ...timer, id: "timer-B" }} act={save} onClose={close} />,
  );
  view.rerender(<FocusTimerSettings widget={timer} act={save} onClose={close} />);
  await reactAct(async () => second.resolve(true));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "5");
  expect(screen.queryByRole("status")).toBeNull();
});
it("keeps the latest permission result and ignores unmounted completion", async () => {
  const initial = deferred<string>();
  const request = deferred<string>();
  vi.mocked(command).mockImplementation((name) =>
    name === "get_planner_notification_permission" ? initial.promise : request.promise,
  );
  const view = render(
    <FocusTimerSettings
      widget={widget("focus-timer", {})}
      act={vi.fn<ToolAction>()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  await reactAct(async () => request.resolve("granted"));
  await reactAct(async () => initial.resolve("denied"));
  expect(screen.getByText(/OS 알림: 허용됨/)).toBeTruthy();
  const later = deferred<string>();
  vi.mocked(command).mockReturnValue(later.promise);
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  view.unmount();
  await reactAct(async () => later.resolve("denied"));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps dirty drafts after dismissing close confirmation", async () => {
  const close = vi.fn();
  render(
    <FocusTimerSettings
      widget={widget("focus-timer", {})}
      act={vi.fn<ToolAction>()}
      onClose={close}
    />,
  );
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  await click("취소");
  const confirmation = screen.getByRole("dialog", { name: "설정 변경을 버릴까요?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "계속 편집" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "설정 변경을 버릴까요?" })).toBeNull(),
  );
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(close).not.toHaveBeenCalled();
});
