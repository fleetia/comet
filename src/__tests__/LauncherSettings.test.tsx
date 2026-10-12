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

it("captures the next combination as a draft and only registers on explicit apply", async () => {
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
  expect(command).not.toHaveBeenCalledWith("set_launcher_shortcut", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "적용" }));
  expect(command).toHaveBeenCalledWith("set_launcher_shortcut", { shortcut: "Control+Alt+KeyK" });
});

it("keeps the registered shortcut and shows the native registration failure", async () => {
  const button = await renderSettings();
  const message = "이 단축키는 등록할 수 없어요. 기존 단축키는 유지했어요.";
  vi.mocked(command).mockResolvedValueOnce({ ...initial, shortcutError: message });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
  fireEvent.click(screen.getByRole("button", { name: "적용" }));
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

it("keeps a rejected draft for retry and uses Esc, Tab and blur only to manage recording", async () => {
  const button = await renderSettings();
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "k", code: "KeyK", ctrlKey: true });
  vi.mocked(command).mockRejectedValueOnce(new Error("등록 응답 실패"));
  fireEvent.click(screen.getByRole("button", { name: "적용" }));
  await screen.findByRole("alert");
  expect(button.textContent).toBe(shortcutLabel("Control+KeyK"));
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Tab", code: "Tab" });
  expect(button.textContent).toBe(shortcutLabel("Control+KeyK"));
  fireEvent.click(button);
  fireEvent.blur(button);
  expect(button.textContent).toBe(shortcutLabel("Control+KeyK"));
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Escape", code: "Escape" });
  expect(button.textContent).toBe(shortcutLabel(initial.shortcut));
  expect(screen.getByRole("button", { name: "적용" })).toHaveProperty("disabled", true);
});

it("blocks all registration changes until initial load and ignores late save after unmount", async () => {
  let loaded!: (state: LauncherState) => void;
  let saved!: (state: LauncherState) => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_launcher_state") return new Promise<LauncherState>((resolve) => { loaded = resolve; });
    return new Promise<LauncherState>((resolve) => { saved = resolve; });
  });
  const dirty = vi.fn();
  const view = render(<LauncherSettings onDirtyChange={dirty} />);
  for (const name of ["빠른 실행 단축키 변경", "기본값으로", "단축키 끄기", "적용"]) {
    expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
  }
  loaded(initial);
  await waitFor(() => expect(screen.getByRole("button", { name: "기본값으로" })).toHaveProperty("disabled", false));
  const button = screen.getByRole("button", { name: "빠른 실행 단축키 변경" });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "k", code: "KeyK", ctrlKey: true });
  expect(dirty).toHaveBeenLastCalledWith(true);
  const apply = screen.getByRole("button", { name: "적용" });
  fireEvent.click(apply);
  fireEvent.click(apply);
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "set_launcher_shortcut")).toHaveLength(1);
  view.unmount();
  saved({ ...initial, shortcut: "Control+KeyK" });
  await Promise.resolve();
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it("ignores IME composition and shift-only capture", async () => {
  const button = await renderSettings();
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "K", code: "KeyK", shiftKey: true });
  fireEvent.keyDown(button, { key: "k", code: "KeyK", ctrlKey: true, isComposing: true });
  expect(command).not.toHaveBeenCalledWith("set_launcher_shortcut", expect.anything());
  expect(screen.getByRole("button", { name: "적용" })).toHaveProperty("disabled", true);
});
