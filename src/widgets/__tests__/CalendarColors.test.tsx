import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarColors } from "../Planner/CalendarColors";
import type { DataRecord } from "../toolData";

afterEach(cleanup);

it("opens a named palette, saves its source immediately, and shows the persisted selection", () => {
  const connections: DataRecord[] = [
    {
      id: "apple",
      name: "이 Mac",
      provider: "apple",
      selectedCalendarIds: ["personal"],
      calendarNames: { personal: "개인" },
    },
  ];
  const onChange = vi.fn();
  const view = render(
    <CalendarColors
      connections={connections}
      events={[]}
      colors={{ apple: { personal: "#3478d4" } }}
      onChange={onChange}
    />,
  );
  expect(screen.getByText("개인")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이 Mac · 개인 색상 변경" }));
  const palette = screen.getByRole("group", { name: "이 Mac · 개인 색상 선택" });
  expect(within(palette).getAllByRole("button")).toHaveLength(8);
  expect(within(palette).getByRole("button", { name: "파랑" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(within(palette).getByRole("button", { name: "빨강" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    connectionId: "apple",
    calendarId: "personal",
    color: "#d83a46",
  });
  view.rerender(
    <CalendarColors
      connections={connections}
      events={[]}
      colors={{ apple: { personal: "#d83a46" } }}
      onChange={onChange}
      disabled
    />,
  );
  const selected = screen.getByRole("button", { name: "빨강" });
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  expect(selected.textContent).toContain("✓");
  for (const button of screen.getAllByRole("button")) {
    expect(button).toHaveProperty("disabled", true);
  }
  fireEvent.click(screen.getByRole("button", { name: "파랑" }));
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("filters a connection settings palette and sends the empty calendar key for ICS", () => {
  const onChange = vi.fn();
  render(
    <CalendarColors
      connections={[
        { id: "ics", provider: "ics", name: "가족 일정" },
        { id: "other", provider: "ics", name: "다른 구독" },
      ]}
      events={[{ connectionId: "ics", sourceId: "event-uid" }]}
      colors={{}}
      onChange={onChange}
      connectionId="ics"
    />,
  );
  expect(screen.queryByText("다른 구독")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "가족 일정 색상 변경" }));
  fireEvent.click(screen.getByRole("button", { name: "보라" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    connectionId: "ics",
    calendarId: "",
    color: "#8854b8",
  });
});
