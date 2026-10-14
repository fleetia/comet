import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("groups all official widgets by use and remembers keyboard folding without changing selection", async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <WidgetCatalog entries={entries} selectedId="focus-timer" onSelect={select} />,
  );
  const daily = screen.getByRole("button", { name: "하루 도구 5개" });
  expect(screen.getByRole("button", { name: "놀이 상자 6개" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(screen.getByRole("button", { name: "생활 정보 3개" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  daily.focus();
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("button", { name: "집중 타이머 켜짐" })).toBeNull();
  expect(select).not.toHaveBeenCalled();
  view.unmount();
  render(<WidgetCatalog entries={entries} selectedId="focus-timer" onSelect={select} />);
  expect(screen.getByRole("button", { name: "하루 도구 5개" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "생활 정보 3개" }));
  expect(
    within(screen.getByRole("region", { name: "생활 정보" })).getByRole("button", {
      name: "시계·기념일 미설치",
    }),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "하루 도구" })).queryByRole("button", {
      name: "시계·기념일 미설치",
      hidden: true,
    }),
  ).toBeNull();
});

it("reveals search results temporarily and clears the search for a related-widget navigation", () => {
  const select = vi.fn();
  const view = render(<WidgetCatalog entries={entries} selectedId="todo" onSelect={select} />);
  expect(screen.queryByRole("combobox")).toBeNull();
  const search = screen.getByRole("searchbox", { name: "위젯 검색" });
  fireEvent.change(search, { target: { value: "날씨" } });
  expect(screen.getByRole("button", { name: "날씨 미설치" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "생활 정보 1개" }));
  expect(screen.queryByRole("button", { name: "날씨 미설치" })).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "생활 정보 3개" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  fireEvent.change(search, { target: { value: "할 일" } });
  view.rerender(<WidgetCatalog entries={entries} selectedId="clock" onSelect={select} />);
  expect(search).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "시계·기념일 미설치" })).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
});

it("shows status text only for installed widgets and widgets that need attention", () => {
  render(
    <WidgetCatalog
      entries={entries.map((item) =>
        item.id === "calendar"
          ? { ...item, status: "install-error" as const, attention: true }
          : item,
      )}
      selectedId="focus-timer"
      onSelect={vi.fn()}
    />,
  );
  const daily = within(screen.getByRole("region", { name: "하루 도구" }));
  expect(daily.getByRole("button", { name: "할 일 미설치" }).textContent).toBe("할 일");
  expect(daily.getByRole("button", { name: "집중 타이머 켜짐" }).textContent).toBe(
    "집중 타이머켜짐",
  );
  expect(daily.getByRole("button", { name: "캘린더 설치 오류" }).textContent).toBe(
    "캘린더설치 오류",
  );
});
