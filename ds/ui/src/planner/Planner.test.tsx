import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HabitDay, HabitWeekTable } from "./Habit";
import { CalendarDayCell, CalendarDayRing, CalendarWeek } from "./Calendar";
import { FocusProgramPicker, FocusRecordsPanel } from "./Focus";
import { LedgerCategorySummary, LedgerMonthlyBudget, LedgerQuickAdd } from "./Ledger";

afterEach(cleanup);

describe("habit recording", () => {
  it("names each record state and keeps disabled days and enclosing forms inert", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <HabitDay state="counting" count={2} onClick={change} />
        <HabitDay state="done" disabled onClick={change} />
      </form>,
    );

    await user.tab();
    await user.keyboard("{Enter}");
    const counting = screen.getByRole("button", { name: "횟수 기록 중 2회" });
    expect(Array.from(counting.style).filter((property) => property.startsWith("--"))).toHaveLength(
      1,
    );
    expect(change).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "했어요" }));
    expect(change).toHaveBeenCalledOnce();
  });

  it("preserves the habit and day identities in controlled table actions", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const add = vi.fn();
    const day = { id: "2026-10-15", label: "10월 15일", state: "unrecorded" as const };
    render(
      <HabitWeekTable
        days={[{ id: day.id, weekday: "목", date: "15", today: true }]}
        habits={[{ id: "reading", title: "책 읽기", days: [day], summary: "0 / 7일" }]}
        onHabitDayChange={change}
        onAdd={add}
      />,
    );

    await user.click(screen.getByRole("button", { name: "10월 15일: 아직 기록하지 않음" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("reading", day, 0);
    await user.click(screen.getByRole("button", { name: "+ 새 습관" }));
    expect(add).toHaveBeenCalledOnce();
  });
});

describe("planner composition", () => {
  it("separates calendar date, event and overflow actions without form submission", async () => {
    const user = userEvent.setup();
    const date = vi.fn();
    const event = vi.fn();
    const overflow = vi.fn();
    const submit = vi.fn();
    const item = { id: "book", title: "책 모임", time: "14:00" };
    render(
      <form onSubmit={submit}>
        <CalendarDayCell
          day="15"
          dateLabel="10월 15일"
          today
          events={[item]}
          overflowCount={2}
          onDayClick={date}
          onEventClick={event}
          onOverflowClick={overflow}
        />
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "10월 15일 하루 보기" }));
    await user.click(screen.getByRole("button", { name: "14:00 책 모임" }));
    await user.click(screen.getByRole("button", { name: "2개 더 보기" }));
    expect(date).toHaveBeenCalledOnce();
    expect(event).toHaveBeenCalledExactlyOnceWith(item);
    expect(overflow).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports ten-minute slots and keeps overnight events on their supplied day", async () => {
    const user = userEvent.setup();
    const slot = vi.fn();
    const select = vi.fn();
    const day = { id: "today", weekday: "목", day: "15", label: "10월 15일" };
    const event = {
      id: "night",
      dayId: "today",
      startMinute: 60,
      durationMinutes: 60,
      children: "새벽 작업",
    };
    render(<CalendarWeek days={[day]} events={[event]} onSlotClick={slot} onEventClick={select} />);
    await user.click(screen.getByRole("button", { name: "10월 15일 1:10" }));
    expect(slot).toHaveBeenCalledExactlyOnceWith(day, 70);
    const button = screen.getByRole("button", { name: "새벽 작업" });
    expect(button.parentElement?.style.gridRow).toBe("20");
    await user.click(button);
    expect(select).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("disables every action in a disabled day cell", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <CalendarDayCell
        disabled
        day="15"
        dateLabel="10월 15일"
        events={[{ id: "event", title: "책 모임" }]}
        overflowCount={1}
        onDayClick={action}
        onEventClick={action}
        onOverflowClick={action}
      />,
    );
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      await user.click(button);
    }
    expect(action).not.toHaveBeenCalled();
  });

  it("aligns partial-hour events with horizontal ten-minute slots and wraps at an hour boundary", () => {
    const day = { id: "today", weekday: "목", day: "15", label: "10월 15일" };
    render(
      <CalendarWeek
        days={[day]}
        events={[
          {
            id: "short",
            dayId: day.id,
            startMinute: 9 * 60 + 10,
            durationMinutes: 20,
            children: "짧은 집중",
          },
          {
            id: "cross",
            dayId: day.id,
            startMinute: 10 * 60 + 30,
            durationMinutes: 60,
            children: "이어지는 집중",
          },
        ]}
      />,
    );
    const short = screen.getByRole("button", { name: "짧은 집중" }).parentElement;
    expect(Number.parseFloat(short?.style.marginLeft ?? "")).toBeCloseTo(100 / 6);
    expect(Number.parseFloat(short?.style.width ?? "")).toBeCloseTo(100 / 3);
    const parts = screen
      .getAllByRole("button", { name: "이어지는 집중" })
      .map((button) => button.parentElement);
    expect(parts.map((part) => part?.style.gridRow)).toEqual(["5", "6"]);
    expect(parts.map((part) => part?.style.marginLeft)).toEqual(["50%", "0%"]);
    expect(parts.map((part) => part?.style.width)).toEqual(["50%", "50%"]);
  });

  it("draws caller-supplied ring data and lets keyboard users activate its marks", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const segment = {
      id: "focus",
      startMinute: 60,
      endMinute: 120,
      label: "기획서 집중",
      color: "focus" as const,
    };
    render(
      <CalendarDayRing
        value="1시간"
        segments={[
          segment,
          { ...segment, id: "invalid", startMinute: Number.NaN, label: "유효하지 않은 기록" },
        ]}
        onSegmentClick={select}
      />,
    );
    const mark = screen.getByRole("button", { name: "기획서 집중" });
    expect(mark.getAttribute("d")).not.toContain("NaN");
    expect(screen.queryByRole("button", { name: "유효하지 않은 기록" })).toBeNull();
    mark.focus();
    await user.keyboard(" ");
    expect(select).toHaveBeenCalledExactlyOnceWith(segment);
  });

  it("uses native radio exclusivity, labels and disabled options for programs", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <FocusProgramPicker
        label="측정할 프로그램"
        defaultValue="code"
        onValueChange={change}
        options={[
          { value: "code", label: "Code" },
          { value: "word", label: "Word" },
          { value: "locked", label: "사용할 수 없음", disabled: true },
        ]}
      />,
    );
    expect(screen.getByRole("group", { name: "측정할 프로그램" })).toBeDefined();
    await user.click(screen.getByRole("radio", { name: "Word" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("word");
    expect((screen.getByRole("radio", { name: "Code" }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("radio", { name: "사용할 수 없음" }));
    expect(change).toHaveBeenCalledOnce();
  });

  it("can show a recorded-time ring without offering manual painting controls", () => {
    render(
      <CalendarDayRing
        segments={[]}
        value="0분"
        centerLabel="집중한 시간"
        showCategoryControls={false}
      />,
    );
    expect(screen.getByText("집중한 시간")).toBeDefined();
    expect(screen.queryByText("칠할 분류")).toBeNull();
    expect(screen.queryByRole("button", { name: "일" })).toBeNull();
  });

  it("shows data labels and the supplied current time without creating marks outside the day", () => {
    const segment = {
      id: "focus",
      startMinute: 540,
      endMinute: 600,
      color: "focus" as const,
      label: "기획서 집중 · 1시간",
      displayLabel: "기획서 집중",
      detail: "집중 · 자동",
    };
    const { rerender } = render(
      <CalendarDayRing
        segments={[
          segment,
          { ...segment, id: "before", startMinute: -60, endMinute: 0, displayLabel: "전날 기록" },
          {
            ...segment,
            id: "after",
            startMinute: 1440,
            endMinute: 1500,
            displayLabel: "다음 날 기록",
          },
        ]}
        value="1시간"
        layout="fill"
        showSegmentLabels
        currentMinute={9 * 60 + 24}
        legend="집중 기록"
      />,
    );
    expect(screen.getByText("기획서 집중")).toBeDefined();
    expect(screen.getByText("집중 · 자동")).toBeDefined();
    expect(screen.getByRole("img", { name: "지금 9:24" })).toBeDefined();
    expect(screen.queryByText("전날 기록")).toBeNull();
    expect(screen.queryByText("다음 날 기록")).toBeNull();
    rerender(<CalendarDayRing segments={[segment]} value="1시간" currentMinute={Number.NaN} />);
    expect(screen.queryByText("기획서 집중")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("selects midnight and extended ranges from the keyboard and ignores disabled painting", () => {
    const select = vi.fn();
    const { rerender } = render(
      <CalendarDayRing segments={[]} value="0분" onRangeSelect={select} />,
    );
    const ring = screen.getByRole("group", { name: "하루 시간 기록" });
    fireEvent.keyDown(ring, { key: "End" });
    fireEvent.keyDown(ring, { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith({ startMinute: 1430, endMinute: 1440 });
    fireEvent.keyDown(ring, { key: "Home", shiftKey: true });
    fireEvent.keyDown(ring, { key: "Enter" });
    expect(select).toHaveBeenLastCalledWith({ startMinute: 0, endMinute: 1440 });
    rerender(
      <CalendarDayRing segments={[]} value="0분" onRangeSelect={select} interactionDisabled />,
    );
    fireEvent.keyDown(ring, { key: "Enter" });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("paints pointer ranges in ten-minute cells and cancels interrupted drags", () => {
    const select = vi.fn();
    render(<CalendarDayRing segments={[]} value="0분" onRangeSelect={select} />);
    const ring = screen.getByRole("group", { name: "하루 시간 기록" });
    vi.spyOn(ring, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 572, height: 572, x: 0, y: 0, bottom: 572, right: 572, toJSON: () => ({}) });
    Object.defineProperty(ring, "setPointerCapture", { value: vi.fn() });
    function pointer(type: string, minute: number): void {
      const angle = minute / 1440 * Math.PI * 2 - Math.PI / 2;
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX: 286 + 214 * Math.cos(angle), clientY: 286 + 214 * Math.sin(angle) });
      fireEvent(ring, event);
    }
    pointer("pointerdown", 365);
    pointer("pointermove", 545);
    pointer("pointerup", 545);
    expect(select).toHaveBeenCalledExactlyOnceWith({ startMinute: 360, endMinute: 550 });
    pointer("pointerdown", 1435);
    pointer("pointermove", 5);
    pointer("pointerup", 5);
    expect(select).toHaveBeenLastCalledWith({ startMinute: 1430, endMinute: 1440 });
    pointer("pointerdown", 365);
    pointer("pointercancel", 365);
    pointer("pointerup", 365);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("does not create a hidden note editor when the records consumer supplies no note", () => {
    render(<FocusRecordsPanel tab="records" />);
    expect(screen.queryByLabelText("이번 집중 메모")).toBeNull();
  });

  it("submits the original ledger fields and leaves disabled input inactive", async () => {
    const user = userEvent.setup();
    const add = vi.fn();
    const { rerender } = render(
      <LedgerQuickAdd
        categories={[{ value: "cafe", label: "카페" }]}
        defaultAmount="4500"
        defaultMemo="  오후 커피  "
        onAdd={add}
      />,
    );
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(add).toHaveBeenCalledExactlyOnceWith({
      amount: "4500",
      category: "cafe",
      memo: "  오후 커피  ",
    });
    rerender(
      <LedgerQuickAdd categories={[{ value: "cafe", label: "카페" }]} disabled onAdd={add} />,
    );
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(add).toHaveBeenCalledOnce();
  });

  it("keeps zero-budget and zero-category graphs finite", () => {
    const { container } = render(
      <>
        <LedgerMonthlyBudget title="예산" spent={0} budget={0} amountLabel="0원" />
        <LedgerCategorySummary
          items={[{ id: "food", label: "식비", amount: 0, amountLabel: "0원", category: "food" }]}
        />
      </>,
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText("0%")).toBeDefined();
  });

  it("switches focus views and preserves a note draft across view changes", async () => {
    const user = userEvent.setup();
    render(<FocusRecordsPanel defaultTab="notes" note={{ defaultValue: "원문\n  메모" }} />);
    const note = screen.getByRole("textbox", { name: "이번 집중 메모" }) as HTMLTextAreaElement;
    await user.type(note, "!");
    await user.click(screen.getByRole("radio", { name: "기록" }));
    await user.click(screen.getByRole("radio", { name: "노트" }));
    expect(
      (screen.getByRole("textbox", { name: "이번 집중 메모" }) as HTMLTextAreaElement).value,
    ).toBe("원문\n  메모!");
  });
});
