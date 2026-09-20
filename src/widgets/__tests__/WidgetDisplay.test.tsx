import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { WidgetDisplay } from "../WidgetDisplay/WidgetDisplay";
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import type { WidgetValue, WidgetView } from "../types";

vi.mock("../useWidgets", async (load) => ({
  ...(await load<typeof import("../useWidgets")>()),
  useWidgets: vi.fn(),
}));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));

function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    installed: true,
    enabled: true,
    revision: 2,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
    backgroundUpdatedAt: null,
  };
}

function snapshot(entry: WidgetView): ReturnType<typeof useWidgets>["snapshot"] {
  return { ...PREVIEW_WIDGETS, widgets: [entry] };
}

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
  vi.mocked(isDesktop).mockReturnValue(true);
});
afterEach(cleanup);

it("shows configured anniversary D-day values in the detached display", () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-20T12:00:00+09:00").getTime());
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(
      widget("clock", {
        appearance: {
          backgroundColor: "#24202d",
          backgroundPosition: "center-center",
          textColor: "#fffaf2",
          textPosition: "bottom-right",
        },
        anniversaries: [{ id: "day", title: "우리의 날", date: "2026-09-22" }],
      }),
    ),
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetDisplay id="clock" />);
  expect(screen.getByText("우리의 날")).toBeTruthy();
  expect(screen.getByText("D-2")).toBeTruthy();
  const main = screen.getByRole("main");
  expect(main).toHaveProperty("style.backgroundColor", "rgb(36, 32, 45)");
  expect(main).toHaveProperty("style.alignItems", "flex-end");
  expect(main).toHaveProperty("style.justifyContent", "flex-end");
});

it.each([
  [
    "weather",
    {
      configured: true,
      status: "ready",
      observation: { name: "서울", temperature: 21.5, temperatureUnit: "°C", weatherCode: 1 },
    },
    "21.5°C",
  ],
  [
    "device",
    {
      configured: true,
      status: "ready",
      observation: {
        hasBattery: true,
        batteries: [{ percent: 64, status: "discharging" }],
        powerSource: "battery",
      },
    },
    "64%",
  ],
])("shows %s information in the detached display", (kind, data, expected) => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(widget(kind, data)),
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetDisplay id={kind} />);
  expect(screen.getByText(expected)).toBeTruthy();
});
