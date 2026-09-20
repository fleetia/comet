import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const listeners = new Map<string, EventCallback<unknown>>();
const unlisten = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  listeners.clear();
  unlisten.mockClear();
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "get_settings_section" ? "automatic" : undefined,
    );
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    listeners.set(event, callback as EventCallback<unknown>);
    return unlisten;
  });
});

it("synchronizes unsaved state to native quit protection and retains edits when native exit is canceled", async () => {
  const { unmount } = render(
    <SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />,
  );
  await waitFor(() => expect(listeners.has("confirm-settings-exit")).toBe(true));
  expect(command).toHaveBeenCalledWith("set_settings_dirty", { dirty: false });
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "17" } });
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_settings_dirty", { dirty: true }));
  act(() =>
    listeners.get("confirm-settings-exit")?.({
      event: "confirm-settings-exit",
      id: 1,
      payload: null,
    }),
  );
  expect(screen.getByRole("dialog", { name: "저장하지 않고 종료할까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "17");
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "quit_app")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("set_settings_dirty", { dirty: false }),
  );
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "18" } });
  act(() =>
    listeners.get("confirm-settings-exit")?.({
      event: "confirm-settings-exit",
      id: 2,
      payload: null,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "변경을 버리고 종료" }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith("quit_app", { force: true }));
  unmount();
  expect(unlisten).toHaveBeenCalledTimes(2);
});
