import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Motion } from "./Motion";
import { exit } from "./motion.css";
import { Surface } from "../surface/Surface";
import { ThemeRoot } from "../theme/ThemeRoot";
import { WaitingDots } from "../display/Indicators";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function finishAnimation(element: HTMLElement): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: exit });
  fireEvent(element, event);
}

it("retains a closing Surface until its own exit ends and immediately removes it from interaction", () => {
  vi.useFakeTimers();
  const ref = createRef<HTMLDivElement>();
  const complete = vi.fn();
  const view = render(
    <Surface ref={ref} onExitComplete={complete}>
      <button>확인</button>
    </Surface>,
  );
  const surface = ref.current!;
  view.rerender(
    <Surface ref={ref} open={false} onExitComplete={complete}>
      <button>확인</button>
    </Surface>,
  );
  expect(surface.isConnected).toBe(true);
  expect(surface.getAttribute("aria-hidden")).toBe("true");
  expect(surface.hasAttribute("inert")).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
  finishAnimation(surface.querySelector("button")!);
  expect(surface.isConnected).toBe(true);
  finishAnimation(surface);
  expect(ref.current).toBeNull();
  expect(complete).toHaveBeenCalledTimes(1);
  act(() => vi.runAllTimers());
  expect(complete).toHaveBeenCalledTimes(1);
});

it("cancels a stale close when reopened and falls back when no animationend arrives", () => {
  vi.useFakeTimers();
  const complete = vi.fn();
  const view = render(<Motion onExitComplete={complete}>이어하기</Motion>);
  view.rerender(
    <Motion open={false} onExitComplete={complete}>
      이어하기
    </Motion>,
  );
  view.rerender(<Motion onExitComplete={complete}>이어하기</Motion>);
  act(() => vi.runAllTimers());
  expect(screen.getByText("이어하기").getAttribute("aria-hidden")).toBeNull();
  expect(complete).not.toHaveBeenCalled();
  view.rerender(
    <Motion open={false} onExitComplete={complete}>
      이어하기
    </Motion>,
  );
  act(() => vi.runAllTimers());
  expect(screen.queryByText("이어하기")).toBeNull();
  expect(complete).toHaveBeenCalledTimes(1);
});

it("opens from an initially closed state and does not delay exit for staggered entries", () => {
  vi.useFakeTimers();
  const view = render(
    <Motion open={false} staggerIndex={3}>
      별
    </Motion>,
  );
  expect(screen.queryByText("별")).toBeNull();
  view.rerender(<Motion staggerIndex={3}>별</Motion>);
  expect(screen.getByText("별").style.animationDelay).toContain("3");
  view.rerender(
    <Motion open={false} staggerIndex={3}>
      별
    </Motion>,
  );
  expect(screen.getByText("별").style.animationDelay).toBe("0s");
  act(() => vi.runAllTimers());
  expect(screen.queryByText("별")).toBeNull();
});

it("skips the exit wait for the operating system's reduced motion preference", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const view = render(<Motion>안내</Motion>);
  view.rerender(<Motion open={false}>안내</Motion>);
  act(() => vi.advanceTimersByTime(0));
  expect(screen.queryByText("안내")).toBeNull();
});

it("finishes an ongoing exit when a parent switches to reduced motion", async () => {
  vi.useFakeTimers();
  const view = render(
    <ThemeRoot>
      <ThemeRoot>
        <Motion>친구</Motion>
      </ThemeRoot>
    </ThemeRoot>,
  );
  view.rerender(
    <ThemeRoot>
      <ThemeRoot>
        <Motion open={false}>친구</Motion>
      </ThemeRoot>
    </ThemeRoot>,
  );
  view.rerender(
    <ThemeRoot motion="reduced">
      <ThemeRoot>
        <Motion open={false}>친구</Motion>
      </ThemeRoot>
    </ThemeRoot>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText("친구")).toBeNull();
});

it("names the waiting status while keeping decorative dots out of the accessibility tree", () => {
  render(<WaitingDots label="이야기를 기다리는 중" />);
  const status = screen.getByRole("status", { name: "이야기를 기다리는 중" });
  expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
});

it("keeps a consumer's callback ref attached across ordinary rerenders", () => {
  const ref = vi.fn();
  const view = render(
    <Surface ref={ref} title="처음">
      내용
    </Surface>,
  );
  expect(ref).toHaveBeenCalledTimes(1);
  view.rerender(
    <Surface ref={ref} title="바뀜">
      내용
    </Surface>,
  );
  expect(ref).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(ref).toHaveBeenLastCalledWith(null);
});

it("starts an interrupted exit at its current opacity and transform without revealing delayed content", () => {
  vi.useFakeTimers();
  const view = render(
    <Motion style={{ opacity: 0, transform: "scale(0.6)" }} staggerIndex={4}>
      늦게 오는 별
    </Motion>,
  );
  view.rerender(
    <Motion open={false} style={{ opacity: 0, transform: "scale(0.6)" }} staggerIndex={4}>
      늦게 오는 별
    </Motion>,
  );
  const element = screen.getByText("늦게 오는 별");
  expect(element.style.getPropertyValue("--comet-motion-exit-opacity")).toBe("0");
  expect(element.style.getPropertyValue("--comet-motion-exit-transform")).toBe("scale(0.6)");
  expect(element.style.animationDelay).toBe("0s");
  finishAnimation(element);
  expect(screen.queryByText("늦게 오는 별")).toBeNull();
});
