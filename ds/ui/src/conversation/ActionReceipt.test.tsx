import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionReceipt } from "./ActionReceipt";

afterEach(cleanup);

it("preserves the result title and explains unavailable undo without disabling open", () => {
  render(
    <ActionReceipt
      title={"컵라면  · 3,000원\n오늘 지출"}
      undoSupported={false}
      undoReason="이미 시작한 동작은 되돌릴 수 없어요."
      onOpen={vi.fn()}
      onUndo={vi.fn()}
      className="receipt-example"
    />,
  );
  const result = screen.getByRole("group");
  expect(result.classList.contains("receipt-example")).toBe(true);
  expect(result.firstChild?.textContent).toBe("컵라면  · 3,000원\n오늘 지출");
  const undo = screen.getByRole("button", { name: "되돌리기" });
  expect(undo).toHaveProperty("disabled", true);
  expect(document.getElementById(undo.getAttribute("aria-describedby")!)?.textContent).toBe(
    "이미 시작한 동작은 되돌릴 수 없어요.",
  );
  expect(screen.getByRole("button", { name: "열기" })).toHaveProperty("disabled", false);
});

it("keeps old receipts undoable and locks actions while pending or after undo", () => {
  const props = { title: "컵라면 · 3,000원", onOpen: vi.fn(), onUndo: vi.fn() };
  const view = render(<ActionReceipt {...props} />);
  expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty("disabled", false);
  view.rerender(<ActionReceipt {...props} pending />);
  expect(screen.getByRole("group").getAttribute("aria-busy")).toBe("true");
  for (const button of screen.getAllByRole("button"))
    expect(button).toHaveProperty("disabled", true);
  view.rerender(<ActionReceipt {...props} undone />);
  expect(screen.getByRole("status").textContent).toBe("되돌림");
  expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "열기" })).toHaveProperty("disabled", false);
});
