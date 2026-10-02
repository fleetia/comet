import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimerTool } from "./PlanningTools";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetValue, WidgetView } from "../types";

function widget(kind: string, data: WidgetValue, revision = 8): WidgetView {
  return {
    id: `${kind}-instance-uuid`,
    kind,
    installed: true,
    enabled: true,
    revision,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
function goal(input: DataRecord = {}): DataRecord {
  return {
    id: "goal",
    title: "읽기",
    completedAt: null,
    repeatRule: {
      mode: "frequency",
      unit: "week",
      interval: 1,
      timesPerWeek: 3,
      timeZone: "Asia/Seoul",
    },
    frequencyRecords: [],
    ...input,
  };
}
function timer(status = "finished"): WidgetView {
  return widget("focus-timer", { status, todoId: "goal", remainingMs: 0 });
}
function todo(item = goal(), revision = 8): WidgetView {
  return widget("todo", { items: [item] }, revision);
}
const act = vi.fn<ToolAction>();
async function click(name: string): Promise<void> {
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name })));
}
async function tick(at: string): Promise<void> {
  vi.setSystemTime(new Date(at));
  await reactAct(async () => vi.advanceTimersByTime(1000));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
  act.mockReset();
  act.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("frequency goals linked to a timer", () => {
  it("keeps weekly goals selectable without recording when the timer starts", async () => {
    render(<TimerTool widget={timer("idle")} widgets={[todo()]} act={act} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "goal" } });
    await click("집중 시작");
    expect(act).toHaveBeenCalledExactlyOnceWith("start", { durationMs: 1500000, todoId: "goal" });
  });

  it("records only the explicit date shown in the goal time zone, on the todo instance", async () => {
    const target = todo();
    const original = structuredClone(target);
    render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-02 · Asia/Seoul 기준");
    expect(screen.queryByRole("button", { name: /완료하기/ })).toBeNull();
    await click("읽기 오늘 1회 기록");
    expect(act).toHaveBeenCalledExactlyOnceWith(
      "record-frequency",
      { id: "goal", date: "2026-10-02" },
      target,
    );
    expect(target).toEqual(original);
    expect(screen.getByRole("button", { name: "읽기 기록됨" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("1/3회");
    await click("읽기 기록됨");
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("uses local calendar dates for the local repeat time zone", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const target = todo(
      goal({ repeatRule: { mode: "frequency", timesPerWeek: 3, timeZone: "local" } }),
    );
    render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-01 · 이 컴퓨터의 시간대");
    await click("읽기 오늘 1회 기록");
    expect(act).toHaveBeenCalledWith(
      "record-frequency",
      { id: "goal", date: "2026-10-01" },
      target,
    );
  });

  it("uses the displayed current date after focus crosses midnight, without automatically recording", async () => {
    vi.setSystemTime(new Date("2026-10-01T14:59:59Z"));
    const view = render(<TimerTool widget={timer("running")} widgets={[todo()]} act={act} />);
    await tick("2026-10-01T15:00:00Z");
    view.rerender(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-02");
    expect(act).not.toHaveBeenCalled();
    await click("읽기 오늘 1회 기록");
    expect(act.mock.calls[0]?.[1]).toEqual({ id: "goal", date: "2026-10-02" });
  });

  it("updates the displayed date at midnight before the first recording click", async () => {
    vi.setSystemTime(new Date("2026-10-01T14:59:50Z"));
    render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-01");
    await tick("2026-10-01T15:00:00Z");
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-02");
    await click("읽기 오늘 1회 기록");
    expect(act.mock.calls[0]?.[1]).toEqual({ id: "goal", date: "2026-10-02" });
  });

  it("blocks rapid repeated clicks until the request and snapshot settle", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    act.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    const button = screen.getByRole("button", { name: "읽기 오늘 1회 기록" });
    reactAct(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(act).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "읽기 기록 중…" })).toHaveProperty("disabled", true);
    await reactAct(async () => finish?.(true));
    await click("읽기 기록됨");
    expect(act).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "rejected"])(
    "keeps the same date on a %s response retry after midnight",
    async (failure) => {
      vi.setSystemTime(new Date("2026-10-01T14:59:50Z"));
      if (failure === "false") act.mockResolvedValueOnce(false);
      else act.mockRejectedValueOnce(new Error("response lost"));
      render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
      await click("읽기 오늘 1회 기록");
      expect(screen.getByRole("alert").textContent).toContain("저장 여부를 확인하지 못했어요");
      await tick("2026-10-01T15:00:00Z");
      expect(screen.getByText(/기록 날짜:/).textContent).toContain("2026-10-01");
      await click("읽기 2026-10-01 1회 기록");
      expect(act).toHaveBeenCalledTimes(2);
      expect(act.mock.calls.map((call) => call[1])).toEqual([
        { id: "goal", date: "2026-10-01" },
        { id: "goal", date: "2026-10-01" },
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("recognizes a committed record after a lost response without resending", async () => {
    act.mockResolvedValueOnce(false);
    const view = render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    await click("읽기 오늘 1회 기록");
    view.rerender(
      <TimerTool
        widget={timer()}
        widgets={[todo(goal({ frequencyRecords: [{ id: "record", date: "2026-10-02" }] }), 9)]}
        act={act}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await click("읽기 기록됨");
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("shows an existing same-day record after reopening and never repeats it", async () => {
    const target = todo(goal({ frequencyRecords: [{ id: "record", date: "2026-10-02" }] }));
    const view = render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
    expect(screen.getByRole("button", { name: "읽기 기록됨" })).toHaveProperty("disabled", true);
    view.unmount();
    render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
    await click("읽기 기록됨");
    expect(act).not.toHaveBeenCalled();
  });

  it("limits the chosen week and ignores the previous week's records", async () => {
    const records = ["2026-09-28", "2026-09-29", "2026-09-30"].map((date) => ({ id: date, date }));
    const view = render(
      <TimerTool
        widget={timer()}
        widgets={[todo(goal({ frequencyRecords: records }))]}
        act={act}
      />,
    );
    expect(screen.getByRole("button", { name: "읽기 이번 주 목표 달성" })).toHaveProperty(
      "disabled",
      true,
    );
    await click("읽기 이번 주 목표 달성");
    expect(act).not.toHaveBeenCalled();
    await tick("2026-10-04T15:00:00Z");
    view.rerender(
      <TimerTool
        widget={timer()}
        widgets={[todo(goal({ frequencyRecords: records }))]}
        act={act}
      />,
    );
    expect(screen.getByText(/기록 날짜:/).textContent).toContain("0/3회");
    await click("읽기 오늘 1회 기록");
    expect(act.mock.calls[0]?.[1]).toEqual({ id: "goal", date: "2026-10-05" });
  });

  it.each(["계속 집중", "5분 쉬기"])(
    "does not record again when choosing %s or when that session finishes",
    async (name) => {
      const target = todo(goal({ frequencyRecords: [{ id: "record", date: "2026-10-02" }] }));
      const view = render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
      await click(name);
      expect(act).toHaveBeenCalledExactlyOnceWith(name === "계속 집중" ? "continue" : "rest");
      view.rerender(<TimerTool widget={timer("running")} widgets={[target]} act={act} />);
      view.rerender(<TimerTool widget={timer()} widgets={[target]} act={act} />);
      expect(screen.getByRole("button", { name: "읽기 기록됨" })).toHaveProperty("disabled", true);
      expect(act).toHaveBeenCalledTimes(1);
    },
  );

  it("honors an explicit undo from a newer snapshot instead of retaining a stale saved label", async () => {
    const view = render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    await click("읽기 오늘 1회 기록");
    view.rerender(<TimerTool widget={timer()} widgets={[todo(goal(), 10)]} act={act} />);
    expect(screen.getByRole("button", { name: "읽기 오늘 1회 기록" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("does not apply a previous linked task's late response to a newly linked goal", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    act.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    fireEvent.click(screen.getByRole("button", { name: "읽기 오늘 1회 기록" }));
    const next = todo(goal({ id: "new-goal", title: "걷기" }));
    view.rerender(
      <TimerTool
        widget={widget("focus-timer", { status: "finished", todoId: "new-goal", remainingMs: 0 })}
        widgets={[next]}
        act={act}
      />,
    );
    await reactAct(async () => finish?.(true));
    expect(screen.queryByRole("button", { name: /기록됨/ })).toBeNull();
    expect(screen.getByRole("button", { name: "걷기 오늘 1회 기록" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to a different date for an unknown time zone", () => {
    render(
      <TimerTool
        widget={timer()}
        widgets={[
          todo(
            goal({ repeatRule: { mode: "frequency", timesPerWeek: 3, timeZone: "Missing/Zone" } }),
          ),
        ]}
        act={act}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("반복 시간대");
    expect(screen.getByRole("button", { name: /1회 기록/ })).toHaveProperty("disabled", true);
    expect(act).not.toHaveBeenCalled();
  });

  it("blocks a retry whose retained date is now in the future after a clock correction", async () => {
    act.mockResolvedValueOnce(false);
    render(<TimerTool widget={timer()} widgets={[todo()]} act={act} />);
    await click("읽기 오늘 1회 기록");
    await tick("2026-10-01T14:00:00Z");
    expect(screen.getByRole("alert").textContent).toContain("미래 날짜");
    await click("읽기 2026-10-02 1회 기록");
    expect(act).toHaveBeenCalledTimes(1);
  });
});

it.each([null, { mode: "calendar", unit: "day" }, { mode: "completion", unit: "day" }])(
  "preserves explicit ordinary completion for rule %s",
  async (repeatRule) => {
    const target = todo(goal({ repeatRule }));
    render(<TimerTool widget={timer()} widgets={[target]} act={act} />);
    expect(act).not.toHaveBeenCalled();
    expect(screen.queryByText(/기록 날짜:/)).toBeNull();
    await click("읽기 완료하기");
    expect(act).toHaveBeenCalledExactlyOnceWith("complete", { id: "goal" }, target);
  },
);
