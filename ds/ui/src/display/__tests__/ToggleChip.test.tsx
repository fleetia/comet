import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { ToggleChip } from "../Chips";

afterEach(cleanup);

it("toggles independently without submitting the surrounding form", () => {
  const change = vi.fn();
  const submit = vi.fn((event: FormEvent) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <ToggleChip onPressedChange={change}>알림</ToggleChip>
    </form>,
  );
  const button = screen.getByRole("button", { name: "알림" });
  fireEvent.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(change).toHaveBeenCalledWith(true);
  expect(submit).not.toHaveBeenCalled();
});

it("leaves controlled selection to its owner", () => {
  const change = vi.fn();
  const view = render(
    <ToggleChip pressed={false} onPressedChange={change}>
      알림
    </ToggleChip>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(change).toHaveBeenCalledWith(true);
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  view.rerender(
    <ToggleChip pressed onPressedChange={change}>
      알림
    </ToggleChip>,
  );
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
});

it("respects native disabled and the consumer's canceled click", () => {
  const change = vi.fn();
  const view = render(
    <ToggleChip disabled onPressedChange={change}>
      알림
    </ToggleChip>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(change).not.toHaveBeenCalled();
  view.rerender(
    <ToggleChip onClick={(event) => event.preventDefault()} onPressedChange={change}>
      알림
    </ToggleChip>,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
});
