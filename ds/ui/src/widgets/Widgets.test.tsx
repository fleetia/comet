import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUsagePicker, EnvelopeWidget, FocusTimerWidget, WidgetStackSummary } from "./Widgets";

afterEach(cleanup);
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
    rerender(<EnvelopeWidget title="빈 봉투" date="10월 24일" tasks={[]} />);
    expect((screen.getByRole("progressbar") as HTMLProgressElement).max).toBe(1);
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
