import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LauncherSettings } from "../components/Launcher/LauncherSettings";
import { DEFAULT_SHORTCUT, shortcutLabel, type LauncherState } from "../components/Launcher/search";
import { command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));

const initial: LauncherState = {
  sessionId: 1,
  shortcut: DEFAULT_SHORTCUT,
  shortcutRegistered: true,
  shortcutError: null,
};

beforeEach(() => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name, args) => {
      if (name === "get_launcher_state") return initial;
      if (name === "set_launcher_shortcut") {
        return { ...initial, shortcut: args?.shortcut, shortcutRegistered: !!args?.shortcut };
      }
      return undefined;
    });
});
afterEach(cleanup);

async function renderSettings(): Promise<HTMLButtonElement> {
  render(<LauncherSettings />);
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "빠른 실행 단축키 변경" });
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}

it("focuses the record button on click and captures the next key combination", async () => {
  const button = await renderSettings();
  fireEvent.click(button);
  expect(document.activeElement).toBe(button);
  expect(button.textContent).toBe("사용할 키를 눌러 주세요…");
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "k",
    code: "KeyK",
    ctrlKey: true,
    altKey: true,
  });
  await waitFor(() => expect(button.textContent).toBe(shortcutLabel("Control+Alt+KeyK")));
  expect(command).toHaveBeenCalledWith("set_launcher_shortcut", { shortcut: "Control+Alt+KeyK" });
});

it("keeps the registered shortcut and shows the native registration failure", async () => {
  const button = await renderSettings();
  const message = "이 단축키는 등록할 수 없어요. 기존 단축키는 유지했어요.";
  vi.mocked(command).mockResolvedValueOnce({ ...initial, shortcutError: message });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(button.textContent).toBe(shortcutLabel(initial.shortcut));
  expect(button.disabled).toBe(false);
});

it("disables the shortcut while keeping the direct launcher entry available", async () => {
  const button = await renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "단축키 끄기" }));
  await waitFor(() => expect(button.textContent).toBe("단축키 없음"));
  expect(command).toHaveBeenCalledWith("set_launcher_shortcut", { shortcut: "" });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "단축키 끄기" }).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "빠른 실행 열기" }));
  expect(command).toHaveBeenCalledWith("open_launcher");
});
