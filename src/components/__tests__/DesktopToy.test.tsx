import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesktopToy } from "../DesktopToy";
import { command } from "../../hooks/useSnapshot";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(vi.fn()) }));
vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  errorText: (error: unknown): string => String(error),
}));
const frame = {
  id: "actor",
  kind: "ball",
  angle: 0,
  dragging: false,
  moving: true,
  externalWindowsAvailable: true,
};
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(frame);
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("orders grab and release and dismisses only through the actor command", async () => {
  render(<DesktopToy id="actor" />);
  const ball = await screen.findByRole("button", { name: "공" });
  ball.setPointerCapture = vi.fn();
  ball.hasPointerCapture = vi.fn().mockReturnValue(true);
  ball.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(ball, { button: 0 });
  fireEvent.pointerUp(ball, { button: 0 });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("desktop_toy_action", { id: "actor", action: "release" }),
  );
  const actions = vi.mocked(command).mock.calls.map(([, args]) => args?.action);
  expect(actions.indexOf("grab")).toBeLessThan(actions.indexOf("release"));
  fireEvent.contextMenu(ball);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("desktop_toy_action", { id: "actor", action: "dismiss" }),
  );
});

it("pops a bubble without beginning a drag", async () => {
  vi.mocked(command).mockResolvedValue({ ...frame, kind: "bubbles" });
  render(<DesktopToy id="actor" />);
  const bubble = await screen.findByRole("button", { name: "비눗방울" });
  fireEvent.pointerDown(bubble, { button: 0 });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("desktop_toy_action", { id: "actor", action: "pop" }),
  );
  expect(vi.mocked(command).mock.calls.some(([, args]) => args?.action === "grab")).toBe(false);
});
