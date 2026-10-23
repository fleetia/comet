// @vitest-environment jsdom
// happy-dom does not validate the amount pattern on submit.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Ledger12MonthForecast, LedgerQuickAdd } from "./Ledger";

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

const forecastMonths = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  label: `${((index + 9) % 12) + 1}월`,
  recurring: 1000,
  occasional: 0,
  valueLabel: "1,000원",
}));

it("keeps all twelve months and exact accessible amounts with sparse endpoint labels", () => {
  const { container } = render(<Ledger12MonthForecast months={forecastMonths} />);
  const months = screen.getAllByRole("group");
  expect(months).toHaveLength(12);
  for (const [index, month] of months.entries()) {
    expect(month.tabIndex).toBe(0);
    expect(screen.getByRole("group", { name: `${forecastMonths[index].label} 1,000원` })).toBe(
      month,
    );
  }
  const values = container.querySelector('[aria-hidden="true"]')!;
  expect(values.textContent).toBe("1,000원1,000원");
  fireEvent.focus(months[5]);
  expect(values.textContent).toBe("3월 · 1,000원");
  fireEvent.mouseEnter(months[6]);
  expect(values.textContent).toBe("4월 · 1,000원");
  fireEvent.mouseLeave(months[6]);
  expect(values.textContent).toBe("3월 · 1,000원");
  fireEvent.keyDown(months[5], { key: "Escape" });
  expect(values.textContent).toBe("1,000원1,000원");
  fireEvent.blur(months[5]);
  fireEvent.focus(months[11]);
  expect(values.textContent).toBe("9월 · 1,000원");
  fireEvent.blur(months[11]);
  expect(values.textContent).toBe("1,000원1,000원");
});

it("preserves unabridged large and zero amounts without requiring formatted labels", () => {
  const { rerender, container } = render(
    <Ledger12MonthForecast
      months={[
        {
          id: "large",
          label: "10월",
          recurring: 123456789,
          occasional: 0,
          valueLabel: "123,456,789원",
        },
        { id: "zero", label: "11월", recurring: 0, occasional: 0, valueLabel: "0원" },
        { id: "unlabelled", label: "12월", recurring: 20, occasional: 10 },
      ]}
    />,
  );
  fireEvent.focus(screen.getByRole("group", { name: "10월 123,456,789원" }));
  expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe("10월 · 123,456,789원");
  expect(screen.getByRole("group", { name: "11월 0원" }).tabIndex).toBe(0);
  expect(screen.getByRole("group", { name: "12월 30" }).tabIndex).toBe(-1);
  rerender(<Ledger12MonthForecast months={[]} />);
  expect(screen.queryAllByRole("group")).toHaveLength(0);
});
