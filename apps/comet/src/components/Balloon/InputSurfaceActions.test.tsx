import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InputSurfaceActions } from "./InputSurfaceActions";
import * as styles from "./conversationSurface.css";

afterEach(cleanup);

it("keeps all three enabled desktop actions on the scoped surface and dispatches separately", () => {
  const onResume = vi.fn();
  const onTogether = vi.fn();
  const onHistory = vi.fn();
  render(
    <InputSurfaceActions
      resumeDisabled={false}
      togetherDisabled={false}
      historyDisabled={false}
      onResume={onResume}
      onTogether={onTogether}
      onHistory={onHistory}
    />,
  );
  for (const [name, handler] of [
    ["이어서 하기", onResume],
    ["함께 이야기해 봐", onTogether],
    ["지난 대화", onHistory],
  ] as const) {
    const button = screen.getByRole("button", { name });
    expect(button.classList.contains(styles.inputAction)).toBe(true);
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    expect(handler).toHaveBeenCalledTimes(1);
  }
});

it("preserves independent disabled states when navigation availability changes", () => {
  const callbacks = { onResume: vi.fn(), onTogether: vi.fn(), onHistory: vi.fn() };
  const { rerender } = render(
    <InputSurfaceActions {...callbacks} resumeDisabled togetherDisabled historyDisabled={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  fireEvent.click(screen.getByRole("button", { name: "함께 이야기해 봐" }));
  fireEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  expect(callbacks.onResume).not.toHaveBeenCalled();
  expect(callbacks.onTogether).not.toHaveBeenCalled();
  expect(callbacks.onHistory).toHaveBeenCalledTimes(1);

  rerender(
    <InputSurfaceActions
      {...callbacks}
      resumeDisabled={false}
      togetherDisabled={false}
      historyDisabled
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  fireEvent.click(screen.getByRole("button", { name: "함께 이야기해 봐" }));
  fireEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  expect(callbacks.onResume).toHaveBeenCalledTimes(1);
  expect(callbacks.onTogether).toHaveBeenCalledTimes(1);
  expect(callbacks.onHistory).toHaveBeenCalledTimes(1);
});
