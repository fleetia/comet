import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetRow, type WidgetLayout } from "./Widgets";
import * as styles from "./widgets.css";

afterEach(cleanup);

const anniversary = "qa anniversary long title 0123456789";
const layouts: WidgetLayout[] = ["row", "stack", "editor", "compact", "desktop", "flow"];

describe("clock row content priority", () => {
  it.each(layouts)("preserves the time and full anniversary content in %s", async (layout) => {
    const onClick = vi.fn();
    render(
      <WidgetRow
        kind="clock"
        title="12:59:59"
        period="오후"
        layout={layout}
        style={{ width: 330 }}
        meta={
          <>
            <strong>D-day</strong>
            <br />
            {anniversary}
          </>
        }
        onClick={onClick}
      />,
    );
    const time = screen.getByText("12:59:59");
    expect(time.parentElement?.classList.contains(styles.rowClockCopy)).toBe(true);
    expect(screen.getByText(anniversary).classList.contains(styles.rowClockMeta)).toBe(true);
    expect(screen.getByText("오후")).toBeTruthy();
    const icons = screen.getByRole("button").querySelectorAll("svg");
    expect(icons).toHaveLength(layout === "editor" ? 2 : 1);
    for (const icon of icons) expect(icon.classList.contains(styles.rowClockIcon)).toBe(true);
    expect(screen.getByRole("button").textContent).toContain(anniversary);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(["weather", "music", "envelope", "focus"] as const)(
    "keeps the existing %s row sizing classes",
    (kind) => {
      render(<WidgetRow kind={kind} title="기존 제목" value="23" meta="부가 정보" />);
      expect(
        screen.getByText("기존 제목").parentElement?.classList.contains(styles.rowClockCopy),
      ).toBe(false);
      expect(screen.getByText("부가 정보").classList.contains(styles.rowClockMeta)).toBe(false);
      expect(screen.getByText("23")).toBeTruthy();
    },
  );
});
