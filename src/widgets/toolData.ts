import type { WidgetValue, WidgetView } from "./types";
export type DataRecord = { [key: string]: WidgetValue };
export type ToolAction = (
  action: string,
  input?: DataRecord,
  target?: WidgetView,
) => Promise<boolean>;
export function record(value: WidgetValue | undefined): DataRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export function rows(value: WidgetValue | undefined): DataRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}
export function text(value: WidgetValue | undefined): string {
  return typeof value === "string" ? value : "";
}
export function number(value: WidgetValue | undefined): number {
  return typeof value === "number" ? value : 0;
}
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
