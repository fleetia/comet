import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import catalog from "../../../widgets/catalog.json";
import { WidgetCatalog, type WidgetListEntry } from "./WidgetCatalog";

const entries: WidgetListEntry[] = catalog.map((item) => ({
  ...item,
  reaction: item.id === "focus-timer",
  status: "enabled",
  attention: false,
}));
afterEach(cleanup);

it("shows the three Figma catalog groups and lets keyboard users open a widget", async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  render(<WidgetCatalog entries={entries} selectedId="focus-timer" onSelect={select} />);
  const daily = within(screen.getByRole("region", { name: "하루 도구" }));
  expect(daily.getByRole("button", { name: "시계·기념일 켜짐" })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "놀이 상자" })).getAllByRole("button"),
  ).toHaveLength(10);
  const information = within(screen.getByRole("region", { name: "생활 정보" }));
  expect(information.getAllByRole("button")).toHaveLength(4);
  expect(information.getByRole("button", { name: "바깥 알림 켜짐" })).toBeTruthy();
  expect(daily.getByRole("button", { name: "할 일 완료 구슬 켜짐" })).toBeTruthy();
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
  expect(screen.getByRole("button", { name: "날씨 켜짐" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "할 일 켜짐" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "날씨 켜짐" }));
  expect(select).toHaveBeenCalledExactlyOnceWith("weather");
  fireEvent.change(search, { target: { value: "투두" } });
  expect(screen.getByRole("button", { name: "할 일 켜짐" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "날씨 켜짐" })).toBeNull();
  fireEvent.change(search, { target: { value: "없는 위젯" } });
  expect(screen.getByText("찾는 위젯이 없어요. 검색어를 바꿔 보세요.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "할 일 켜짐" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "시계·기념일 켜짐" })).toBeTruthy();
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
  expect(screen.getByRole("switch", { name: "집중 타이머 캐릭터 반응" })).toHaveProperty(
    "checked",
    true,
  );
  fireEvent.click(screen.getByRole("switch", { name: "집중 타이머 캐릭터 반응" }));
  expect(toggle).toHaveBeenCalledExactlyOnceWith("focus-timer", false);
  expect(select).not.toHaveBeenCalled();
});

it("opens image from its row without offering a character reaction switch", () => {
  const select = vi.fn();
  render(<WidgetCatalog entries={entries} onSelect={select} onToggle={vi.fn()} />);
  expect(screen.queryByRole("switch", { name: "이미지 캐릭터 반응" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "이미지 켜짐" }));
  expect(select).toHaveBeenCalledWith("image");
});

it("shows action labels, desktop state, reaction heading and the existing management menu", () => {
  const menuAction = vi.fn();
  render(
    <WidgetCatalog
      entries={entries.map((item) =>
        item.id === "memo" ? { ...item, desktopPlaced: true } : item,
      )}
      onSelect={vi.fn()}
      menuActions={(id) =>
        id === "memo"
          ? [
              { id: "open", label: "새 메모 꺼내기" },
              { id: "desktop-remove", label: "바탕화면에서 빼기" },
            ]
          : []
      }
      onMenuAction={menuAction}
    />,
  );
  const daily = within(screen.getByRole("region", { name: "하루 도구" }));
  expect(daily.getByText("친구 반응")).toBeTruthy();
  const memo = daily.getByRole("button", { name: "메모 켜짐" });
  expect(memo.textContent).toContain("새 메모 꺼내기");
  expect(memo.textContent).toContain("바탕화면에 놓여 있어요");
  fireEvent.click(daily.getByRole("button", { name: "메모 더보기" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "바탕화면에서 빼기" }));
  expect(menuAction).toHaveBeenCalledWith("memo", "desktop-remove");
});

it("opens the closed image submenu directly from the image row", () => {
  const menuAction = vi.fn();
  render(
    <WidgetCatalog
      entries={entries}
      onSelect={vi.fn()}
      menuActions={(id) =>
        id === "image" ? [{ id: "closed-images", label: "닫아 둔 이미지 1장 ›" }] : []
      }
      submenuActions={() => [{ id: "open-image:1", label: "이미지 1" }]}
      onMenuAction={menuAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "닫아 둔 이미지 1장" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "이미지 1" }));
  expect(menuAction).toHaveBeenCalledWith("image", "open-image:1");
});
