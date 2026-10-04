import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiaryWidgetShelf } from "../Planner/DiaryWidgetShelf";
import type { WidgetSnapshot, WidgetView } from "../types";
import { hasWidgetDrag, readWidgetDrag, WIDGET_DRAG_TYPE, writeWidgetDrag } from "../widgetDrag";

afterEach(cleanup);

function widget(kind: string, data: WidgetView["data"]): WidgetView {
  return {
    id: `${kind}-widget`,
    kind,
    data,
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 1,
  };
}

function transfer(): Pick<DataTransfer, "getData" | "setData" | "effectAllowed" | "types"> {
  const values = new Map<string, string>();
  return {
    getData: (type) => values.get(type) ?? "",
    setData: (type, value) => {
      values.set(type, value);
    },
    effectAllowed: "none",
    get types() {
      return [...values.keys()];
    },
  };
}

it("links widgets and todos while keeping individual memo management in Diary notes", () => {
  const todo = widget("todo", { items: [{ id: "todo-1", title: "책 읽기", completedAt: null }] });
  const memo = widget("memo", { notes: [{ id: "memo-1", body: "책 모임 메모" }] });
  const inactive = { ...widget("clock", {}), enabled: false };
  const snapshot: WidgetSnapshot = {
    catalog: [],
    widgets: [todo, memo, inactive],
    onboardingDone: true,
  };
  const onOpenWidget = vi.fn(),
    onAdd = vi.fn();
  render(
    <DiaryWidgetShelf snapshot={snapshot} busy={false} onOpenWidget={onOpenWidget} onAdd={onAdd} />,
  );
  fireEvent.click(screen.getByText("위젯"));
  screen.getAllByText("내용 1개").forEach((summary) => fireEvent.click(summary));
  fireEvent.click(screen.getByTitle("todo 열기"));
  expect(onOpenWidget).toHaveBeenCalledWith(todo);
  expect(screen.queryByTitle("책 모임 메모")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "책 읽기 연결" }));
  expect(onAdd).toHaveBeenCalledWith({ v: 1, kind: "todo", widgetId: todo.id, itemId: "todo-1" });
  fireEvent.click(screen.getByRole("button", { name: "memo 위젯 연결" }));
  expect(onAdd).toHaveBeenLastCalledWith({ v: 1, kind: "widget", widgetId: memo.id });
  expect(screen.queryByTitle("clock 열기")).toBeNull();
});

it("drags a reference without embedding content, including the cross-window text fallback", () => {
  const data = transfer();
  const payload = { v: 1, kind: "memo", widgetId: "memo-widget", itemId: "memo-1" } as const;
  writeWidgetDrag(data, payload);
  expect(hasWidgetDrag(data)).toBe(true);
  expect(readWidgetDrag(data)).toEqual(payload);
  expect(
    readWidgetDrag({ getData: (type) => (type === "text/plain" ? data.getData(type) : "") }),
  ).toEqual(payload);
  expect(readWidgetDrag({ getData: () => "메모 본문" })).toBeNull();
});

it.each([
  { v: 2, kind: "todo", widgetId: "todo-widget", itemId: "todo-1" },
  { v: 1, kind: "todo", widgetId: "todo-widget" },
  { v: 1, kind: "widget", widgetId: "memo-widget", itemId: "memo-1" },
  { v: 1, kind: "unknown", widgetId: "memo-widget", itemId: "memo-1" },
  { v: 1, kind: "todo", widgetId: "bad id", itemId: "todo-1" },
])("rejects unsupported drag identities %#", (payload) => {
  const data = transfer();
  data.setData(WIDGET_DRAG_TYPE, JSON.stringify(payload));
  expect(readWidgetDrag(data)).toBeNull();
});
