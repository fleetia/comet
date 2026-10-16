import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WidgetShape } from "@comet/ui";
import { getWidgetPreview } from "../previewWidgets";
import { FreeformWidget } from "../WidgetDisplay/DesktopWidget";
import { WidgetDetailPreview } from "./WidgetDetailPreview";
import type { WidgetView } from "../types";

const NOW = new Date("2026-10-15T12:00:00").getTime();
const shape: WidgetShape = {
  source: "preset",
  preset: "circle",
  cloudCount: 0,
  roundness: 0,
  rotation: 0,
  flipX: false,
  flipY: false,
  fitContent: false,
  width: 200,
  height: 200,
  strokes: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const html = (element: Element): string => element.innerHTML.replace(/_r_\w+_/g, "id");

function preview(kind: string): WidgetView {
  const widget = getWidgetPreview().widgets.find((item) => item.kind === kind);
  if (!widget) throw new Error(`${kind} preview is required`);
  return widget;
}

it.each(["clock", "weather", "calendar", "music", "preparation"])(
  "renders the %s preview with the same desktop widget and saved shape",
  (kind) => {
    const widget = preview(kind);
    const widgets = getWidgetPreview().widgets;
    const expected = html(
      render(<FreeformWidget widget={widget} widgets={widgets} now={NOW} shape={shape} />)
        .container,
    );
    cleanup();
    render(<WidgetDetailPreview widget={widget} widgets={widgets} shape={shape} />);
    expect(html(screen.getByRole("figure", { name: "바탕화면 위젯 미리보기" }))).toBe(expected);
  },
);

it("shows saved weather appearance colors through the shared renderer", () => {
  const widget = {
    ...preview("weather"),
    data: {
      ...(preview("weather").data as Record<string, unknown>),
      appearance: { backgroundColor: "#335577", textColor: "#ffeecc" },
    },
  } as WidgetView;
  const expected = render(
    <FreeformWidget
      widget={widget}
      now={NOW}
      backgroundColor="#335577"
      textColor="#ffeecc"
      imagePosition="center center"
    />,
  ).container.innerHTML;
  cleanup();
  render(<WidgetDetailPreview widget={widget} />);
  expect(screen.getByRole("figure", { name: "바탕화면 위젯 미리보기" }).innerHTML).toBe(expected);
});

it("has no desktop preview for a widget that cannot be placed on the desktop", () => {
  const view = render(<WidgetDetailPreview widget={{ ...preview("clock"), kind: "fortune" }} />);
  expect(view.container.innerHTML).toBe("");
});
