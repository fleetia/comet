import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { WidgetView } from "../types";
import { CollapsedDesktopWidget } from "./DesktopWidget";

afterEach(cleanup);

it.each([false, true])(
  "preserves a long calendar title in the fixed row (expanded: %s)",
  (expanded) => {
    const title =
      "qa long calendar alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega";
    const now = new Date("2026-10-16T12:00:00Z").getTime();
    const widget: WidgetView = {
      id: "calendar",
      kind: "calendar",
      version: 1,
      reaction: true,
      revision: 1,
      data: { events: [{ id: "long", title, startAt: now + 3600000 }] },
      error: null,
      status: "enabled",
      missing: [],
      packageBytes: 0,
    };
    render(
      <CollapsedDesktopWidget widget={widget} now={now} expanded={expanded} onExpand={vi.fn()} />,
    );
    expect(screen.getByTitle(title).textContent).toBe(title);
    expect(screen.getByRole("button", { expanded }).textContent).toContain(title);
    expect(widget.data).toEqual({ events: [{ id: "long", title, startAt: now + 3600000 }] });
  },
);
