import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageWindow } from "./ImageWindow";
import { useWidgets } from "../useWidgets";
import { command } from "../../hooks/useSnapshot";

const popup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const newMenu = vi.hoisted(() => vi.fn().mockResolvedValue({ popup, close: vi.fn() }));
vi.mock("@tauri-apps/api/menu", () => ({ Menu: { new: newMenu } }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: () => "media", invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ outerPosition: vi.fn().mockResolvedValue({ x: 20, y: 40 }), scaleFactor: vi.fn().mockResolvedValue(2) }) }));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("../../hooks/useSnapshot", () => ({ command: vi.fn(), errorText: String, isDesktop: () => true }));
vi.mock("../../hooks/useWindowDrag", () => ({ useWindowDrag: () => ({ onPointerDown: vi.fn(), onPointerMove: vi.fn(), reset: vi.fn() }) }));

function show(mime = "image/png", size = 100): void {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { catalog: [], onboardingDone: false, widgets: [{ id: "widget", kind: "image", version: 1, revision: 1, status: "enabled", reaction: true, missing: [], error: null, packageBytes: 0, data: { images: [{ id: "one", mime, width: size, height: size, naturalWidth: size, naturalHeight: size }] } }] },
    error: null,
    reload: vi.fn(),
  });
  render(<ImageWindow id="widget" imageId="one" />);
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  newMenu.mockClear();
  popup.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("opens the same menu from the button and Shift+F10", async () => {
  show();
  const main = screen.getByRole("main", { name: "이미지 위젯 1" });
  fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
  await waitFor(() => expect(popup).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(main, { key: "F10", shiftKey: true });
  await waitFor(() => expect(popup).toHaveBeenCalledTimes(2));
});

it("sends keyboard resize dimensions in the resize request", async () => {
  vi.mocked(command).mockClear();
  show();
  fireEvent.keyDown(screen.getByRole("button", { name: "이미지 크기 조절" }), { key: "ArrowRight" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("resize_widget_image", {
    id: "widget",
    imageId: "one",
    resize: { width: 108, height: 108, originX: undefined, originY: undefined },
  }));
});

it("does not resize when the handle is clicked without movement", async () => {
  vi.mocked(command).mockClear();
  show("image/png", 333);
  const handle = screen.getByRole("button", { name: "이미지 크기 조절" });
  handle.setPointerCapture = vi.fn();
  await act(async () => {
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, screenX: 120, screenY: 100 });
  });
  expect(command).not.toHaveBeenCalledWith("resize_widget_image", expect.anything());
});

it("commits the resize after dragging back to the starting point", async () => {
  vi.mocked(command).mockClear();
  show();
  const handle = screen.getByRole("button", { name: "이미지 크기 조절" });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, screenX: 100, screenY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, screenX: 120, screenY: 100 });
  await waitFor(() => expect(command).toHaveBeenCalledWith("resize_widget_image", {
    id: "widget", imageId: "one", resize: { width: 120, height: 120, preview: true, originX: 10, originY: 20 },
  }));
  fireEvent.pointerMove(handle, { pointerId: 1, screenX: 100, screenY: 100 });
  fireEvent.pointerUp(handle, { pointerId: 1, screenX: 100, screenY: 100 });
  await waitFor(() => expect(command).toHaveBeenCalledWith("resize_widget_image", {
    id: "widget", imageId: "one", resize: { width: 100, height: 100, preview: false, originX: 10, originY: 20 },
  }));
});

it("shows recovery instructions and an available menu after media fails", () => {
  show();
  fireEvent.error(document.querySelector("img")!);
  expect(screen.getByRole("alert").textContent).toContain("이미지를 지우고 다시 추가");
  expect(screen.getByRole("button", { name: "더 보기" })).toBeTruthy();
});

it("does not autoplay with reduced motion and lets the user play and pause", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  show("video/mp4");
  expect(document.querySelector("video")?.autoplay).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "영상 재생" }));
  await screen.findByRole("button", { name: "영상 정지" });
  expect(play).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "영상 정지" }));
  expect(pause).toHaveBeenCalled();
  play.mockRestore();
  pause.mockRestore();
});
