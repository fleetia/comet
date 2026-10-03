export const WIDGET_DRAG_TYPE = "application/x-comet-item+json";
const TEXT_PREFIX = "comet-item:";

export type WidgetDragPayload =
  | { v: 1; kind: "widget"; widgetId: string; itemId?: never }
  | { v: 1; kind: "todo" | "memo" | "envelope"; widgetId: string; itemId: string };

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/\s/.test(value);
}

function parsePayload(raw: string): WidgetDragPayload | null {
  if (!raw || raw.length > 1000) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const item = value as Record<string, unknown>;
    if (item.v !== 1 || !identifier(item.widgetId)) {
      return null;
    }
    if (item.kind === "widget") {
      return item.itemId === undefined ? { v: 1, kind: "widget", widgetId: item.widgetId } : null;
    }
    if (
      (item.kind === "todo" || item.kind === "memo" || item.kind === "envelope") &&
      identifier(item.itemId)
    ) {
      return { v: 1, kind: item.kind, widgetId: item.widgetId, itemId: item.itemId };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWidgetDrag(
  data: Pick<DataTransfer, "effectAllowed" | "setData">,
  payload: WidgetDragPayload,
): void {
  const raw = JSON.stringify(payload);
  data.effectAllowed = "all";
  data.setData(WIDGET_DRAG_TYPE, raw);
  data.setData("text/plain", `${TEXT_PREFIX}${raw}`);
}

export function readWidgetDrag(data: Pick<DataTransfer, "getData">): WidgetDragPayload | null {
  const raw = data.getData(WIDGET_DRAG_TYPE);
  if (raw) {
    return parsePayload(raw);
  }
  const plain = data.getData("text/plain");
  return plain.startsWith(TEXT_PREFIX) ? parsePayload(plain.slice(TEXT_PREFIX.length)) : null;
}

export function hasWidgetDrag(data: Pick<DataTransfer, "types">): boolean {
  const types = Array.from(data.types);
  return types.includes(WIDGET_DRAG_TYPE) || types.includes("text/plain");
}
