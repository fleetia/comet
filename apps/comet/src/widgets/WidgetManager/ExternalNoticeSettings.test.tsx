import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { ExternalNoticeSettings } from "./ExternalNoticeSettings";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => String(cause),
}));
beforeEach(() => vi.mocked(command).mockReset());
afterEach(cleanup);

const widget: WidgetView = {
  id: "external-notice", kind: "external-notice", installed: true, enabled: true,
  revision: 1, version: 1, data: { osNotifications: false }, error: null,
  missing: [], status: "enabled", packageBytes: 1,
};

it("requests permission explicitly before enabling OS delivery", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "request_planner_notification_permission" ? "granted" : "prompt",
  );
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<ExternalNoticeSettings widget={widget} act={act} onDirtyChange={vi.fn()} onBusyChange={vi.fn()} />);
  await screen.findByText(/권한 요청 전/);
  expect((screen.getByLabelText("OS 알림 병행") as HTMLInputElement).disabled).toBe(true);
  expect(command).not.toHaveBeenCalledWith("request_planner_notification_permission");
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  await screen.findByText(/허용됨/);
  fireEvent.click(screen.getByLabelText("OS 알림 병행"));
  await waitFor(() => expect(act).toHaveBeenCalledWith("configure", { osNotifications: true }));
});

it("leaves delivery disabled when permission is denied", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "request_planner_notification_permission" ? "denied" : "prompt",
  );
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  render(<ExternalNoticeSettings widget={widget} act={act} onDirtyChange={vi.fn()} onBusyChange={vi.fn()} />);
  await screen.findByText(/권한 요청 전/);
  fireEvent.click(screen.getByRole("button", { name: "OS 알림 권한 요청" }));
  await screen.findByText(/시스템 설정에서 변경/);
  expect((screen.getByLabelText("OS 알림 병행") as HTMLInputElement).disabled).toBe(true);
  expect(act).not.toHaveBeenCalled();
});
