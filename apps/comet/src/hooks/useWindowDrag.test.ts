import { act, renderHook, waitFor } from "@testing-library/react";
import type { PointerEvent } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { command } from "./useSnapshot";
import { useWindowDrag } from "./useWindowDrag";

const startDragging = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ startDragging }) }));
vi.mock("./useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (cause: unknown) => String(cause),
}));

function pointer(x: number, buttons = 1): PointerEvent<HTMLElement> {
  return { button: 0, buttons, clientX: x, clientY: 0 } as PointerEvent<HTMLElement>;
}

beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  startDragging.mockReset().mockResolvedValue(undefined);
});

it("marks a drag only after the movement threshold and before starting it", () => {
  const { result } = renderHook(() => useWindowDrag(true, vi.fn()));
  act(() => {
    result.current.onPointerDown(pointer(0));
    result.current.onPointerMove(pointer(5));
  });
  expect(command).not.toHaveBeenCalled();
  act(() => result.current.onPointerMove(pointer(6)));
  expect(startDragging).toHaveBeenCalledOnce();
  expect(command).toHaveBeenCalledWith("mark_widget_desktop_drag");
  expect(vi.mocked(command).mock.invocationCallOrder[0]).toBeLessThan(
    startDragging.mock.invocationCallOrder[0],
  );
});

it("starts dragging without waiting for the marker", () => {
  vi.mocked(command).mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useWindowDrag(true, vi.fn()));
  act(() => {
    result.current.onPointerDown(pointer(0));
    result.current.onPointerMove(pointer(6));
  });
  expect(startDragging).toHaveBeenCalledOnce();
});

it("still starts dragging if the marker fails", async () => {
  vi.mocked(command).mockRejectedValue(new Error("unavailable"));
  const onError = vi.fn();
  const { result } = renderHook(() => useWindowDrag(true, onError));
  act(() => {
    result.current.onPointerDown(pointer(0));
    result.current.onPointerMove(pointer(6));
  });
  await waitFor(() => expect(startDragging).toHaveBeenCalledOnce());
  expect(onError).not.toHaveBeenCalled();
});

it("reports errors from starting the drag", async () => {
  startDragging.mockRejectedValue(new Error("drag failed"));
  const onError = vi.fn();
  const { result } = renderHook(() => useWindowDrag(true, onError));
  act(() => {
    result.current.onPointerDown(pointer(0));
    result.current.onPointerMove(pointer(6));
  });
  await waitFor(() => expect(onError).toHaveBeenCalledWith("Error: drag failed"));
});
