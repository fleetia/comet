import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
/** Lets the debounced autosave run. */
async function settle(): Promise<void> {
  await reactAct(async () => new Promise((resolve) => setTimeout(resolve, 650)));
}
it("has no save buttons and saves timer-owned settings immediately without changing calendar reminders", async () => {
  const timer = widget("focus-timer", {
    settings: { restDurationMs: 600000, linkedEventLeadMinutes: 17 },
  });
  const calendar = widget("calendar", {
    reminders: { enabled: true, leadMinutes: 30, osEnabled: false, soundEnabled: false },
  });
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<FocusTimerSettings widget={timer} calendar={calendar} act={act} />);
  expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
  expect(screen.getByLabelText("연결한 일정 시작 전 알리기")).toHaveProperty("value", "custom");
  expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", "17");
  fireEvent.click(screen.getByRole("radio", { name: "둘 다" }));
  fireEvent.change(screen.getByLabelText("알림 소리"), { target: { value: "system" } });
  fireEvent.click(screen.getByRole("switch", { name: "집중이 끝나면 휴식 바로 시작" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "configure-settings",
      {
        restDurationMs: 600000,
        autoStartRest: true,
        continuous: false,
        longRestDurationMs: 900000,
        longRestEvery: 4,
        finishNotification: "both",
        finishSoundEnabled: true,
        linkedEventLeadMinutes: 17,
        recordTimeline: true,
      },
      timer,
    ),
  );
  await settle();
  expect(act).toHaveBeenCalledTimes(1);
});
it("keeps focus settings available without a calendar and disables unsupported cheering", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const timer = widget("focus-timer", {});
  render(<FocusTimerSettings widget={timer} act={act} />);
  expect(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("switch", { name: "시간표에 집중 칸 칠하기" }));
  fireEvent.change(screen.getByLabelText("연결한 일정 시작 전 알리기"), { target: { value: "0" } });
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "configure-settings",
      expect.objectContaining({ recordTimeline: false, linkedEventLeadMinutes: 0 }),
      timer,
    ),
  );
});
it("retains invalid rest and lead drafts with an error and never sends them", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<FocusTimerSettings widget={widget("focus-timer", {})} act={save} />);
  for (const value of ["", "0", "181"]) {
    fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value } });
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("1~180");
    expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", value);
  }
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("연결한 일정 시작 전 알리기"), {
    target: { value: "custom" },
  });
  for (const value of ["", "1.5", "-1", "121"]) {
    fireEvent.change(screen.getByLabelText("알람 시간 직접 입력 (분 전)"), { target: { value } });
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("120분");
    expect(screen.getByLabelText("알람 시간 직접 입력 (분 전)")).toHaveProperty("value", value);
  }
  expect(save).not.toHaveBeenCalled();
});
it("syncs pristine fields but keeps a conflicting draft unsaved until the latest value is loaded", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValue(true);
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const view = render(<FocusTimerSettings widget={timer} act={save} />);
  view.rerender(
    <FocusTimerSettings
      widget={{ ...timer, revision: 2, data: { settings: { restDurationMs: 480000 } } }}
      act={save}
    />,
  );
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "8");
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  view.rerender(
    <FocusTimerSettings
      widget={{ ...timer, revision: 3, data: { settings: { restDurationMs: 540000 } } }}
      act={save}
    />,
  );
  await settle();
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  await click("최신 값 불러오기");
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "9");
  expect(save).not.toHaveBeenCalled();
});
it("keeps a failed input with an error and retries only when asked", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValueOnce(false).mockResolvedValue(true);
  const onDirtyChange = vi.fn();
  render(
    <FocusTimerSettings
      widget={widget("focus-timer", {})}
      act={save}
      onDirtyChange={onDirtyChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("입력은 남아"));
  await settle();
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  await click("다시 저장");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenLastCalledWith(
    "configure-settings",
    expect.objectContaining({ restDurationMs: 720000 }),
    expect.objectContaining({ id: "focus-timer-id" }),
  );
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});
it("saves cheering immediately and keeps a failed choice without repeating it", async () => {
  const save = vi.fn<ToolAction>().mockResolvedValueOnce(false).mockResolvedValue(true);
  const reminders = { enabled: true, leadMinutes: 10, includeAllDay: true, moodBreak: true };
  const calendar = widget("calendar", { reminders });
  render(<FocusTimerSettings widget={widget("focus-timer", {})} calendar={calendar} act={save} />);
  fireEvent.click(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith(
      "configure-alerts",
      { ...reminders, moodFocusStart: true },
      calendar,
    ),
  );
  expect(screen.getByRole("alert").textContent).toContain("입력은 남아");
  expect(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" })).toHaveProperty(
    "checked",
    true,
  );
  await settle();
  expect(save).toHaveBeenCalledTimes(1);
  await click("다시 저장");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
});
it("rejects an obsolete success after a newer snapshot and A-B-A scope changes", async () => {
  const pending = deferred<boolean>();
  const save = vi.fn<ToolAction>().mockReturnValue(pending.promise);
  const timer = widget("focus-timer", { settings: { restDurationMs: 300000 } });
  const view = render(<FocusTimerSettings widget={timer} act={save} />);
  fireEvent.change(screen.getByLabelText("휴식 시간 (분)"), { target: { value: "12" } });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  view.rerender(<FocusTimerSettings widget={{ ...timer, revision: 3 }} act={save} />);
  await reactAct(async () => pending.resolve(true));
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "12");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  await settle();
  expect(save).toHaveBeenCalledTimes(1);
  const second = deferred<boolean>();
  save.mockReturnValue(second.promise);
  await click("다시 저장");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  view.rerender(<FocusTimerSettings widget={{ ...timer, id: "timer-B" }} act={save} />);
  view.rerender(<FocusTimerSettings widget={timer} act={save} />);
  await reactAct(async () => second.resolve(true));
  expect(screen.getByLabelText("휴식 시간 (분)")).toHaveProperty("value", "5");
  expect(screen.queryByRole("alert")).toBeNull();
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
    />,
  );
  fireEvent.click(screen.getByText("알림 설정"));
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
