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
it("keeps character, OS and mood choices separate and requests OS access only from its button", async () => {
  render(<PlannerAlerts data={{ enabled: true }} act={act} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_notification_permission"));
  fireEvent.click(screen.getByLabelText("캐릭터 말풍선"));
  fireEvent.click(screen.getByLabelText("OS 알림"));
  fireEvent.click(screen.getByLabelText("하루 시작 인사"));
  expect(act).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalledWith("request_planner_notification_permission");
  fireEvent.click(screen.getByRole("button", { name: "알림 설정 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith(
      "configure-alerts",
      expect.objectContaining({
        enabled: true,
        characterEnabled: false,
        osEnabled: true,
        moodDayStart: true,
        moodDayEnd: false,
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("request_planner_notification_permission"),
  );
});
it("snoozes the notification without editing the source task and hides only the current notice", async () => {
  const calendar: WidgetView = {
    id: "calendar",
    kind: "calendar",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: {
      alertState: {
        lastNotification: { observedAt: Date.now(), text: "책 반납 시간이 가까워졌어요." },
      },
    },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  render(<PlannerAlertNotice widget={calendar} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "10분 뒤 다시 알림" }));
  expect(act).toHaveBeenCalledExactlyOnceWith("snooze-alert", {}, calendar);
  fireEvent.click(screen.getByRole("button", { name: "이 알림 닫기" }));
  expect(screen.queryByRole("complementary", { name: "생활 알림" })).toBeNull();
  expect(act).toHaveBeenCalledTimes(1);
});
