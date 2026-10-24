import { afterEach, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import * as fields from "../../../../../ds/ui/src/controls/fields.css";
import * as s from "./planner.css";
import { PlannerPlans } from "./PlannerPlans";
import { localDay, type DataRecord } from "../toolData";
import { movePeriod, periodAnchor } from "./plannerData";

afterEach(cleanup);

it("constrains the whole list filter while preserving its label and controlled selection", () => {
  const longName = "QA weekend packing with a long list name";
  const onVisibleListChange = vi.fn();
  const props: ComponentProps<typeof PlannerPlans> = {
    period: "week",
    anchors: { week: "2026-10-19", month: "2026-10-19", year: "2026-10-19" },
    planScope: "이번 주",
    shown: [],
    items: [],
    lists: [
      { id: "default", name: "할 일" },
      { id: "packing", name: longName },
    ],
    visibleList: "packing",
    showCompleted: false,
    hasTodo: true,
    todoInstalled: true,
    headerActions: true,
    busy: false,
    act: vi.fn().mockResolvedValue(true),
    quickInput: null,
    renderCheck: () => <span />,
    onPeriodChange: vi.fn(),
    onAnchorChange: vi.fn(),
    onCheck: vi.fn().mockResolvedValue(undefined),
    onVisibleListChange,
    onShowCompletedChange: vi.fn(),
    onManageLists: vi.fn(),
    onEdit: vi.fn(),
    onEnableTodo: vi.fn().mockResolvedValue(undefined),
    draft: "",
    adding: null,
    onDraftChange: vi.fn(),
    onAddingChange: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(undefined),
  };
  const { rerender } = render(<PlannerPlans {...props} />);
  const select = screen.getByRole("combobox", { name: "조회할 목록" }) as HTMLSelectElement;
  expect(select.classList.contains(s.listSelect)).toBe(false);
  expect(select.classList.contains(fields.fillSelect)).toBe(true);
  const field = select.parentElement?.parentElement;
  expect(select.parentElement?.classList.contains(fields.fillSelectContainer)).toBe(true);
  expect(field?.classList.contains(fields.fillField)).toBe(true);
  expect(field?.parentElement?.classList.contains(s.listSelect)).toBe(true);
  expect(select.value).toBe("packing");
  expect(screen.getByRole("option", { name: longName }).textContent).toBe(longName);
  for (const value of ["all", "default", "packing"]) {
    fireEvent.change(select, { target: { value } });
    expect(onVisibleListChange).toHaveBeenLastCalledWith(value);
    rerender(<PlannerPlans {...props} visibleList={value} />);
    expect(select.value).toBe(value);
  }
});

function board(items: DataRecord[], overrides: Partial<ComponentProps<typeof PlannerPlans>> = {}) {
  const today = localDay();
  const props: ComponentProps<typeof PlannerPlans> = {
    period: "week",
    anchors: { week: today, month: today, year: today },
    planScope: "",
    shown: [],
    items,
    lists: [{ id: "default", name: "할 일" }],
    visibleList: "all",
    showCompleted: false,
    hasTodo: true,
    todoInstalled: true,
    headerActions: true,
    busy: false,
    act: vi.fn().mockResolvedValue(true),
    quickInput: null,
    renderCheck: () => <span />,
    onPeriodChange: vi.fn(),
    onAnchorChange: vi.fn(),
    onVisibleListChange: vi.fn(),
    onShowCompletedChange: vi.fn(),
    onManageLists: vi.fn(),
    onCheck: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn(),
    onEnableTodo: vi.fn().mockResolvedValue(undefined),
    draft: "",
    adding: null,
    onDraftChange: vi.fn(),
    onAddingChange: vi.fn(),
    onAdd: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { props, view: render(<PlannerPlans {...props} />) };
}
function task(id: string, planPeriod: string, extra: DataRecord = {}): DataRecord {
  return {
    id,
    title: `${id} 일`,
    listId: "default",
    plannedDate: null,
    planPeriod,
    planAnchor: planPeriod === "someday" ? null : periodAnchor(planPeriod, localDay()),
    completedAt: null,
    repeatRule: null,
    ...extra,
  };
}
function drag(card: HTMLElement, target: HTMLElement): void {
  const data = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "",
  };
  fireEvent.dragStart(card, { dataTransfer });
  const drop = createEvent.drop(target, { dataTransfer });
  fireEvent(target, drop);
}

it("lays the four periods side by side and folds a long column after six cards", () => {
  const week = Array.from({ length: 8 }, (_, index) => task(`w${index + 1}`, "week"));
  board([...week, task("m", "month"), task("y", "year"), task("s", "someday")]);
  const columns = ["이번 주", "이번 달", "올해", "언젠가"].map((name) =>
    screen.getByRole("region", { name }),
  );
  expect(within(columns[1]).getByRole("button", { name: "m 일 선택" })).toBeTruthy();
  expect(within(columns[3]).getByText("날짜 없음")).toBeTruthy();
  expect(within(columns[3]).queryByRole("button", { name: /이전 기간/ })).toBeNull();
  expect(within(columns[0]).getAllByRole("button", { name: /일 선택$/ })).toHaveLength(6);
  fireEvent.click(within(columns[0]).getByRole("button", { name: "2개 더 보기" }));
  expect(within(columns[0]).getAllByRole("button", { name: /일 선택$/ })).toHaveLength(8);
  // The narrow window's tabs count each column.
  const tabs = within(screen.getByRole("group", { name: "계획 기간" }));
  expect(tabs.getByRole("button", { name: "이번 주 · 8" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(tabs.getByRole("button", { name: "언젠가 · 1" })).toBeTruthy();
});

it("plans a selected card for today and moves only its own column's period", () => {
  const { props } = board([task("w", "week")]);
  const week = screen.getByRole("region", { name: "이번 주" });
  expect(within(week).queryByRole("button", { name: "오늘 하기" })).toBeNull();
  fireEvent.click(within(week).getByRole("button", { name: "w 일 선택" }));
  fireEvent.click(within(week).getByRole("button", { name: "오늘 하기" }));
  expect(props.act).toHaveBeenCalledWith("plan", { ids: ["w"], date: localDay() });
  fireEvent.click(within(week).getByRole("button", { name: "w 일 편집" }));
  expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "w" }));
  fireEvent.click(within(week).getByRole("button", { name: "이번 주 다음 기간" }));
  expect(props.onAnchorChange).toHaveBeenCalledTimes(1);
  expect(props.onAnchorChange).toHaveBeenCalledWith("week", movePeriod(localDay(), "week", 1));
});

it("titles a moved column by its relative period", () => {
  const today = localDay();
  board([], { anchors: { week: movePeriod(today, "week", 1), month: today, year: today } });
  expect(screen.getByRole("region", { name: "다음 주" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "이번 달" })).toBeTruthy();
});

it("changes a task's period by dropping it on another column or a narrow-window tab", () => {
  const { props } = board([task("w", "week"), task("m", "month")]);
  const card = screen.getByRole("button", { name: "w 일 선택" }).closest("article")!;
  drag(card, screen.getByRole("region", { name: "이번 달" }));
  expect(props.act).toHaveBeenLastCalledWith("plan", {
    ids: ["w"],
    date: null,
    planPeriod: "month",
    planAnchor: periodAnchor("month", localDay()),
  });
  drag(card, screen.getByRole("button", { name: "언젠가 · 0" }));
  expect(props.act).toHaveBeenLastCalledWith("plan", {
    ids: ["w"],
    date: null,
    planPeriod: "someday",
    planAnchor: null,
  });
  const calls = vi.mocked(props.act).mock.calls.length;
  drag(card, screen.getByRole("region", { name: "이번 주" }));
  expect(vi.mocked(props.act).mock.calls).toHaveLength(calls);
});

it("opens one column's add field on the shared draft and submits it for that period", () => {
  const { props, view } = board([]);
  const year = () => screen.getByRole("region", { name: "올해" });
  fireEvent.click(within(year()).getByRole("button", { name: "이 기간에 하고 싶은 일" }));
  expect(props.onAddingChange).toHaveBeenCalledWith("year");
  view.rerender(<PlannerPlans {...props} adding="year" draft="사진 정리" />);
  const field = within(year()).getByRole("textbox", { name: "올해에 추가할 할 일" });
  expect(field).toHaveProperty("value", "사진 정리");
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(field, { target: { value: "사진 백업" } });
  expect(props.onDraftChange).toHaveBeenCalledWith("사진 백업");
  fireEvent.click(within(year()).getByRole("button", { name: "추가" }));
  expect(props.onAdd).toHaveBeenCalledWith("year");
});
