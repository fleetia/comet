import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUsagePicker, EnvelopeWidget, FocusTimerWidget, WidgetStackSummary } from "./Widgets";

afterEach(cleanup);
const envelopeLabels = {
  heading: "준비 봉투",
  progress: "봉투 준비 현황",
  count: (completed: number, total: number) => `${total}개 중 ${completed}개`,
  focus: "이 봉투로 집중",
  open: "봉투 열기",
};
describe("controlled widgets", () => {
  it("delegates task, duration and start actions without progressing its own phase", async () => {
    const user = userEvent.setup();
    const task = vi.fn();
    const duration = vi.fn();
    const start = vi.fn();
    render(
      <FocusTimerWidget
        task="기획서 초안"
        time="25:00"
        onTaskChange={task}
        onDurationChange={duration}
        onStart={start}
      />,
    );
    await user.type(screen.getByRole("textbox"), " ");
    expect(task).toHaveBeenCalledWith("기획서 초안 ");
    await user.click(screen.getByRole("button", { name: "50분" }));
    expect(duration).toHaveBeenCalledWith(50);
    await user.click(screen.getByRole("button", { name: "집중 시작" }));
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "집중 시작" })).toBeTruthy();
    expect(screen.getByText("25:00")).toBeTruthy();
  });
  it("changes only selected task id and keeps incomplete totals meaningful", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { rerender } = render(
      <EnvelopeWidget
        title="가족 여행"
        labels={envelopeLabels}
        date="10월 24일"
        tasks={[
          { id: "stay", title: "숙소 예약", completed: true },
          { id: "snack", title: "간식 사기" },
        ]}
        onTaskChange={change}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "간식 사기" }));
    expect(change).toHaveBeenCalledWith("snack", true);
    expect((screen.getByRole("progressbar") as HTMLProgressElement).value).toBe(1);
    rerender(
      <EnvelopeWidget title="빈 봉투" labels={envelopeLabels} date="10월 24일" tasks={[]} />,
    );
    expect(screen.getByText("0개 중 0개")).toBeTruthy();
    expect((screen.getByRole("progressbar") as HTMLProgressElement).max).toBe(1);
  });
  it("supports the app's digit view, custom duration and disabled start", async () => {
    const start = vi.fn();
    const user = userEvent.setup();
    render(
      <FocusTimerWidget
        task="책 읽기"
        time="12:00"
        presentation="digits"
        progress={0.5}
        startDisabled
        onStart={start}
        customDuration={<button type="button">직접</button>}
        setup={<input aria-label="직접 입력할 시간" />}
      />,
    );
    expect(screen.getByRole("timer", { name: "남은 시간" }).textContent).toBe("12:00");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByRole("button", { name: "직접" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "집중 시작" }));
    expect(start).not.toHaveBeenCalled();
  });
  it("delegates completion note persistence and manual rest without assuming a five minute break", async () => {
    const user = userEvent.setup();
    const rest = vi.fn();
    const blur = vi.fn();
    const { rerender } = render(
      <FocusTimerWidget
        task="책 읽기"
        time="00:00"
        phase="complete"
        note="요약"
        onNoteChange={() => {}}
        onNoteBlur={blur}
        onRest={rest}
        restLabel="10분 휴식"
      />,
    );
    await user.click(screen.getByRole("textbox", { name: "이번 집중 메모" }));
    await user.click(screen.getByRole("button", { name: "10분 휴식" }));
    expect(blur).toHaveBeenCalledOnce();
    expect(rest).toHaveBeenCalledOnce();
    rerender(
      <FocusTimerWidget
        task="책 읽기"
        time="00:00"
        phase="rest-complete"
        timeDescription="쉬는 시간 10분이 끝났어요"
      />,
    );
    expect(screen.getByText("쉬는 시간 10분이 끝났어요")).toBeTruthy();
    expect(screen.queryByText("쉬는 시간 5분이 끝났어요")).toBeNull();
  });
  it("isolates native radio groups across pickers and delegates selected values", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const options = [
      { id: "none", name: "측정하지 않음" },
      { id: "editor", name: "편집기" },
    ];
    render(
      <>
        <AppUsagePicker options={options} value="none" onValueChange={select} />
        <AppUsagePicker options={options} value="editor" />
      </>,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios[0].name).not.toBe(radios[2].name);
    await user.click(radios[1]);
    expect(select).toHaveBeenCalledWith("editor");
    expect(radios[3].checked).toBe(true);
  });
  it("selects the summary item by id and preserves inactive disabled items", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <WidgetStackSummary
        items={[
          { id: "focus", icon: "timer", label: "집중 18:42", active: true },
          { id: "music", icon: "music", label: "밤의 산책", disabled: true },
        ]}
        onSelect={select}
      />,
    );
    await user.click(screen.getByRole("button", { name: "집중 18:42" }));
    expect(select).toHaveBeenCalledWith("focus");
    await user.click(screen.getByRole("button", { name: "밤의 산책" }));
    expect(select).toHaveBeenCalledOnce();
  });
});
