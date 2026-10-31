import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_SNAPSHOT } from "../../previewSnapshot";
import { GeneralSettings } from "./GeneralSettings";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => false,
  errorText: (cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause),
}));
vi.mock("../AutostartSettings/AutostartSettings", () => ({
  AutostartSettings: () => null,
}));
vi.mock("../Launcher/LauncherSettings", () => ({
  LauncherSettings: () => null,
}));
vi.mock("../UpdatePanel/UpdatePanel", () => ({ UpdatePanel: () => null }));

function props(consent = true): ComponentProps<typeof GeneralSettings> {
  return {
    snapshot: {
      ...PREVIEW_SNAPSHOT,
      settings: { ...PREVIEW_SNAPSHOT.settings, analyticsConsent: consent },
    },
    active: true,
    onOpenUser: vi.fn(),
    onOpenOrganizer: vi.fn(),
    onOpenTheme: vi.fn(),
    onBusyChange: vi.fn(),
    hasChanges: false,
    onShortcutDirtyChange: vi.fn(),
    onQuit: vi.fn(),
    onToggleCharacters: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("saves analytics consent independently for withdrawal and regrant", async () => {
  const view = render(<GeneralSettings {...props()} />);
  const toggle = screen.getByRole("switch", { name: "사용 통계 보내기" });
  expect(toggle).toHaveProperty("checked", true);

  fireEvent.click(toggle);
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("set_analytics_consent", {
      enabled: false,
    }),
  );
  view.rerender(<GeneralSettings {...props(false)} />);
  expect(toggle).toHaveProperty("checked", false);

  await waitFor(() => expect(toggle).toHaveProperty("disabled", false));
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("set_analytics_consent", {
      enabled: true,
    }),
  );
  view.rerender(<GeneralSettings {...props(true)} />);
  expect(toggle).toHaveProperty("checked", true);
  expect(command).toHaveBeenCalledTimes(2);
});

it("keeps the saved consent when withdrawal fails and permits a retry", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("동의 저장 실패"));
  render(<GeneralSettings {...props()} />);
  const toggle = screen.getByRole("switch", { name: "사용 통계 보내기" });
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "동의 저장 실패",
  );
  expect(toggle).toHaveProperty("checked", true);
  expect(toggle).toHaveProperty("disabled", false);

  fireEvent.click(toggle);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command).toHaveBeenLastCalledWith("set_analytics_consent", {
    enabled: false,
  });
});

it("blocks duplicate consent saves while the command is pending", () => {
  vi.mocked(command).mockImplementation(() => new Promise<void>(() => {}));
  render(<GeneralSettings {...props()} />);
  const toggle = screen.getByRole("switch", { name: "사용 통계 보내기" });
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(command).toHaveBeenCalledExactlyOnceWith("set_analytics_consent", {
    enabled: false,
  });
  expect(toggle).toHaveProperty("disabled", true);
  expect(toggle.getAttribute("aria-busy")).toBe("true");
});

it("opens the data folder in the system file manager and shows a failure in place", async () => {
  render(<GeneralSettings {...props()} />);
  const reveal = screen.getByRole("button", { name: /에서 보기|폴더 열기/ });
  fireEvent.click(reveal);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("reveal_data_folder"),
  );
  vi.mocked(command).mockRejectedValueOnce(
    new Error("데이터 폴더를 열지 못했어요."),
  );
  fireEvent.click(reveal);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "데이터 폴더를 열지 못했어요.",
  );
});

it("resets only after the confirmation dialog and reports a failure", async () => {
  render(<GeneralSettings {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  expect(command).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "초기화" }));
  vi.mocked(command).mockRejectedValueOnce(
    new Error("지금은 초기화할 수 없어요."),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "모두 지우고 초기화",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "지금은 초기화할 수 없어요.",
  );
  expect(command).toHaveBeenCalledExactlyOnceWith("reset_app");
});

it("disables reset while settings have unsaved changes", () => {
  render(<GeneralSettings {...props()} hasChanges />);
  expect(screen.getByRole("button", { name: "초기화" })).toHaveProperty(
    "disabled",
    true,
  );
});
