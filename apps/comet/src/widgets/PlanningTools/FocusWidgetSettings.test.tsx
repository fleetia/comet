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

it("configures the default focus duration only when saved", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(
    <FocusWidgetSettings widget={widget({ status: "idle", focusDurationMs: 1500000 })} act={act} />,
  );
  fireEvent.change(screen.getByLabelText("기본 집중 시간 (분)"), { target: { value: "30" } });
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "집중 시간 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith("configure", { durationMs: 1800000 }),
  );
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

it("preserves a duration draft when another window saves and requires resolving the conflict", () => {
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
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("value", "30");
  expect(screen.getByRole("button", { name: "집중 시간 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "집중 시간 변경 취소" }));
  expect(screen.getByLabelText("기본 집중 시간 (분)")).toHaveProperty("value", "45");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(act).not.toHaveBeenCalled();
});

it("reports a rejected save and unlocks both the immediate and embedded settings", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "집중 시간 저장" }));
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByLabelText("휴식 시간 (분)").matches(":disabled")).toBe(true);
  await reactAct(async () => reject("저장 연결 실패"));
  expect(screen.getByRole("alert").textContent).toBe("저장 연결 실패");
  expect(screen.getByLabelText("휴식 시간 (분)").matches(":disabled")).toBe(false);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(act).toHaveBeenCalledTimes(1);
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
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "응원 설정 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "configure-alerts",
      { ...reminders, moodFocusStart: true },
      calendar,
    ),
  );
});
