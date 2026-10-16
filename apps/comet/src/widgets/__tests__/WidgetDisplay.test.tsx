import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { DEFAULT_APPEARANCE } from "../widgetAppearance";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { WidgetDisplay } from "../WidgetDisplay/WidgetDisplay";
import { CollapsedDesktopWidget, FreeformWidget } from "../WidgetDisplay/DesktopWidget";
import { PREVIEW_WIDGETS, useWidgets } from "../useWidgets";
import type { WidgetValue, WidgetView } from "../types";

const startDragging = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn().mockResolvedValue(undefined),
}));

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
  startDragging.mockClear();
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue({ revision: 0, editing: false, shapes: {} });
  vi.mocked(emit).mockClear();
  vi.mocked(isDesktop).mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("uses the active envelope and linked task progress in both desktop summaries", () => {
  const now = new Date("2026-10-08T12:00:00").getTime();
  const preparation = widget("preparation", {
    envelopes: [
      { id: "archived", title: "보관한 봉투", archived: true, checks: [{ done: true }] },
      {
        id: "active",
        title: "여행 준비",
        date: "2026-10-24",
        checks: [{ done: true }, { done: false }],
        todoIds: ["done", "open", "repeated"],
      },
    ],
  });
  const todo = widget("todo", {
    items: [
      { id: "done", completedAt: now },
      { id: "open", completedAt: null },
      {
        id: "repeated",
        repeatRule: { mode: "frequency" },
        frequencyRecords: [{ id: "record", date: "2026-10-08" }],
      },
    ],
  });
  const widgets = [preparation, todo];
  const view = render(
    <CollapsedDesktopWidget
      widget={preparation}
      widgets={widgets}
      now={now}
      onExpand={() => undefined}
    />,
  );
  expect(screen.getByText("여행 준비")).toBeTruthy();
  expect(screen.queryByText("보관한 봉투")).toBeNull();
  expect(screen.getByText("3/5")).toBeTruthy();
  view.rerender(<FreeformWidget widget={preparation} widgets={widgets} now={now} />);
  expect(screen.getByText("여행 준비")).toBeTruthy();
  expect(screen.getByText("3/5")).toBeTruthy();
});

it("draws one freeform renderer without a close button outside edit mode", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(
      widget("clock", {
        format: "24h",
        anniversaries: [{ id: "day", title: "우리의 날", date: "2026-09-22" }],
        appearance: {
          ...DEFAULT_APPEARANCE,
          backgroundColor: "#112233",
          textPosition: "bottom-right",
        },
      }),
    ),
    error: null,
    reload: vi.fn(),
  });
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-20T12:00:00+09:00").getTime());
  render(<WidgetDisplay id="clock" />);
  expect(screen.getByText("D-2")).toBeTruthy();
  expect(screen.getByRole("region", { name: /내용/ }).textContent).toMatch(/\d{1,2}:\d{2}/);
  expect(screen.getByRole("main").style.backgroundColor).toBe("");
  expect(screen.queryByRole("button", { name: /닫기/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /바탕화면에서 빼기/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /크기 조절/ })).toBeNull();
});

it("keeps window dragging available on the widget", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(widget("clock", { appearance: DEFAULT_APPEARANCE })),
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetDisplay id="clock" />);
  const main = screen.getByRole("main");
  fireEvent(main, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0 }));
  fireEvent(main, new MouseEvent("pointermove", { bubbles: true, buttons: 1, clientX: 20 }));
  expect(startDragging).toHaveBeenCalledTimes(1);
});

it.each([
  [null, null, "위젯을 불러오고 있어요.", false],
  [{ ...PREVIEW_WIDGETS, widgets: [] }, null, "바탕화면에 놓을 수 없는 위젯이에요.", true],
])(
  "reports a missing widget (%#) and only then offers closing",
  async (data, error, message, closable) => {
    vi.mocked(useWidgets).mockReturnValue({ snapshot: data, error, reload: vi.fn() });
    render(<WidgetDisplay id="clock" />);
    expect(screen.getByText(message)).toBeTruthy();
    const close = screen.queryByRole("button", { name: "바탕화면 위젯 닫기" });
    expect(Boolean(close)).toBe(closable);
    if (close) {
      vi.mocked(command).mockRejectedValueOnce(new Error("창을 닫지 못했어요."));
      fireEvent.click(close);
      expect(command).toHaveBeenCalledWith("remove_widget_desktop_item", { id: "clock" });
      expect(await screen.findByText("창을 닫지 못했어요.")).toBeTruthy();
    }
  },
);

describe("edit mode", () => {
  const shape = {
    source: "preset" as const,
    preset: "default",
    cloudCount: 4,
    roundness: 70,
    rotation: 0,
    flipX: false,
    flipY: false,
    fitContent: true,
    width: 200,
    height: 120,
    strokes: [],
  };
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    vi.mocked(command).mockImplementation(async (name) =>
      name === "get_widget_desktop"
        ? { revision: 3, editing: true, order: ["weather"], shapes: { weather: shape } }
        : { revision: 4, editing: true, order: [], shapes: {} },
    );
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: snapshot(
        widget("weather", {
          status: "ready",
          appearance: DEFAULT_APPEARANCE,
          observation: { name: "서울", temperature: 21, temperatureUnit: "°C", weatherCode: 0 },
        }),
      ),
      error: null,
      reload: vi.fn(),
    });
  });

  it("removes the widget from the desktop with the minus button", async () => {
    render(<WidgetDisplay id="weather" />);
    fireEvent.click(await screen.findByRole("button", { name: /바탕화면에서 빼기/ }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("remove_widget_desktop_item", { id: "weather" }),
    );
    expect(screen.queryByRole("button", { name: /닫기/ })).toBeNull();
  });

  it("broadcasts selection when the widget is tapped", async () => {
    render(<WidgetDisplay id="weather" />);
    await screen.findByRole("button", { name: /크기 조절/ });
    const content = screen.getByRole("region", { name: /내용/ });
    fireEvent(content, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    fireEvent(content, new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(emit).toHaveBeenCalledWith("widget-desktop-selection", "weather");
  });

  it("previews a resize locally and saves the shape once when the pointer is released", async () => {
    render(<WidgetDisplay id="weather" />);
    const handle = await screen.findByRole("button", { name: /크기 조절/ });
    fireEvent(
      handle,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
    );
    fireEvent(handle, new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 30 }));
    expect(screen.getByRole("status").textContent).toBe("240 × 140");
    expect(command).not.toHaveBeenCalledWith("set_widget_desktop_shape", expect.anything());
    fireEvent(handle, new MouseEvent("pointerup", { bubbles: true, clientX: 60, clientY: 30 }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("set_widget_desktop_shape", {
        id: "weather",
        shape: { ...shape, width: 250, height: 140 },
      }),
    );
    expect(emit).not.toHaveBeenCalled();
  });
});

it("keeps the saved twelve-hour period out of the large freeform time value", () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 8, 20, 15, 24, 12).getTime());
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(
      widget("clock", {
        format: "12h",
        showSeconds: true,
        anniversaries: [],
        appearance: DEFAULT_APPEARANCE,
      }),
    ),
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetDisplay id="clock" />);
  expect(screen.getByText("3:24:12")).toBeTruthy();
  expect(screen.getByText("오후")).toBeTruthy();
  expect(screen.queryByText("오후 3:24:12")).toBeNull();
});

it("labels a cached weather observation as stale in the freeform widget", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: snapshot(
      widget("weather", {
        status: "error",
        appearance: DEFAULT_APPEARANCE,
        observation: { name: "서울", temperature: 21, temperatureUnit: "°C", weatherCode: 0 },
      }),
    ),
    error: null,
    reload: vi.fn(),
  });
  render(<WidgetDisplay id="weather" />);
  expect(screen.getByText("21°C")).toBeTruthy();
  expect(screen.getByText(/· 이전 정보/)).toBeTruthy();
});
