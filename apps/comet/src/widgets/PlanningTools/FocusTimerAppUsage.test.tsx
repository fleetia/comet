import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { TimerTool } from "./FocusTimerTool";
import { FocusTimerAppUsage } from "./FocusTimerAppUsage";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
  errorText: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));
const target = { id: "app:editor", name: "글쓰기" };
const other = { id: "app:browser", name: "브라우저" };
const action = vi.fn<ToolAction>();
const listing = { applications: [target, other], supported: true, message: "" };
function widget(data: DataRecord): WidgetView {
  return {
    id: "focus",
    kind: "focus-timer",
    reaction: true,
    revision: 1,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
async function click(name: string): Promise<void> {
  await reactAct(async () => fireEvent.click(screen.getByRole("button", { name })));
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(command).mockReset().mockResolvedValue(listing);
  vi.mocked(isDesktop).mockReturnValue(true);
  action.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("program usage selection", () => {
  it("lists apps only when opened and configures only after explicit save", async () => {
    const view = render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    expect(command).not.toHaveBeenCalled();
    await click("프로그램 선택");
    expect(command).toHaveBeenCalledExactlyOnceWith("list_usage_applications");
    expect(screen.getByText(/백그라운드 실행 시간/)).toBeTruthy();
    expect(screen.getByText(/창 제목이나 작업 내용은 읽거나 저장하지 않아요/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: target.name }));
    expect(action).not.toHaveBeenCalled();
    await click("프로그램 선택 저장");
    expect(action).toHaveBeenCalledExactlyOnceWith("configure", { appUsageTarget: target });
    expect(screen.queryByRole("dialog")).toBeNull();
    // The saved snapshot, rather than the local selection, owns the displayed identity.
    expect(screen.getByText("선택한 프로그램 없음")).toBeTruthy();
    view.rerender(
      <FocusTimerAppUsage data={{ status: "idle", appUsageTarget: target }} act={action} />,
    );
    expect(screen.getByText(target.name)).toBeTruthy();
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:00");
  });

  it("refreshes the list, retains the selected app when it exits, and cancels without configuring", async () => {
    render(<FocusTimerAppUsage data={{ status: "idle", appUsageTarget: target }} act={action} />);
    await click("프로그램 변경");
    vi.mocked(command).mockResolvedValueOnce({ ...listing, applications: [other] });
    await click("프로그램 목록 새로고침");
    expect(command).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("radio", { name: target.name })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: other.name }));
    await click("취소");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText(target.name)).toBeTruthy();
  });

  it("allows opting out even when the current platform is unsupported", async () => {
    vi.mocked(command).mockResolvedValueOnce({
      applications: [],
      supported: false,
      message: "현재 환경에서는 지원하지 않아요.",
    });
    render(
      <FocusTimerAppUsage data={{ status: "finished", appUsageTarget: target }} act={action} />,
    );
    await click("프로그램 변경");
    expect(screen.getByText("현재 환경에서는 지원하지 않아요.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "측정할 프로그램" })).toHaveProperty("disabled", true);
    await click("사용 시간 측정 끄기");
    expect(action).toHaveBeenCalledExactlyOnceWith("configure", { appUsageTarget: null });
  });

  it("shows the desktop-only explanation without invoking native commands in preview", async () => {
    vi.mocked(isDesktop).mockReturnValue(false);
    render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    expect(command).not.toHaveBeenCalled();
    expect(
      screen.getByText("프로그램 선택과 사용 시간 측정은 데스크톱 앱에서 사용할 수 있어요."),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "측정할 프로그램" })).toHaveProperty("disabled", true);
  });

  it("shows a failed lookup and retries only when requested", async () => {
    vi.mocked(command).mockRejectedValueOnce(new Error("native unavailable"));
    render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    expect(screen.getByRole("alert").textContent).toContain("native unavailable");
    expect(command).toHaveBeenCalledTimes(1);
    await click("프로그램 목록 새로고침");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("radio", { name: target.name })).toBeTruthy();
  });

  it.each(["false", "rejected"])(
    "preserves a picker choice after a %s save failure",
    async (failure) => {
      if (failure === "false") action.mockResolvedValueOnce(false);
      else action.mockRejectedValueOnce(new Error("save failed"));
      render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
      await click("프로그램 선택");
      fireEvent.click(screen.getByRole("radio", { name: target.name }));
      await click("프로그램 선택 저장");
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("radio", { name: target.name })).toHaveProperty("checked", true);
      await click("프로그램 선택 저장");
      expect(action.mock.calls).toEqual([
        ["configure", { appUsageTarget: target }],
        ["configure", { appUsageTarget: target }],
      ]);
    },
  );

  it("blocks duplicate save clicks until the action settles", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    action.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    fireEvent.click(screen.getByRole("radio", { name: target.name }));
    const save = screen.getByRole("button", { name: "프로그램 선택 저장" });
    reactAct(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(action).toHaveBeenCalledTimes(1);
    await reactAct(async () => finish?.(true));
  });

  it("disables an already open picker when another window starts focus", async () => {
    const view = render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    fireEvent.click(screen.getByRole("radio", { name: target.name }));
    view.rerender(<FocusTimerAppUsage data={{ status: "running", mode: "focus" }} act={action} />);
    expect(screen.getByRole("group", { name: "측정할 프로그램" })).toHaveProperty("disabled", true);
    await click("프로그램 선택 저장");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText("집중이나 휴식을 마친 뒤 프로그램을 바꿀 수 있어요.")).toBeTruthy();
  });

  it("does not reopen or populate a closed picker from a late result", async () => {
    let finish: ((value: DataRecord) => void) | undefined;
    vi.mocked(command).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    await click("취소");
    await reactAct(async () => finish?.(listing));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(action).not.toHaveBeenCalled();
    await click("프로그램 선택");
    expect(command).toHaveBeenCalledTimes(2);
  });
});

describe("backend-owned usage readout", () => {
  it("keeps optional session links folded and opens the original program picker on demand", async () => {
    vi.mocked(command).mockImplementation(async (name) =>
      name === "get_planner_notification_permission" ? "prompt" : listing,
    );
    render(
      <TimerTool
        widget={widget({ status: "idle", durationMs: 1500000 })}
        widgets={[]}
        act={action}
      />,
    );
    expect(screen.queryByRole("region", { name: "프로그램 사용 시간" })).toBeNull();
    const options = screen.getByText("이번 집중 연결").closest("details")!;
    expect(options.open).toBe(false);
    fireEvent.click(screen.getByText("이번 집중 연결"));
    expect(screen.queryByLabelText("휴식 시간 (분)")).toBeNull();
    await click("프로그램 사용 시간");
    expect(screen.getByRole("radio", { name: target.name })).toBeTruthy();
    expect(command).toHaveBeenCalledWith("list_usage_applications");
    await click("취소");
    expect(screen.getByRole("button", { name: "집중 시작" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "프로그램 사용 시간" })).toBeNull();
  });

  it("fits the native window to either panel without replacing a user's larger height or resizing embedded hosts", async () => {
    let bodyHeight = 748;
    const callbacks: (() => void)[] = [];
    const previousHeight = window.innerHeight;
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-expanded") ? bodyHeight : 0;
      });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    window.innerHeight = 580;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "set_focus_expanded") window.innerHeight = Number(args?.height);
      return undefined;
    });
    async function settle(): Promise<void> {
      await reactAct(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    try {
      const props = {
        widget: widget({ status: "idle", durationMs: 1500000 }),
        widgets: [],
        act: action,
      };
      const view = render(<TimerTool {...props} />);
      await settle();
      expect(command).toHaveBeenCalledExactlyOnceWith("set_focus_expanded", {
        id: "focus",
        expanded: true,
        collapsed: false,
        height: 748,
        animate: false,
        autoFit: true,
      });
      bodyHeight = 620;
      callbacks.forEach((callback) => callback());
      await settle();
      expect(command).toHaveBeenLastCalledWith("set_focus_expanded", {
        id: "focus",
        expanded: true,
        collapsed: false,
        height: 620,
        animate: false,
        autoFit: true,
      });
      window.innerHeight = 900;
      bodyHeight = 600;
      callbacks.forEach((callback) => callback());
      await settle();
      expect(command).toHaveBeenCalledTimes(2);
      view.rerender(<TimerTool {...props} embedded />);
      bodyHeight = 1100;
      callbacks.forEach((callback) => callback());
      await settle();
      expect(command).toHaveBeenCalledTimes(2);
      expect(action).not.toHaveBeenCalled();
    } finally {
      scrollHeight.mockRestore();
      vi.unstubAllGlobals();
      window.innerHeight = previousHeight;
    }
  });

  it("keeps embedded focus expansion local and delegates collapse to its desktop stack", async () => {
    vi.useFakeTimers();
    const onCollapse = vi.fn();
    render(
      <TimerTool
        widget={widget({ status: "idle", durationMs: 1500000 })}
        widgets={[]}
        act={action}
        embedded
        onCollapse={onCollapse}
      />,
    );
    expect(screen.getByLabelText("일정과 집중 기록").hasAttribute("inert")).toBe(true);
    await click("기록과 노트");
    await reactAct(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole("region", { name: "집중 통계" })).toBeTruthy();
    expect(screen.getByLabelText("일정과 집중 기록").hasAttribute("inert")).toBe(false);
    await click("접기");
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps the countdown alongside usage and never extrapolates usage on local clock ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00"));
    const data = {
      status: "running",
      mode: "focus",
      durationMs: 1500000,
      remainingMs: 1500000,
      deadline: Date.now() + 1500000,
      appUsageTarget: target,
      activeSession: { id: "active", appUsage: { target, elapsedMs: 12345, status: "tracking" } },
    };
    const view = render(<TimerTool widget={widget(data)} widgets={[]} act={action} />);
    expect(screen.getByLabelText("남은 시간").textContent).toBe("25:00");
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:12");
    expect(screen.queryByRole("button", { name: "프로그램 변경" })).toBeNull();
    await reactAct(async () => vi.advanceTimersByTime(3000));
    expect(screen.getByLabelText("남은 시간").textContent).toBe("24:57");
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:12");
    view.rerender(
      <TimerTool
        widget={widget({
          ...data,
          activeSession: {
            id: "active",
            appUsage: { target, elapsedMs: 15000, status: "other-app" },
          },
        })}
        widgets={[]}
        act={action}
      />,
    );
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:15");
    expect(screen.getByText(/선택한 프로그램으로 전환하면 측정해요/)).toBeTruthy();
  });

  it.each(["paused", "rest"])("does not invent usage while %s", async (phase) => {
    vi.useFakeTimers();
    const data = {
      status: phase === "rest" ? "running" : "paused",
      mode: phase === "rest" ? "rest" : "focus",
      appUsageTarget: target,
      ...(phase === "rest"
        ? { sessions: [{ appUsage: { target, elapsedMs: 62500, status: "tracking" } }] }
        : { activeSession: { appUsage: { target, elapsedMs: 62500, status: "tracking" } } }),
    };
    render(<FocusTimerAppUsage data={data} act={action} />);
    await reactAct(async () => vi.advanceTimersByTime(180000));
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("01:02");
    expect(
      screen.getByText(phase === "rest" ? /휴식 중 · 측정 멈춤/ : /일시정지 중 · 측정 멈춤/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "프로그램 변경" })).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it("shows unsupported status without disguising existing focus time as app use", () => {
    render(
      <FocusTimerAppUsage
        data={{
          status: "running",
          mode: "focus",
          appUsageTarget: target,
          activeSession: {
            elapsedMs: 999000,
            appUsage: { target, elapsedMs: 0, status: "unsupported" },
          },
        }}
        act={action}
      />,
    );
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:00");
    expect(screen.getByText(/이 환경에서는 프로그램 사용 시간을 측정할 수 없어요/)).toBeTruthy();
  });

  it("does not relabel a previous program's total after choosing a different program", () => {
    render(
      <FocusTimerAppUsage
        data={{
          status: "finished",
          appUsageTarget: other,
          sessions: [{ appUsage: { target, elapsedMs: 90000, status: "tracking" } }],
        }}
        act={action}
      />,
    );
    expect(screen.getByText(other.name)).toBeTruthy();
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:00");
  });

  it("never borrows a previous session's total when a current focus has no usage record", () => {
    render(
      <FocusTimerAppUsage
        data={{
          status: "running",
          mode: "focus",
          appUsageTarget: target,
          activeSession: { id: "legacy-session" },
          sessions: [{ appUsage: { target, elapsedMs: 90000, status: "tracking" } }],
        }}
        act={action}
      />,
    );
    expect(screen.getByLabelText("프로그램 누적 사용 시간").textContent).toBe("00:00");
  });
});
