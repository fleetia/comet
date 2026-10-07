import { afterEach, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FocusTimerSettings } from "./FocusTimerSettings";
import type { ToolAction, DataRecord } from "../toolData";
import type { WidgetView } from "../types";

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
  expect(act).toHaveBeenNthCalledWith(1, "configure-settings", { restDurationMs: 600000 });
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
