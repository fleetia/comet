import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TravelSummary, WidgetRow, type WidgetLayout } from "./Widgets";
import * as styles from "./widgets.css";

afterEach(cleanup);
const description =
  "qa long calendar alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";

describe("fixed-height widget row descriptions", () => {
  it.each<WidgetLayout>(["row", "stack", "editor", "compact", "desktop", "flow"])(
    "preserves the full calendar text and tooltip in %s layout",
    async (layout) => {
      const select = vi.fn();
      render(
        <WidgetRow
          kind="envelope"
          icon="calendar"
          title="캘린더"
          description={description}
          value="오후 10:50"
          layout={layout}
          onClick={select}
          style={{ width: 330 }}
        />,
      );
      const copy = screen.getByText(description);
      expect(copy.className).toContain(styles.rowDescription);
      expect(copy.getAttribute("title")).toBe(description);
      const row = screen.getByRole("button", { name: new RegExp(description) });
      await userEvent.setup().click(row);
      expect(select).toHaveBeenCalledOnce();
    },
  );

  it("keeps short music descriptions and omits absent descriptions", () => {
    const { rerender } = render(
      <WidgetRow kind="music" title="밤의 산책" description="별빛정원" />,
    );
    expect(screen.getByTitle("별빛정원").textContent).toBe("별빛정원");
    rerender(<WidgetRow kind="clock" title="3:24" />);
    expect(screen.queryByTitle("별빛정원")).toBeNull();
  });

  it("does not apply row truncation to other small-text consumers", () => {
    render(<TravelSummary title="여행" description={description} countdown="D-3" />);
    expect(screen.getByText(description).className).not.toContain(styles.rowDescription);
  });
});

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
