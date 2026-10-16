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
