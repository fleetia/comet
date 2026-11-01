import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlannerAlerts, PlannerAlertNotice } from "./PlannerAlerts";
import { command } from "../../hooks/useSnapshot";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const act = vi.fn<ToolAction>();
beforeEach(() => {
  act.mockReset();
  act.mockResolvedValue(true);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue("prompt");
});
afterEach(cleanup);
it("keeps character, OS and mood choices separate and requests OS access when enabled", async () => {
  render(<PlannerAlerts data={{ enabled: true, soundEnabled: true }} act={act} />);
  expect(screen.queryByLabelText("조용한 시간 시작")).toBeNull();
  expect(screen.queryByRole("button", { name: "생활 알림 1시간 쉬기" })).toBeNull();
  expect(screen.getByText(/조용한 시간은 설정 → 대화에서 함께 정해요/)).toBeTruthy();
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_notification_permission"));
  fireEvent.click(screen.getByLabelText("친구 말풍선"));
  fireEvent.click(screen.getByLabelText("시스템 알림"));
  fireEvent.click(screen.getByLabelText("하루 시작 인사"));
  expect(act).not.toHaveBeenCalled();
  await waitFor(() => expect(command).toHaveBeenCalledWith("request_planner_notification_permission"));
  fireEvent.click(screen.getByRole("button", { name: "알림 설정 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith(
      "configure-alerts",
      expect.objectContaining({
        enabled: true,
        characterEnabled: false,
        osEnabled: true,
        soundEnabled: true,
        moodDayStart: true,
        moodDayEnd: false,
      }),
    ),
  );
});
it("warns when saving OS alerts without permission", async () => {
  vi.mocked(command).mockImplementation(async (name) => name === "request_planner_notification_permission" ? "denied" : "prompt");
  render(<PlannerAlerts data={{ enabled: true }} act={act} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_notification_permission"));
  fireEvent.click(screen.getByLabelText("시스템 알림"));
  await screen.findByText(/시스템 알림:.*꺼짐/);
  fireEvent.click(screen.getByRole("button", { name: "알림 설정 저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("시스템 알림 권한이 꺼져 있어");
});
it("snoozes the notification without editing the source task and hides only the current notice", async () => {
  const calendar: WidgetView = {
    id: "calendar",
    kind: "calendar",
    reaction: true,
    revision: 1,
    version: 1,
    data: {
      alertState: {
        lastNotification: { observedAt: Date.now(), text: "책 반납 시간이 가까워졌어요.", targets: [{ kind: "todo", id: "book" }] },
      },
    },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  render(<PlannerAlertNotice widget={calendar} act={act} />);
  expect(screen.queryByRole("button", { name: "1시간 쉬기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "10분 뒤 다시 알림" }));
  expect(act).toHaveBeenCalledExactlyOnceWith("snooze-alert", {}, calendar);
  fireEvent.click(screen.getByRole("button", { name: "이 알림 닫기" }));
  expect(screen.queryByRole("complementary", { name: "생활 알림" })).toBeNull();
  expect(act).toHaveBeenCalledTimes(1);
});

it("shows an overflow notice without an unusable snooze action", () => {
  const calendar: WidgetView = {
    id: "calendar", kind: "calendar", reaction: true, revision: 1, version: 1,
    data: { alertState: { lastNotification: { observedAt: Date.now(), text: "타이머가 끝났어요.", targets: [{ kind: "preparation" }] } } },
    error: null, missing: [], status: "enabled", packageBytes: 1,
  };
  render(<PlannerAlertNotice widget={calendar} act={act} />);
  expect(screen.getByText("타이머가 끝났어요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "10분 뒤 다시 알림" })).toBeNull();
});

it("shows a saved delivery failure and clears it through the widget action", async () => {
  const calendar: WidgetView = {
    id: "calendar", kind: "calendar", reaction: true, revision: 1, version: 1,
    data: { alertState: { lastDeliveryError: "알림을 보내지 못했어요." } },
    error: null, missing: [], status: "enabled", packageBytes: 1,
  };
  const view = render(<PlannerAlertNotice widget={calendar} act={act} />);
  expect(screen.getByRole("alert").textContent).toContain("알림을 보내지 못했어요.");
  fireEvent.click(screen.getByRole("button", { name: "알림 오류 닫기" }));
  expect(act).toHaveBeenCalledWith("clear-notification-error", {}, calendar);
  view.rerender(<PlannerAlertNotice widget={{ ...calendar, data: { alertState: {} } }} act={act} />);
  expect(screen.queryByRole("alert")).toBeNull();
});
