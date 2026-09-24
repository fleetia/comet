import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnimationFrameView } from "../components/AnimationFrameView/AnimationFrameView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("clears and hides the old frame while replacement frames are unavailable, then draws the new frame", () => {
  let painted: CanvasImageSource | null = null;
  const context = {
    clearRect: vi.fn(() => {
      painted = null;
    }),
    drawImage: vi.fn((image: CanvasImageSource) => {
      painted = image;
    }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const first = document.createElement("canvas");
  const second = document.createElement("canvas");
  const props = { index: 0, size: 64, label: "동작 미리보기" };
  const { getByRole, rerender } = render(<AnimationFrameView {...props} frames={[first]} />);
  const canvas = getByRole("img", { name: props.label }) as HTMLCanvasElement;
  const nativeWidthSetter = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "width",
  )?.set;
  vi.spyOn(canvas, "width", "set").mockImplementation((value: number) => {
    nativeWidthSetter?.call(canvas, value);
    // Resetting the width clears the native canvas even when its value is unchanged.
    painted = null;
  });
  expect(painted).toBe(first);
  expect(canvas.style.visibility).toBe("visible");

  // A selected clip keeps manual frame 0 while loading, and on a failed load.
  rerender(<AnimationFrameView {...props} frames={null} />);
  expect(painted).toBeNull();
  expect(canvas.style.visibility).toBe("hidden");
  expect(canvas.getAttribute("aria-hidden")).toBe("true");
  rerender(<AnimationFrameView {...props} frames={null} label="불러오지 못한 동작" />);
  expect(painted).toBeNull();
  expect(canvas.style.visibility).toBe("hidden");

  rerender(<AnimationFrameView {...props} frames={[second]} />);
  expect(painted).toBe(second);
  expect(canvas.style.visibility).toBe("visible");
  expect(canvas.getAttribute("aria-hidden")).toBe("false");
  rerender(<AnimationFrameView {...props} frames={[second]} index={null} />);
  expect(painted).toBeNull();
  expect(canvas.style.visibility).toBe("hidden");
});
