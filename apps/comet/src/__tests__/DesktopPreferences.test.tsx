import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesktopPreferences } from "../components/DesktopPreferences/DesktopPreferences";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
afterEach(cleanup);
beforeEach(() => vi.mocked(command).mockReset());

it("does not replace stored toy restrictions with initial defaults when editing around initial loading", async () => {
  let receive: (value: unknown) => void = () => {};
  vi.mocked(command).mockImplementation((name) =>
    name === "get_desktop_preferences"
      ? new Promise((resolve) => {
          receive = resolve;
        })
      : Promise.resolve(undefined),
  );
  render(
    <DesktopPreferences
      hidden={false}
      settings={PREVIEW_SNAPSHOT.settings}
      onToggleCharacters={() => {}}
    />,
  );
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_desktop_preferences"));
  fireEvent.click(screen.getByLabelText("장난 모드"));
  await act(async () =>
    receive({ charactersVisible: true, pranksEnabled: false, allowedToys: ["ball"] }),
  );
  if (!(screen.getByLabelText("장난 모드") as HTMLInputElement).checked) {
    fireEvent.click(screen.getByLabelText("장난 모드"));
  }
  fireEvent.click(screen.getByRole("button", { name: "장난 설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_desktop_preferences", {
      preferences: { charactersVisible: true, pranksEnabled: true, allowedToys: ["ball"] },
    }),
  );
});

it("opens desktop editing and controls the friend and walking separately", async () => {
  const toggleCharacters = vi.fn();
  vi.mocked(command).mockResolvedValue({
    charactersVisible: true,
    pranksEnabled: false,
    allowedToys: [],
    activityEnabled: false,
    activityExcludedApps: [],
  });
  render(
    <DesktopPreferences
      hidden={false}
      settings={PREVIEW_SNAPSHOT.settings}
      onToggleCharacters={toggleCharacters}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "편집" }));
  expect(command).toHaveBeenCalledWith("set_widget_desktop_editing", { editing: true });
  fireEvent.click(screen.getByRole("button", { name: "친구 숨기기" }));
  expect(toggleCharacters).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("switch", { name: "자동 산책" }));
  fireEvent.click(screen.getByRole("button", { name: "산책 설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_settings",
      expect.objectContaining({
        scope: "desktop",
        settings: expect.objectContaining({ wanderingEnabled: false }),
      }),
    ),
  );
});
