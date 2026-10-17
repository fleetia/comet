import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_SNAPSHOT } from "../../previewSnapshot";
import { GeneralSettings } from "./GeneralSettings";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  errorText: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));
vi.mock("../AutostartSettings/AutostartSettings", () => ({ AutostartSettings: () => null }));
vi.mock("../Launcher/LauncherSettings", () => ({ LauncherSettings: () => null }));
vi.mock("../UpdatePanel/UpdatePanel", () => ({ UpdatePanel: () => null }));

function props(consent = false): ComponentProps<typeof GeneralSettings> {
  return {
    snapshot: {
      ...PREVIEW_SNAPSHOT,
      settings: { ...PREVIEW_SNAPSHOT.settings, analyticsConsent: consent },
    },
    active: true,
    onOpenUser: vi.fn(),
    onOpenOrganizer: vi.fn(),
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

it("saves analytics consent independently and reflects the saved snapshot for regrant and withdrawal", async () => {
  const view = render(<GeneralSettings {...props()} />);
  const checkbox = screen.getByRole("checkbox", { name: "(선택) 익명 사용 통계 수집에 동의해요" });
  expect(checkbox).toHaveProperty("checked", false);
  expect(command).not.toHaveBeenCalled();

  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("set_analytics_consent", { enabled: true }),
  );
  view.rerender(<GeneralSettings {...props(true)} />);
  expect(checkbox).toHaveProperty("checked", true);

  await waitFor(() => expect(checkbox).toHaveProperty("disabled", false));
  fireEvent.click(checkbox);
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("set_analytics_consent", { enabled: false }),
  );
  view.rerender(<GeneralSettings {...props(false)} />);
  expect(checkbox).toHaveProperty("checked", false);
  expect(command).toHaveBeenCalledTimes(2);
});

it("keeps the saved consent when withdrawal fails and permits an explicit retry", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("동의 저장 실패"));
  render(<GeneralSettings {...props(true)} />);
  const checkbox = screen.getByRole("checkbox");
  fireEvent.click(checkbox);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "동의 저장 실패");
  expect(checkbox).toHaveProperty("checked", true);
  expect(checkbox).toHaveProperty("disabled", false);

  fireEvent.click(checkbox);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command).toHaveBeenLastCalledWith("set_analytics_consent", { enabled: false });
});

it("blocks duplicate consent saves while the native command is pending", () => {
  vi.mocked(command).mockImplementation(() => new Promise<void>(() => {}));
  render(<GeneralSettings {...props()} />);
  const checkbox = screen.getByRole("checkbox");
  fireEvent.click(checkbox);
  fireEvent.click(checkbox);
  expect(command).toHaveBeenCalledExactlyOnceWith("set_analytics_consent", { enabled: true });
  expect(checkbox).toHaveProperty("disabled", true);
});
