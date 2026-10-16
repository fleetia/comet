import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HabitMonthCalendar, HabitWeekTable } from "./Habit";

afterEach(cleanup);
it("preserves month record identity, selection and disabled dates without submitting a form", () => {
  const change = vi.fn();
  const submit = vi.fn();
  const day = {
    id: "2026-10-15",
    day: 15,
    label: "10월 15일",
    state: "done" as const,
    today: true,
    selected: true,
  };
  render(
    <form onSubmit={submit}>
      <HabitMonthCalendar
        label="10월"
        days={[
          null,
          day,
          { ...day, id: "2026-10-16", day: 16, label: "10월 16일", disabled: true },
        ]}
        onDayChange={change}
      />
    </form>,
  );
  const button = screen.getByRole("button", { name: "10월 15일: 했어요" });
  expect(button.getAttribute("aria-current")).toBe("date");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "10월 16일: 했어요" }));
  expect(change).toHaveBeenCalledExactlyOnceWith(day);
  expect(submit).not.toHaveBeenCalled();
});

it.each([7, 28, 29, 30, 31])("preserves all %i table dates and the last-day callback", (length) => {
  const change = vi.fn();
  const days = Array.from({ length }, (_, index) => ({
    id: `day-${index + 1}`,
    weekday: "목",
    date: String(index + 1),
  }));
  const records = days.map((day) => ({
    id: day.id,
    label: `${day.date}일`,
    state: "counting" as const,
    count: 2,
  }));
  render(
    <HabitWeekTable
      days={days}
      habits={[{ id: "count", title: "물 마시기", selected: true, days: records }]}
      onHabitDayChange={change}
    />,
  );
  expect(screen.getAllByRole("button", { name: /횟수 기록 중/ })).toHaveLength(length);
  fireEvent.click(screen.getByRole("button", { name: `${length}일: 횟수 기록 중 2회` }));
  expect(change).toHaveBeenCalledExactlyOnceWith("count", records[length - 1], length - 1);
});
