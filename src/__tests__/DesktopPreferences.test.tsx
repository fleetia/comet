import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesktopPreferences } from "../components/DesktopPreferences/DesktopPreferences";
import { command } from "../hooks/useSnapshot";

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
  render(<DesktopPreferences hidden={false} />);
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
