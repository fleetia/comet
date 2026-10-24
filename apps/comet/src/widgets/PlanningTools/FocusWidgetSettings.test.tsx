// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
import { afterEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FocusWidgetSettings } from "./FocusWidgetSettings";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => false,
  errorText: (cause: unknown) => String(cause),
}));

function widget(data: DataRecord): WidgetView {
  return {
    id: "focus",
    kind: "focus-timer",
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

async function settle(): Promise<void> {
  await reactAct(async () => new Promise((resolve) => setTimeout(resolve, 650)));
}

it("saves the default focus duration shortly after typing without a save button", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <FocusWidgetSettings widget={widget({ status: "idle", focusDurationMs: 1500000 })} act={act} />,
  );
  fireEvent.change(screen.getByLabelText("기본 집중 시간 (분)"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("기본 집중 시간 (분)"), { target: { value: "30" } });
  expect(act).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith("configure", { durationMs: 1800000 }),
  );
  await settle();
  expect(act).toHaveBeenCalledTimes(1);
});

it("locks duration while a timer runs", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <FocusWidgetSettings
      widget={widget({ status: "running", focusDurationMs: 1500000 })}
      act={act}
    />,
  );
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("disabled", true);
  expect(act).not.toHaveBeenCalled();
});

it("keeps a duration draft unsaved when another window saves until the latest value is loaded", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const onDirtyChange = vi.fn();
  const timer = widget({ status: "idle", focusDurationMs: 1500000 });
  const view = render(
    <FocusWidgetSettings widget={timer} act={act} onDirtyChange={onDirtyChange} />,
  );
  fireEvent.change(screen.getByLabelText("기본 집중 시간 (분)"), { target: { value: "30" } });
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  view.rerender(
    <FocusWidgetSettings
      widget={{ ...timer, revision: 2, data: { status: "idle", focusDurationMs: 2700000 } }}
      act={act}
      onDirtyChange={onDirtyChange}
    />,
  );
  await settle();
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("value", "30");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  fireEvent.click(screen.getByRole("button", { name: "최신 값 불러오기" }));
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("value", "45");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(act).not.toHaveBeenCalled();
});

it("keeps the typed duration after a rejected save and unlocks the other settings", async () => {
  let reject!: (error: unknown) => void;
  const act = vi.fn<ToolAction>().mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const onBusyChange = vi.fn();
  render(
    <FocusWidgetSettings
      widget={widget({ status: "idle", focusDurationMs: 1500000 })}
      act={act}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("기본 집중 시간 (분)"), { target: { value: "30" } });
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(screen.getByLabelText("휴식 시간 (분)").matches(":disabled")).toBe(true);
  await reactAct(async () => reject("저장 연결 실패"));
  expect(screen.getByRole("alert").textContent).toBe("저장 연결 실패");
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("value", "30");
  expect(screen.getByLabelText("휴식 시간 (분)").matches(":disabled")).toBe(false);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await settle();
  expect(act).toHaveBeenCalledTimes(1);
  act.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 저장" }));
  await waitFor(() => expect(act).toHaveBeenCalledTimes(2));
});

it("saves focus cheering through the calendar reminders without changing unrelated flags", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const reminders = {
    enabled: true,
    leadMinutes: 10,
    characterEnabled: true,
    includeAllDay: true,
    moodBreak: true,
  };
  const calendar = { ...widget({ reminders }), id: "calendar", kind: "calendar" };
  render(<FocusWidgetSettings widget={widget({ status: "idle" })} calendar={calendar} act={act} />);
  fireEvent.click(screen.getByRole("switch", { name: "친구가 시작할 때 응원하기" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "configure-alerts",
      { ...reminders, moodFocusStart: true },
      calendar,
    ),
  );
});
