import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import catalog from "../../../widgets/catalog.json";
import { WidgetCatalog, type WidgetListEntry } from "./WidgetCatalog";

const entries: WidgetListEntry[] = catalog.map((item) => ({
  ...item,
  installed: item.id === "focus-timer",
  status: item.id === "focus-timer" ? "enabled" : "not-installed",
  attention: false,
}));
afterEach(cleanup);

it("shows the three Figma catalog groups and lets keyboard users open a widget", async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  render(<WidgetCatalog entries={entries} selectedId="focus-timer" onSelect={select} />);
  const daily = within(screen.getByRole("region", { name: "하루 도구" }));
  expect(daily.getByRole("button", { name: "시계·기념일 미설치" })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "놀이 상자" })).getAllByRole("button"),
  ).toHaveLength(10);
  expect(
    within(screen.getByRole("region", { name: "생활 정보" })).getAllByRole("button"),
  ).toHaveLength(3);
  expect(daily.getByRole("button", { name: "할 일 완료 구슬 미설치" })).toBeTruthy();
  const focus = daily.getByRole("button", { name: "집중 타이머 켜짐" });
  expect(focus.getAttribute("aria-pressed")).toBe("true");
  focus.focus();
  await user.keyboard("{Enter}");
  expect(select).toHaveBeenCalledExactlyOnceWith("focus-timer");
});

it("filters by name and restores every group when search is cleared", () => {
  const select = vi.fn();
  render(<WidgetCatalog entries={entries} selectedId="todo" onSelect={select} />);
  const search = screen.getByRole("searchbox", { name: "위젯 검색" });
  fireEvent.change(search, { target: { value: "날씨" } });
  expect(screen.getByRole("button", { name: "날씨 미설치" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "할 일 미설치" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "날씨 미설치" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("weather");
  fireEvent.change(search, { target: { value: "없는 위젯" } });
  expect(screen.getByText("찾는 위젯이 없어요. 검색어를 바꿔 보세요.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "할 일 미설치" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "시계·기념일 미설치" })).toBeTruthy();
});

it("keeps row navigation separate from toggle actions and exposes errors", () => {
  const select = vi.fn();
  const toggle = vi.fn();
  render(
    <WidgetCatalog
      entries={entries.map((item) =>
        item.id === "calendar"
          ? { ...item, status: "install-error" as const, attention: true }
          : item,
      )}
      selectedId="focus-timer"
      onSelect={select}
      onToggle={toggle}
    />,
  );
  expect(screen.getByRole("button", { name: "캘린더 설치 오류" }).textContent).toContain(
    "설치 오류",
  );
  expect(screen.getByRole("switch", { name: "집중 타이머 사용" })).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("switch", { name: "집중 타이머 사용" }));
  expect(toggle).toHaveBeenCalledExactlyOnceWith("focus-timer", false);
  expect(select).not.toHaveBeenCalled();
});
