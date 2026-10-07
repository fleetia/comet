import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

it("keeps display controls available and preserves appearance edits when collapsed with the keyboard", async () => {
  const user = userEvent.setup();
  const onDirtyChange = vi.fn();
  render(
    <WidgetSettings
      widget={installed("clock")}
      active
      act={vi.fn()}
      onDirtyChange={onDirtyChange}
      displayControls={<button type="button">바탕화면 표시</button>}
    />,
  );
  expect(screen.getByRole("combobox", { name: "시계 형식" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "바탕화면 표시" })).toBeTruthy();
  expect(screen.queryByRole("radiogroup", { name: "글자 위치" })).toBeNull();
  expect(screen.queryByRole("button", { name: "표시 설정 저장" })).toBeNull();

  const disclosure = screen.getByRole("button", { name: "바탕화면 꾸미기" });
  disclosure.focus();
  await user.keyboard("{Enter}");
  const placement = within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole(
    "radio",
    { name: "오른쪽 아래" },
  );
  await user.click(placement);
  expect(onDirtyChange).toHaveBeenLastCalledWith("clock", true);

  disclosure.focus();
  await user.keyboard(" ");
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("radiogroup", { name: "글자 위치" })).toBeNull();
  expect(screen.getByRole("button", { name: "표시 설정 저장" })).toHaveProperty("disabled", false);
  await user.click(disclosure);
  expect(
    within(screen.getByRole("radiogroup", { name: "글자 위치" }))
      .getByRole("radio", { name: "오른쪽 아래" })
      .getAttribute("aria-checked"),
  ).toBe("true");

  await user.click(disclosure);
  await user.click(screen.getByRole("button", { name: "표시 변경 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith("clock", false);
  expect(screen.queryByRole("button", { name: "표시 설정 저장" })).toBeNull();
});

it("keeps the weather search primary while appearance and observation are optional", async () => {
  const user = userEvent.setup();
  const widget = installed("weather");
  const props = { widget, active: true, act: vi.fn(), onDirtyChange: vi.fn() };
  const view = render(<WidgetSettings {...props} />);
  const query = screen.getByRole("textbox", { name: "지역 이름" });
  await user.type(query, "제주");
  const details = screen.getByText("최근 날씨 정보").closest("details");
  expect(details).toHaveProperty("open", false);
  await user.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  await user.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  view.rerender(<WidgetSettings {...props} active={false} />);
  view.rerender(<WidgetSettings {...props} active />);
  expect(query).toHaveProperty("value", "제주");
  expect(props.onDirtyChange).toHaveBeenLastCalledWith("weather", true);
  expect(props.act).not.toHaveBeenCalled();
});
