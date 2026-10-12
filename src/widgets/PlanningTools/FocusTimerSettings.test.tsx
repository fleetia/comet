import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
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
afterEach(cleanup);
it("restores a custom lead time and preserves unrelated reminder flags when saving sound", async () => {
  const reminders = {
    enabled: true,
    leadMinutes: 17,
    characterEnabled: false,
    osEnabled: true,
    soundEnabled: false,
    includeAllDay: true,
    moodDayStart: true,
    moodFocusStart: true,
    moodBreak: true,
    moodDayEnd: true,
    dayStart: "08:30",
    dayEnd: "22:15",
  };
  const calendar = widget("calendar", { reminders });
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <FocusTimerSettings
      widget={widget("focus-timer", { settings: { restDurationMs: 600000 } })}
      calendar={calendar}
      act={act}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("일정 시작 알람")).toHaveProperty("value", "custom");
  expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", "17");
  fireEvent.click(screen.getByLabelText("알림 소리"));
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "설정 저장" })));
  expect(act).toHaveBeenNthCalledWith(1, "configure-settings", { restDurationMs: 600000 }, widget("focus-timer", { settings: { restDurationMs: 600000 } }));
  expect(act).toHaveBeenNthCalledWith(
    2,
    "configure-alerts",
    { ...reminders, soundEnabled: true },
    calendar,
  );
});

it("retains a zero-minute lead setting when disabling calendar alarms", async () => {
  const calendar = widget("calendar", { reminders: { enabled: true, leadMinutes: 0 } });
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <FocusTimerSettings
      widget={widget("focus-timer", {})}
      calendar={calendar}
      act={act}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("일정 시작 알람"), { target: { value: "off" } });
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "설정 저장" })));
  expect(act).toHaveBeenLastCalledWith(
    "configure-alerts",
    expect.objectContaining({ enabled: false, leadMinutes: 0 }),
    calendar,
  );
});

it("validates and saves each domain independently while cancel preserves the other draft", async () => {
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const calendar = widget("calendar", { reminders: { enabled: true, leadMinutes: 10, includeAllDay: true } });
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  const close = vi.fn();
  render(<FocusTimerSettings widget={timer} calendar={calendar} act={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("일정 시작 알람"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("알람 시간 직접 입력 (분 전)"), { target: { value: "" } });
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "휴식 시간 저장" })));
  expect(save).toHaveBeenCalledExactlyOnceWith("configure-settings", { restDurationMs: 720000 }, timer);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain("120분");
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("알람 시간 직접 입력 (분 전)"), { target: { value: "17" } });
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
  expect(save).toHaveBeenLastCalledWith("configure-alerts", expect.objectContaining({ leadMinutes: 17, includeAllDay: true }), calendar);
  fireEvent.click(screen.getByRole("button", { name: "휴식 변경 취소" }));
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", "17");
});

it("keeps invalid drafts and requires finite rest and integer lead bounds", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<FocusTimerSettings widget={widget("focus-timer", {})} calendar={widget("calendar", { reminders: { enabled: true, leadMinutes: 10 } })} act={save} onClose={vi.fn()} />);
  for (const value of ["", "0", "181"]) {
    fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value } });
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "휴식 시간 저장" })));
    expect(screen.getByRole("alert").textContent).toContain("1~180");
  }
  fireEvent.change(screen.getByLabelText("일정 시작 알람"), { target: { value: "custom" } });
  for (const value of ["1.5", "-1", "121"]) {
    fireEvent.change(screen.getByLabelText("알람 시간 직접 입력 (분 전)"), { target: { value } });
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
    expect(screen.getByRole("alert").textContent).toContain("120분");
    expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", value);
  }
  expect(save).not.toHaveBeenCalled();
});

it("syncs pristine fields but retains edited conflicts until their own cancel", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  const props = { widget: widget("focus-timer", { settings: { restDurationMs: 300000 } }), calendar: widget("calendar", { reminders: { enabled: true, leadMinutes: 10 } }), act: save, onClose: vi.fn() };
  const view = render(<FocusTimerSettings {...props} />);
  const latest = { widget: { ...props.widget, revision: 2, data: { settings: { restDurationMs: 480000 } } }, calendar: { ...props.calendar, revision: 2, data: { reminders: { enabled: true, leadMinutes: 15 } } } };
  view.rerender(<FocusTimerSettings {...props} {...latest} />);
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "8");
  expect(screen.getByLabelText("일정 시작 알람")).toHaveProperty("value", "15");
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("일정 시작 알람"), { target: { value: "30" } });
  const changed = { widget: { ...latest.widget, revision: 3, data: { settings: { restDurationMs: 540000 } } }, calendar: { ...latest.calendar, revision: 3, data: { reminders: { enabled: true, leadMinutes: 5 } } } };
  view.rerender(<FocusTimerSettings {...props} {...changed} />);
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("button", { name: "휴식 시간 저장" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "일정 알림 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "휴식 변경 취소" }));
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "9");
  expect(screen.getByLabelText("일정 시작 알람")).toHaveProperty("value", "30");
  fireEvent.click(screen.getByRole("button", { name: "알림 변경 취소" }));
  expect(screen.getByLabelText("일정 시작 알람")).toHaveProperty("value", "5");
  fireEvent.click(screen.getByLabelText("알림 소리"));
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
  expect(save).toHaveBeenCalledExactlyOnceWith("configure-alerts", expect.objectContaining({ leadMinutes: 5, soundEnabled: true }), changed.calendar);
});

it("reports partial whole-save success, retains failed alerts, and locks duplicate submissions", async () => {
  const pending = deferred<boolean>();
  const save = vi.fn<ToolAction>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(false).mockResolvedValue(true);
  const close = vi.fn();
  const timer = widget("focus-timer", {});
  const calendar = widget("calendar", { reminders: { enabled: true, leadMinutes: 10 } });
  render(<FocusTimerSettings widget={timer} calendar={calendar} act={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  fireEvent.click(screen.getByLabelText("알림 소리"));
  const form = screen.getByRole("button", { name: "설정 저장" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(save).toHaveBeenCalledTimes(1);
  await reactAct(async () => pending.resolve(true));
  expect(screen.getByRole("status").textContent).toContain("휴식 시간은 저장");
  expect(screen.getByRole("alert").textContent).toContain("입력은 남아");
  expect(screen.getByLabelText("알림 소리")).toHaveProperty("checked", true);
  expect(close).not.toHaveBeenCalled();
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
  expect(save).toHaveBeenLastCalledWith("configure-alerts", expect.objectContaining({ soundEnabled: true }), calendar);
});

it("rejects obsolete success after same-ID revisions and an A-B-A editor scope", async () => {
  const pending = deferred<boolean>();
  const save = vi.fn<ToolAction>().mockReturnValue(pending.promise);
  const close = vi.fn();
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const view = render(<FocusTimerSettings widget={timer} act={save} onClose={close} />);
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  fireEvent.submit(screen.getByRole("button", { name: "설정 저장" }).closest("form")!);
  view.rerender(<FocusTimerSettings widget={{ ...timer, revision: 3, data: { settings: { restDurationMs: 300000 } } }} act={save} onClose={close} />);
  await reactAct(async () => pending.resolve(true));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");

  const second = deferred<boolean>(); save.mockReturnValue(second.promise);
  fireEvent.submit(screen.getByRole("button", { name: "설정 저장" }).closest("form")!);
  view.rerender(<FocusTimerSettings widget={{ ...timer, id: "timer-B" }} act={save} onClose={close} />);
  view.rerender(<FocusTimerSettings widget={timer} act={save} onClose={close} />);
  await reactAct(async () => second.resolve(true));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "5");
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps the latest notification permission and ignores unmounted request completion", async () => {
  const initial = deferred<string>(); const request = deferred<string>();
  vi.mocked(command).mockImplementation((name) => name === "get_planner_notification_permission" ? initial.promise : request.promise);
  const view = render(<FocusTimerSettings widget={widget("focus-timer", {})} calendar={widget("calendar", {})} act={vi.fn<ToolAction>()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  await reactAct(async () => request.resolve("granted"));
  await reactAct(async () => initial.resolve("denied"));
  expect(screen.getByText(/OS 알림: 허용됨/)).toBeTruthy();
  const later = deferred<string>(); vi.mocked(command).mockReturnValue(later.promise);
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  expect(command).toHaveBeenCalledTimes(3);
  view.unmount();
  later.resolve("denied");
  await later.promise;
  await reactAct(async () => {});
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["continue", "escape"])("keeps editing after %s dismisses the native close confirmation", async (dismiss) => {
  const prototype = HTMLDialogElement.prototype;
  const previousShow = Object.getOwnPropertyDescriptor(prototype, "showModal");
  const previousClose = Object.getOwnPropertyDescriptor(prototype, "close");
  Object.defineProperty(prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
      queueMicrotask(() => this.dispatchEvent(new Event("close")));
    },
  });
  try {
    const save = vi.fn<ToolAction>().mockResolvedValue(true);
    const close = vi.fn();
    const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
    const calendar = widget("calendar", { reminders: { enabled: true, leadMinutes: 10 } });
    render(<FocusTimerSettings widget={timer} calendar={calendar} act={save} onClose={close} />);
    fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("일정 시작 알람"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "설정 닫기" }));
    const confirmation = screen.getByRole("dialog", { name: "설정 변경을 버릴까요?" });
    await reactAct(async () => {
      if (dismiss === "continue") {
        fireEvent.click(within(confirmation).getByRole("button", { name: "계속 편집" }));
      } else {
        fireEvent(confirmation, new Event("cancel", { cancelable: true }));
      }
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "설정 변경을 버릴까요?" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "집중 설정" })).toHaveProperty("open", true);
    expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "");
    expect(screen.getByLabelText("일정 시작 알람")).toHaveProperty("value", "15");
    expect(close).not.toHaveBeenCalled();
    await reactAct(async () => fireEvent.click(screen.getByRole("button", { name: "일정 알림 저장" })));
    expect(save).toHaveBeenCalledExactlyOnceWith("configure-alerts", expect.objectContaining({ leadMinutes: 15 }), calendar);
    expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "");
  } finally {
    cleanup();
    if (previousShow) Object.defineProperty(prototype, "showModal", previousShow);
    else Reflect.deleteProperty(prototype, "showModal");
    if (previousClose) Object.defineProperty(prototype, "close", previousClose);
    else Reflect.deleteProperty(prototype, "close");
  }
});
