import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WindowHeader } from "../components/WindowHeader/WindowHeader";
import { isDesktop } from "../hooks/useSnapshot";
import { grabTarget } from "../components/WindowHeader/windowHeader.css";

const native = vi.hoisted(() => ({ close: vi.fn(), startDragging: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  isDesktop: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(true);
  native.close.mockReset().mockResolvedValue(undefined);
  native.startDragging.mockReset().mockResolvedValue(undefined);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(760);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(24, 24, 712, 76),
  );
});
afterEach(cleanup);

it("drags the title with a single left press and keeps actions separate", async () => {
  const action = vi.fn();
  render(
    <WindowHeader label="설정 닫기" actions={<button onClick={action}>설정</button>}>
      <h1>캐릭터 관리</h1>
    </WindowHeader>,
  );
  const title = screen.getByRole("heading");
  fireEvent.mouseDown(title, { button: 2, detail: 1 });
  fireEvent.mouseDown(title, { button: 0, detail: 2 });
  expect(native.startDragging).not.toHaveBeenCalled();
  fireEvent.mouseDown(title, { button: 0, detail: 1 });
  expect(native.startDragging).toHaveBeenCalledTimes(1);
  const settings = screen.getByRole("button", { name: "설정" });
  fireEvent.mouseDown(settings, { button: 0, detail: 1 });
  fireEvent.click(settings);
  expect(action).toHaveBeenCalledTimes(1);
  const close = screen.getByRole("button", { name: "설정 닫기" });
  fireEvent.mouseDown(close, { button: 0, detail: 1 });
  fireEvent.click(close);
  await waitFor(() => expect(native.close).toHaveBeenCalledTimes(1));
  expect(native.startDragging).toHaveBeenCalledTimes(1);
});

it("drags from the window origin and outer padding only above the visible header bottom", () => {
  render(<WindowHeader label="설정 닫기">설정</WindowHeader>);
  for (const [clientX, clientY] of [
    [0, 0],
    [750, 0],
    [2, 70],
    [750, 99],
  ]) {
    fireEvent.mouseDown(document.body, { button: 0, detail: 1, clientX, clientY });
  }
  expect(native.startDragging).toHaveBeenCalledTimes(4);
  for (const [clientX, clientY] of [
    [20, 100],
    [20, 150],
    [760, 20],
  ]) {
    fireEvent.mouseDown(document.body, { button: 0, detail: 1, clientX, clientY });
  }
  expect(native.startDragging).toHaveBeenCalledTimes(4);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
    new DOMRect(24, -80, 712, 76),
  );
  fireEvent.mouseDown(document.body, { button: 0, detail: 1, clientX: 2, clientY: 0 });
  expect(native.startDragging).toHaveBeenCalledTimes(4);
});

it("preserves input and modal interaction in the expanded drag area", () => {
  const { rerender } = render(
    <>
      <WindowHeader label="설정 닫기">설정</WindowHeader>
      <input aria-label="이름" />
      <dialog open aria-modal="true">
        확인
      </dialog>
    </>,
  );
  fireEvent.mouseDown(document.body, { button: 0, detail: 1, clientX: 2, clientY: 2 });
  expect(native.startDragging).not.toHaveBeenCalled();
  rerender(
    <>
      <WindowHeader label="설정 닫기">설정</WindowHeader>
      <input aria-label="이름" />
      <dialog aria-modal="true">확인</dialog>
    </>,
  );
  fireEvent.mouseDown(screen.getByRole("textbox"), {
    button: 0,
    detail: 1,
    clientX: 2,
    clientY: 2,
  });
  expect(native.startDragging).not.toHaveBeenCalled();
  fireEvent.mouseDown(document.body, { button: 0, detail: 1, clientX: 2, clientY: 2 });
  expect(native.startDragging).toHaveBeenCalledTimes(1);
});

it("reports a native close failure", async () => {
  native.close.mockRejectedValueOnce(new Error("창을 닫지 못했어요."));
  render(<WindowHeader label="설정 닫기">설정</WindowHeader>);
  fireEvent.click(screen.getByRole("button", { name: "설정 닫기" }));
  expect((await screen.findByRole("alert")).textContent).toBe("창을 닫지 못했어요.");
});

it("shows the grab cursor on outer padding and restores it over controls and content", () => {
  render(
    <>
      <WindowHeader label="설정 닫기">설정</WindowHeader>
      <input aria-label="이름" />
    </>,
  );
  const close = screen.getByRole("button", { name: "설정 닫기" });
  const input = screen.getByRole("textbox");
  for (const target of [close, input, document.body]) {
    fireEvent.mouseMove(document.body, { clientX: 2, clientY: 2 });
    expect(document.body.classList.contains(grabTarget)).toBe(true);
    fireEvent.mouseMove(target, { clientX: 2, clientY: target === document.body ? 150 : 2 });
    expect(document.body.classList.contains(grabTarget)).toBe(false);
    expect(target.classList.contains(grabTarget)).toBe(false);
  }
});

it("clears the grab cursor after layout or focus changes and when the header unmounts", () => {
  const { unmount } = render(<WindowHeader label="설정 닫기">설정</WindowHeader>);
  for (const clear of [
    () => fireEvent.scroll(document),
    () => fireEvent.focusIn(document.body),
    () => fireEvent.keyDown(document.body, { key: "Escape" }),
    () => fireEvent.mouseLeave(document.documentElement),
    () => fireEvent.resize(window),
    () => fireEvent.blur(window),
    unmount,
  ]) {
    fireEvent.mouseMove(document.body, { clientX: 2, clientY: 2 });
    expect(document.body.classList.contains(grabTarget)).toBe(true);
    clear();
    expect(document.body.classList.contains(grabTarget)).toBe(false);
  }
});

it.each(["preview", "browser"] as const)("disables native controls in %s", (mode) => {
  vi.mocked(isDesktop).mockReturnValue(mode !== "browser");
  render(
    <WindowHeader label="설정 닫기" preview={mode === "preview"}>
      <h1>설정</h1>
    </WindowHeader>,
  );
  const close = screen.getByRole("button", { name: "설정 닫기" });
  expect(close).toHaveProperty("disabled", true);
  fireEvent.click(close);
  fireEvent.mouseDown(screen.getByRole("heading"), { button: 0, detail: 1 });
  fireEvent.mouseMove(document.body, { clientX: 2, clientY: 2 });
  expect(document.body.classList.contains(grabTarget)).toBe(false);
  expect(native.close).not.toHaveBeenCalled();
  expect(native.startDragging).not.toHaveBeenCalled();
});
