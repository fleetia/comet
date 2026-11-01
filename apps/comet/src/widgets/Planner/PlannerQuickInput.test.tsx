import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlannerQuickInput } from "./PlannerQuickInput";

it("prevents Enter during composition using the ref, native flag, and key code", () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <PlannerQuickInput
      isToday
      embedded
      day="2026-10-31"
      period="week"
      planScope="주간"
      title="할 일"
      busy={false}
      hasTodo
      lists={[]}
      quickList="default"
      onTitleChange={vi.fn()}
      onDayChange={vi.fn()}
      onListChange={vi.fn()}
      onTemplates={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  const input = screen.getByRole("textbox", { name: "새 할 일" });
  fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  fireEvent.compositionEnd(input);
  expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
  expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })).toBe(false);
  expect(onSubmit).not.toHaveBeenCalled();
});
