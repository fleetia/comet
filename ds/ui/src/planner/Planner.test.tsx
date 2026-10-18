import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HabitDay, HabitWeekTable } from "./Habit";
import { CalendarDayCell, CalendarDayRing, CalendarWeek } from "./Calendar";
import { FocusProgramPicker, FocusRecordsPanel } from "./Focus";
import { LedgerCategorySummary, LedgerMonthlyBudget, LedgerQuickAdd } from "./Ledger";
import { TripInfoRow } from "./Trip";

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

  it("selects a drag range on its original week date, preserves midnight and disables edits", () => {
    const select = vi.fn();
    const day = { id: "today", weekday: "목", day: "15", label: "10월 15일" };
    const { rerender } = render(<CalendarWeek days={[day]} events={[]} onRangeSelect={select} />);
    const first = screen.getByRole("button", { name: "10월 15일 9:10" });
    const body = first.parentElement?.parentElement as HTMLElement;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 126,
      height: 623,
      x: 0,
      y: 0,
      bottom: 623,
      right: 126,
      toJSON: () => ({}),
    });
    Object.defineProperty(body, "setPointerCapture", { value: vi.fn() });
    function pointer(target: HTMLElement, type: string, x: number, y: number): void {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: 1, button: 0, clientX: x, clientY: y });
      fireEvent(target, event);
    }
    pointer(first, "pointerdown", 45, 80);
    pointer(body, "pointermove", 100, 106);
    pointer(body, "pointerup", 100, 106);
    expect(select).toHaveBeenCalledExactlyOnceWith(day, { startMinute: 550, endMinute: 650 });
    fireEvent.click(first, { detail: 1 });
    expect(select).toHaveBeenCalledOnce();
    pointer(first, "pointerdown", 45, 80);
    pointer(body, "pointerup", 45, 80);
    expect(select).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "10월 15일 23:50" }));
    expect(select).toHaveBeenLastCalledWith(day, { startMinute: 1430, endMinute: 1440 });
    pointer(first, "pointerdown", 45, 80);
    pointer(body, "pointercancel", 45, 80);
    pointer(body, "pointerup", 45, 80);
    expect(select).toHaveBeenCalledTimes(3);
    pointer(first, "pointerdown", 45, 80);
    fireEvent.keyDown(first, { key: "Escape" });
    pointer(body, "pointerup", 45, 80);
    expect(select).toHaveBeenCalledTimes(3);
    rerender(<CalendarWeek days={[day]} events={[]} onRangeSelect={select} interactionDisabled />);
    fireEvent.click(first);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("keeps one tabbable time per date and clamps keyboard navigation at the display boundaries", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const day = { id: "today", weekday: "목", day: "15", label: "10월 15일" };
    const nextDay = { id: "tomorrow", weekday: "금", day: "16", label: "10월 16일" };
    const { rerender } = render(
      <CalendarWeek days={[day, nextDay]} events={[]} startHour={8} onRangeSelect={select} />,
    );
    const first = screen.getByRole("button", { name: "10월 15일 8:00" });
    expect(first.tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "10월 16일 8:00" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "10월 15일 8:10" }).tabIndex).toBe(-1);
    expect(
      document.getElementById(first.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toContain("Tab으로 다음 날짜");
    first.focus();
    await user.keyboard("{ArrowUp}{ArrowLeft}{Enter}");
    expect(select).toHaveBeenLastCalledWith(day, { startMinute: 480, endMinute: 490 });
    await user.keyboard("{Control>}{End}{/Control}{ArrowRight}{ArrowDown}{Enter}");
    expect(select).toHaveBeenLastCalledWith(day, { startMinute: 470, endMinute: 480 });
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "10월 15일 7:00" }));
    await user.keyboard("{End}{Enter}");
    expect(select).toHaveBeenLastCalledWith(day, { startMinute: 470, endMinute: 480 });

    rerender(<CalendarWeek days={[nextDay]} events={[]} startHour={8} onRangeSelect={select} />);
    screen.getByRole("button", { name: "10월 16일 7:50" }).focus();
    await user.keyboard("{Control>}{Home}{/Control} ");
    expect(select).toHaveBeenLastCalledWith(nextDay, { startMinute: 480, endMinute: 490 });
    rerender(
      <CalendarWeek
        days={[nextDay]}
        events={[]}
        startHour={8}
        onRangeSelect={select}
        interactionDisabled
      />,
    );
    const count = select.mock.calls.length;
    fireEvent.keyDown(screen.getByRole("button", { name: "10월 16일 8:00" }), {
      key: "ArrowRight",
    });
    fireEvent.click(screen.getByRole("button", { name: "10월 16일 8:10" }));
    expect(select).toHaveBeenCalledTimes(count);
  });

  it("preserves both ends of a record across the six o'clock display boundary", () => {
    const day = { id: "today", weekday: "목", day: "15", label: "10월 15일" };
    const select = vi.fn();
    const half = {
      id: "half",
      dayId: day.id,
      startMinute: 330,
      durationMinutes: 60,
      children: "새벽 마무리",
    };
    const long = {
      id: "long",
      dayId: day.id,
      startMinute: 0,
      durationMinutes: 480,
      children: "밤부터 아침",
    };
    render(<CalendarWeek days={[day]} events={[half, long]} onEventClick={select} />);
    const halves = screen.getAllByRole("button", { name: "새벽 마무리" });
    expect(halves.map((button) => button.parentElement?.style.gridRow)).toEqual(["24", "1"]);
    expect(halves.map((button) => button.parentElement?.style.width)).toEqual(["50%", "50%"]);
    const overnight = screen.getAllByRole("button", { name: "밤부터 아침" });
    expect(overnight.map((button) => button.parentElement?.style.gridRow)).toEqual(["19", "1"]);
    expect(overnight.map((button) => button.parentElement?.style.height)).toEqual([
      "156px",
      "52px",
    ]);
    fireEvent.click(halves[0]);
    fireEvent.click(halves[1]);
    expect(select).toHaveBeenNthCalledWith(1, half);
    expect(select).toHaveBeenNthCalledWith(2, half);
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

  it("separates adjacent captions and current time while retaining complete accessible labels", () => {
    const segments = [
      {
        id: "work",
        startMinute: 540,
        endMinute: 660,
        color: "work" as const,
        label: "09:00–11:00 아주 긴 오전 작업 기록 원문",
        displayLabel: "아주 긴 오전 작업 기록 원문",
        detail: "일",
      },
      {
        id: "lecture",
        startMinute: 600,
        endMinute: 660,
        color: "google" as const,
        label: "10:00–11:00 온라인 강의",
        displayLabel: "온라인 강의",
        detail: "연결 일정",
        kind: "event" as const,
      },
      {
        id: "evening",
        startMinute: 1080,
        endMinute: 1200,
        color: "life" as const,
        label: "18:00–20:00 저녁 약속",
        displayLabel: "저녁 약속",
        detail: "18:30–19:30",
      },
    ];
    render(
      <CalendarDayRing
        segments={segments}
        value="2시간"
        showSegmentLabels
        currentMinute={1140}
        onSegmentClick={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: segments[0].label })).toBeDefined();
    const morning = screen.getByText("아주 긴 오전 작…");
    const lecture = screen.getByText("온라인 강의");
    const evening = screen.getByText("저녁 약속");
    const now = screen.getByText("지금 19:00");
    expect(
      Math.abs(Number(morning.getAttribute("y")) - Number(lecture.getAttribute("y"))),
    ).toBeGreaterThanOrEqual(38);
    expect(
      Math.abs(Number(evening.getAttribute("y")) - Number(now.getAttribute("y"))),
    ).toBeGreaterThanOrEqual(38);
    expect(screen.getByRole("img", { name: "지금 19:00" })).toBeDefined();
    expect(screen.getByText("18:30–19:30")).toBeDefined();
    expect(screen.getByRole("group", { name: "하루 시간 기록" }).getAttribute("viewBox")).toBe(
      "-110 -35 792 642",
    );
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
    vi.spyOn(ring, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 792,
      height: 642,
      x: 0,
      y: 0,
      bottom: 642,
      right: 792,
      toJSON: () => ({}),
    });
    Object.defineProperty(ring, "setPointerCapture", { value: vi.fn() });
    function pointer(type: string, minute: number): void {
      const angle = (minute / 1440) * Math.PI * 2 - Math.PI / 2;
      const event = new Event(type, { bubbles: true });
      Object.assign(event, {
        button: 0,
        pointerId: 1,
        clientX: 396 + 214 * Math.cos(angle),
        clientY: 321 + 214 * Math.sin(angle),
      });
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

describe("trip info rows", () => {
  it("stays a static row without a handler and becomes one inert-in-forms button with it", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const submit = vi.fn();
    const { rerender } = render(<TripInfoRow title="애월 숙소" detail="1박" value="결제 완료" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <form onSubmit={submit}>
        <TripInfoRow title="애월 숙소" detail="1박" value="결제 완료" onClick={open} />
      </form>,
    );
    await user.click(screen.getByRole("button", { name: /애월 숙소.*1박.*결제 완료/ }));
    expect(open).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    rerender(<TripInfoRow title="애월 숙소" disabled onClick={open} />);
    await user.click(screen.getByRole("button", { name: "애월 숙소" }));
    expect(open).toHaveBeenCalledOnce();
  });
});
