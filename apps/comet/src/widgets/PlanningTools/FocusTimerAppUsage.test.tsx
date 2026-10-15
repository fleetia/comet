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
    installed: true,
    enabled: true,
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
    expect(screen.getByText(/백그라운드 실행 시간/).textContent).toContain(
      "창 제목이나 작업 내용은 읽거나 저장하지 않아요",
    );
    fireEvent.change(screen.getByLabelText("측정할 프로그램"), { target: { value: target.id } });
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
    expect(screen.getByLabelText("측정할 프로그램")).toHaveProperty("value", target.id);
    fireEvent.change(screen.getByLabelText("측정할 프로그램"), { target: { value: other.id } });
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
    expect(screen.getByLabelText("측정할 프로그램")).toHaveProperty("disabled", true);
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
    expect(screen.getByLabelText("측정할 프로그램")).toHaveProperty("disabled", true);
  });

  it("shows a failed lookup and retries only when requested", async () => {
    vi.mocked(command).mockRejectedValueOnce(new Error("native unavailable"));
    render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
    await click("프로그램 선택");
    expect(screen.getByRole("alert").textContent).toContain("native unavailable");
    expect(command).toHaveBeenCalledTimes(1);
    await click("프로그램 목록 새로고침");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("option", { name: target.name })).toBeTruthy();
  });

  it.each(["false", "rejected"])(
    "preserves a picker choice after a %s save failure",
    async (failure) => {
      if (failure === "false") action.mockResolvedValueOnce(false);
      else action.mockRejectedValueOnce(new Error("save failed"));
      render(<FocusTimerAppUsage data={{ status: "idle" }} act={action} />);
      await click("프로그램 선택");
      fireEvent.change(screen.getByLabelText("측정할 프로그램"), { target: { value: target.id } });
      await click("프로그램 선택 저장");
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByLabelText("측정할 프로그램")).toHaveProperty("value", target.id);
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
    fireEvent.change(screen.getByLabelText("측정할 프로그램"), { target: { value: target.id } });
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
    fireEvent.change(screen.getByLabelText("측정할 프로그램"), { target: { value: target.id } });
    view.rerender(<FocusTimerAppUsage data={{ status: "running", mode: "focus" }} act={action} />);
    expect(screen.getByLabelText("측정할 프로그램")).toHaveProperty("disabled", true);
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
    expect(screen.getByRole("button", { name: "프로그램 변경" })).toHaveProperty("disabled", true);
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
    expect(screen.getByText("선택한 프로그램으로 전환하면 측정해요.")).toBeTruthy();
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
      screen.getByText(phase === "rest" ? "휴식 중 · 측정 멈춤" : "일시정지 중 · 측정 멈춤"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "프로그램 변경" })).toHaveProperty("disabled", true);
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
    expect(screen.getByText("이 환경에서는 프로그램 사용 시간을 측정할 수 없어요.")).toBeTruthy();
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
