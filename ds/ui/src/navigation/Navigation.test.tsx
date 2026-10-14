import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { SegmentedControl, Tabs, type TabItem } from "./Navigation";

afterEach(cleanup);

const items: readonly TabItem[] = [
  {
    value: "desktop",
    label: "바탕화면",
    icon: "home",
    content: <input aria-label="초안" defaultValue="하던 일" />,
  },
  { value: "unavailable", label: "준비 중", content: "아직 사용할 수 없어요", disabled: true },
  { value: "history", label: "대화 기록", content: "지난 대화" },
  { value: "settings", label: "설정", content: "설정 내용" },
];

it("links tabs to persistent panels and automatically activates keyboard destinations while skipping disabled tabs", async () => {
  const user = userEvent.setup();
  render(<Tabs label="보조 화면" items={items} />);
  const draft = screen.getByRole<HTMLInputElement>("textbox", { name: "초안" });
  await user.type(draft, " 이어 쓰기");
  const desktop = screen.getByRole("tab", { name: "바탕화면" });
  const history = screen.getByRole("tab", { name: "대화 기록" });
  const settings = screen.getByRole("tab", { name: "설정" });
  expect(screen.getByRole("tabpanel").id).toBe(desktop.getAttribute("aria-controls"));
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(desktop.id);
  desktop.focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(history);
  expect(history.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("지난 대화");
  await user.keyboard("{End}");
  expect(document.activeElement).toBe(settings);
  await user.keyboard("{Home}{ArrowLeft}");
  expect(document.activeElement).toBe(settings);
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(desktop);
  expect(desktop.tabIndex).toBe(0);
  expect(history.tabIndex).toBe(-1);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "초안" }).value).toBe(
    "하던 일 이어 쓰기",
  );
});

it("keeps controlled selection until the owner updates it and preserves linked IDs", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const { rerender } = render(
    <Tabs label="보조 화면" items={items} value="desktop" onValueChange={onValueChange} />,
  );
  const history = screen.getByRole("tab", { name: "대화 기록" });
  const historyId = history.id;
  await user.click(history);
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("history");
  expect(screen.getByRole("tab", { name: "바탕화면" }).getAttribute("aria-selected")).toBe("true");
  rerender(<Tabs label="보조 화면" items={items} value="history" onValueChange={onValueChange} />);
  expect(screen.getByRole("tab", { name: "대화 기록" }).id).toBe(historyId);
  expect(screen.getByRole("tabpanel").textContent).toBe("지난 대화");
});

it("follows inherited RTL direction when moving between tabs", async () => {
  const user = userEvent.setup();
  render(
    <div dir="rtl">
      <Tabs label="보조 화면" items={items} defaultValue="history" />
    </div>,
  );
  screen.getByRole("tab", { name: "대화 기록" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "바탕화면" }));
  await user.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "대화 기록" }));
});

it("uses independent IDs for multiple tab groups and never selects disabled-only groups", () => {
  const { rerender } = render(
    <>
      <Tabs label="첫 화면" items={items} />
      <Tabs label="둘째 화면" items={items} />
    </>,
  );
  const desktopTabs = screen.getAllByRole("tab", { name: "바탕화면" });
  expect(desktopTabs[0]?.id).not.toBe(desktopTabs[1]?.id);
  rerender(<Tabs label="준비 중" items={items.map((item) => ({ ...item, disabled: true }))} />);
  expect(screen.queryByRole("tabpanel")).toBeNull();
  expect(
    screen
      .getAllByRole<HTMLButtonElement>("tab")
      .every((tab) => tab.disabled && tab.tabIndex === -1),
  ).toBe(true);
});

it("uses native radio keyboard behavior and submits the chosen enabled segment", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  render(
    <form aria-label="날짜 선택">
      <SegmentedControl
        label="날짜"
        name="day"
        defaultValue="today"
        onValueChange={onValueChange}
        options={[
          { value: "today", label: "오늘" },
          { value: "blocked", label: "예약 불가", disabled: true },
          { value: "tomorrow", label: "내일" },
        ]}
      />
    </form>,
  );
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "오늘" }));
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "내일" }).checked).toBe(true);
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("tomorrow");
  expect(new FormData(screen.getByRole<HTMLFormElement>("form")).get("day")).toBe("tomorrow");
});

it("respects controlled radio values and disables the whole group without submitting its value", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const options = [
    { value: "today", label: "오늘" },
    { value: "tomorrow", label: "내일" },
  ];
  const { rerender } = render(
    <SegmentedControl label="날짜" options={options} value="today" onValueChange={onValueChange} />,
  );
  await user.click(screen.getByRole("radio", { name: "내일" }));
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("tomorrow");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "오늘" }).checked).toBe(true);
  rerender(
    <form aria-label="날짜 선택">
      <SegmentedControl
        label="날짜"
        name="day"
        options={options}
        value="tomorrow"
        disabled
        onValueChange={onValueChange}
      />
    </form>,
  );
  expect(screen.getAllByRole<HTMLInputElement>("radio").every((radio) => radio.disabled)).toBe(
    true,
  );
  await user.click(screen.getByRole("radio", { name: "오늘" }));
  expect(onValueChange).toHaveBeenCalledTimes(1);
  expect(new FormData(screen.getByRole<HTMLFormElement>("form")).has("day")).toBe(false);
});

it("restores the uncontrolled default on form reset and keeps it after unrelated rerenders", async () => {
  const user = userEvent.setup();
  const onValueChange = vi.fn();
  const options = [
    { value: "today", label: "오늘" },
    { value: "tomorrow", label: "내일" },
  ];
  const { rerender } = render(
    <form aria-label="날짜 선택">
      <SegmentedControl
        label="날짜"
        name="day"
        options={options}
        defaultValue="today"
        onValueChange={onValueChange}
      />
    </form>,
  );
  await user.click(screen.getByRole("radio", { name: "내일" }));
  const form = screen.getByRole<HTMLFormElement>("form");
  act(() => form.reset());
  expect(new FormData(form).get("day")).toBe("today");
  rerender(
    <form aria-label="날짜 선택">
      <SegmentedControl
        className="updated-layout"
        label="날짜"
        name="day"
        options={options}
        defaultValue="today"
        onValueChange={onValueChange}
      />
    </form>,
  );
  expect(new FormData(form).get("day")).toBe("today");
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("tomorrow");
});

it("retains the current controlled radio value when its form resets", () => {
  const options = [
    { value: "today", label: "오늘" },
    { value: "tomorrow", label: "내일" },
  ];
  const { rerender } = render(
    <form aria-label="날짜 선택">
      <SegmentedControl label="날짜" name="day" options={options} value="today" />
    </form>,
  );
  rerender(
    <form aria-label="날짜 선택">
      <SegmentedControl label="날짜" name="day" options={options} value="tomorrow" />
    </form>,
  );
  const form = screen.getByRole<HTMLFormElement>("form");
  act(() => form.reset());
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "내일" }).checked).toBe(true);
  expect(new FormData(form).get("day")).toBe("tomorrow");
});
