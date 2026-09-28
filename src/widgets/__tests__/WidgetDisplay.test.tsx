import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

it.each([
  [null, null, "표시를 불러오고 있어요."],
  [null, "위젯을 불러오지 못했어요.", "위젯을 불러오지 못했어요."],
  [{ ...PREVIEW_WIDGETS, widgets: [] }, null, "사용할 수 없는 위젯이에요."],
])("keeps the display closable without widget data (%s, %s)", (snapshot, error, message) => {
  vi.mocked(useWidgets).mockReturnValue({ snapshot, error, reload: vi.fn() });
  render(<WidgetDisplay id="clock" />);

  expect(screen.getByText(message)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 위젯 닫기" }));
  expect(command).toHaveBeenCalledExactlyOnceWith("close_widget_display", { id: "clock" });
});

it("shows a close failure while the display is still loading", async () => {
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: null, reload: vi.fn() });
  vi.mocked(command).mockRejectedValue(new Error("창을 닫지 못했어요."));
  render(<WidgetDisplay id="clock" />);

  fireEvent.click(screen.getByRole("button", { name: "바탕화면 위젯 닫기" }));
  expect(await screen.findByText("창을 닫지 못했어요.")).toBeTruthy();
});

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
