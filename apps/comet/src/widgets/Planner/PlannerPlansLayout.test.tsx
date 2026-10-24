import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as fields from "../../../../../ds/ui/src/controls/fields.css";
import * as s from "./planner.css";
import { PlannerPlans } from "./PlannerPlans";

afterEach(cleanup);

it("constrains the whole list filter while preserving its label and controlled selection", () => {
  const longName = "QA weekend packing with a long list name";
  const onVisibleListChange = vi.fn();
  const props: ComponentProps<typeof PlannerPlans> = {
    period: "week",
    planDay: "2026-10-19",
    planScope: "이번 주",
    shown: [],
    items: [],
    lists: [
      { id: "default", name: "할 일" },
      { id: "packing", name: longName },
    ],
    visibleList: "packing",
    showCompleted: false,
    hasTodo: true,
    todoInstalled: true,
    headerActions: true,
    busy: false,
    act: vi.fn().mockResolvedValue(true),
    quickInput: null,
    renderCheck: () => <span />,
    onPeriodChange: vi.fn(),
    onPlanDayChange: vi.fn(),
    onVisibleListChange,
    onShowCompletedChange: vi.fn(),
    onManageLists: vi.fn(),
    onEdit: vi.fn(),
    onEnableTodo: vi.fn().mockResolvedValue(undefined),
  };
  const { rerender } = render(<PlannerPlans {...props} />);
  const select = screen.getByRole("combobox", { name: "조회할 목록" }) as HTMLSelectElement;
  expect(select.classList.contains(s.listSelect)).toBe(false);
  expect(select.classList.contains(fields.fillSelect)).toBe(true);
  const field = select.parentElement?.parentElement;
  expect(select.parentElement?.classList.contains(fields.fillSelectContainer)).toBe(true);
  expect(field?.classList.contains(fields.fillField)).toBe(true);
  expect(field?.parentElement?.classList.contains(s.listSelect)).toBe(true);
  expect(select.value).toBe("packing");
  expect(screen.getByRole("option", { name: longName }).textContent).toBe(longName);
  for (const value of ["all", "default", "packing"]) {
    fireEvent.change(select, { target: { value } });
    expect(onVisibleListChange).toHaveBeenLastCalledWith(value);
    rerender(<PlannerPlans {...props} visibleList={value} />);
    expect(select.value).toBe(value);
  }
});
