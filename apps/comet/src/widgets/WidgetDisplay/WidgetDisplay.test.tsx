import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emit, listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetDisplay } from "./WidgetDisplay";
import { DEFAULT_LAYOUT } from "./desktopState";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => String(cause),
}));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("../Travel/useTravelWidgets", () => ({
  useTravelWidgets: (widgets: WidgetView[]) => ({ widgets, status: "ready", reload: vi.fn() }),
}));
vi.mock("./DesktopWidget", () => ({ FreeformWidget: () => <div /> }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: vi.fn().mockResolvedValue(undefined) }),
}));

beforeEach(() => {
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => undefined);
  vi.mocked(emit).mockReset().mockResolvedValue(undefined);
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "get_widget_desktop") return { ...DEFAULT_LAYOUT, revision: 1, editing: true };
      return { ...DEFAULT_LAYOUT, revision: 2, editing: true };
    });
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      catalog: [
        {
          id: "clock",
          name: "시계",
          description: "",
          category: "",
          version: 1,
          required: [],
          connection: null,
        },
      ],
      widgets: [
        {
          id: "clock",
          kind: "clock",
          reaction: true,
          revision: 1,
          version: 1,
          missing: [],
          packageBytes: 0,
          error: null,
          status: "enabled",
          data: {},
        },
      ],
      onboardingDone: true,
    },
    error: null,
    reload: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("accumulates keyboard resizing and keeps focus while saving", async () => {
  let finishSave: ((value: unknown) => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return { ...DEFAULT_LAYOUT, revision: 1, editing: true };
    return new Promise((resolve) => {
      finishSave = resolve;
    });
  });
  render(<WidgetDisplay id="clock" />);
  const handle = await screen.findByRole("button", { name: "시계 크기 조절" });
  handle.focus();
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(screen.getByRole("status").textContent).toContain("200 × 184");
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_desktop_shape", {
      id: "clock",
      shape: expect.objectContaining({ width: 200 }),
    }),
  );
  expect(handle.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(handle);
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "set_widget_desktop_shape"),
  ).toHaveLength(1);
  finishSave?.({ ...DEFAULT_LAYOUT, revision: 2, editing: true });
});

it("starts pointer resizing from the pending keyboard size", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  render(<WidgetDisplay id="clock" />);
  const handle = await screen.findByRole("button", { name: "시계 크기 조절" });
  handle.setPointerCapture = vi.fn();

  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(handle, { button: 0, clientX: 30, clientY: 20 });

  await waitFor(() => {
    expect(command).toHaveBeenNthCalledWith(3, "set_widget_desktop_shape", {
      id: "clock",
      shape: expect.objectContaining({ width: 212, height: 194 }),
    });
  });
});

it("offers retry when the widget snapshot fails to load", () => {
  const reload = vi.fn();
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: "읽기 실패", reload });
  render(<WidgetDisplay id="clock" />);
  fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
  expect(reload).toHaveBeenCalledOnce();
});
