import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LedgerQuickAdd } from "./Ledger";

afterEach(cleanup);

it("keeps comma-formatted won input intact and rejects decimal or exponent notation", () => {
  const onAdd = vi.fn();
  render(
    <LedgerQuickAdd
      categories={[{ value: "food", label: "식비" }]}
      defaultAmount="4,500"
      onAdd={onAdd}
    />,
  );
  const amount = screen.getByRole("textbox", { name: "금액 (원)" }) as HTMLInputElement;
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(onAdd).toHaveBeenCalledWith({ amount: "4,500", category: "food", memo: "" });
  for (const value of ["4.5", "1e3", "1,5"]) {
    fireEvent.change(amount, { target: { value } });
    expect(amount.checkValidity()).toBe(false);
  }
});
