// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WidgetSettings } from "./WidgetSettings";
import type { WidgetView } from "../types";

afterEach(cleanup);

function installed(kind: string): WidgetView {
  return {
    id: kind,
    kind,
    enabled: true,
    installed: true,
    revision: 1,
    version: 1,
    data: {},
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 1,
  };
}

it("preserves an anniversary draft across inactive settings and clears its dirty state on unmount", async () => {
  const user = userEvent.setup();
  const onDirtyChange = vi.fn();
  const props = { widget: installed("clock"), act: vi.fn(), onDirtyChange };
  const view = render(<WidgetSettings {...props} active />);
  expect(screen.queryByRole("radiogroup", { name: "글자 위치" })).toBeNull();
  expect(screen.queryByRole("button", { name: "표시 설정 저장" })).toBeNull();
  screen.getByRole("button", { name: "기념일 추가…" }).focus();
  await user.keyboard("{Enter}");
  const title = screen.getByRole("textbox", { name: "기념일 이름" });
  await user.type(title, "함께한 날");
  expect(onDirtyChange).toHaveBeenLastCalledWith("clock", true);
  view.rerender(<WidgetSettings {...props} active={false} />);
  view.rerender(<WidgetSettings {...props} active />);
  expect(title).toHaveProperty("value", "함께한 날");
  expect(props.act).not.toHaveBeenCalled();
  view.unmount();
  expect(onDirtyChange).toHaveBeenLastCalledWith("clock", false);
});

it("preserves a weather search through inactive and disabled settings", async () => {
  const user = userEvent.setup();
  const widget = installed("weather");
  const props = { widget, active: true, act: vi.fn(), onDirtyChange: vi.fn() };
  const view = render(<WidgetSettings {...props} />);
  const query = screen.getByRole("textbox", { name: "지역 이름" });
  await user.type(query, "제주");
  view.rerender(<WidgetSettings {...props} active={false} disabled />);
  expect(query.matches(":disabled")).toBe(true);
  view.rerender(<WidgetSettings {...props} active />);
  expect(query).toHaveProperty("value", "제주");
  expect(props.onDirtyChange).toHaveBeenLastCalledWith("weather", true);
  expect(props.act).not.toHaveBeenCalled();
});
