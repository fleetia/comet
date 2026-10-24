import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentedControl, Tabs } from "./Navigation";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setGeometry(element: HTMLElement, left: number, width: number, height = 26): void {
  Object.defineProperties(element, {
    offsetLeft: { value: left, configurable: true },
    offsetTop: { value: 0, configurable: true },
    offsetWidth: { value: width, configurable: true },
    offsetHeight: { value: height, configurable: true },
  });
}

const options = [
  { value: "today", label: "오늘" },
  { value: "tomorrow", label: "내일의 모든 기록" },
];

it("moves a single tab highlight to the selected physical position and unequal width", async () => {
  const user = userEvent.setup();
  const items = options.map((option) => ({ ...option, content: option.value }));
  const view = render(<Tabs label="기록" items={items} />);
  const today = screen.getByRole("tab", { name: "오늘" });
  const tomorrow = screen.getByRole("tab", { name: "내일의 모든 기록" });
  setGeometry(today, 162, 54, 34);
  setGeometry(tomorrow, 0, 162, 34);
  view.rerender(<Tabs label="기록" items={items} dir="rtl" />);
  const marker = screen
    .getByRole("tablist")
    .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
  expect(marker.style.transform).toBe("translateX(162px)");
  expect(marker.style.width).toBe("54px");
  await user.click(tomorrow);
  expect(screen.getByRole("tablist").querySelector('[aria-hidden="true"]')).toBe(marker);
  expect(marker.style.transform).toBe("translateX(0px)");
  expect(marker.style.width).toBe("162px");
  expect(screen.getByRole("tabpanel").textContent).toBe("tomorrow");
});

it("follows native segment selection and form reset without creating a second selection state", async () => {
  const user = userEvent.setup();
  const view = render(
    <form aria-label="날짜">
      <SegmentedControl label="날짜" options={options} name="date" />
    </form>,
  );
  setGeometry(screen.getByRole("radio", { name: "오늘" }).parentElement!, 0, 54);
  setGeometry(screen.getByRole("radio", { name: "내일의 모든 기록" }).parentElement!, 54, 162);
  view.rerender(
    <form aria-label="날짜">
      <SegmentedControl label="날짜" options={options} name="date" />
    </form>,
  );
  const marker = screen
    .getByRole("radiogroup")
    .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
  await user.click(screen.getByRole("radio", { name: "내일의 모든 기록" }));
  expect(marker.style.transform).toBe("translateX(54px)");
  expect(marker.style.width).toBe("162px");
  const form = screen.getByRole<HTMLFormElement>("form");
  expect(new FormData(form).get("date")).toBe("tomorrow");
  act(() => {
    form.reset();
  });
  await waitFor(() => {
    expect(marker.style.transform).toBe("translateX(0px)");
    expect(marker.style.width).toBe("54px");
  });
  expect(new FormData(form).get("date")).toBe("today");
});

it("keeps the controlled highlight at its owner's value until the owner changes it", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const view = render(
    <SegmentedControl label="날짜" options={options} value="today" onValueChange={change} />,
  );
  setGeometry(screen.getByRole("radio", { name: "오늘" }).parentElement!, 0, 54);
  setGeometry(screen.getByRole("radio", { name: "내일의 모든 기록" }).parentElement!, 54, 162);
  view.rerender(
    <SegmentedControl label="날짜" options={options} value="today" onValueChange={change} />,
  );
  const marker = screen
    .getByRole("radiogroup")
    .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
  await user.click(screen.getByRole("radio", { name: "내일의 모든 기록" }));
  expect(change).toHaveBeenCalledWith("tomorrow");
  expect(marker.style.transform).toBe("translateX(0px)");
  view.rerender(
    <SegmentedControl label="날짜" options={options} value="tomorrow" onValueChange={change} />,
  );
  expect(marker.style.transform).toBe("translateX(54px)");
});

it("remeasures changed label dimensions and disconnects its resize observer", () => {
  let notifyResize = (): void => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", function (callback: () => void) {
    notifyResize = callback;
    return { observe: vi.fn(), disconnect };
  });
  const view = render(<SegmentedControl label="날짜" options={options} value="tomorrow" />);
  const selected = screen.getByRole("radio", { name: "내일의 모든 기록" }).parentElement!;
  const marker = screen
    .getByRole("radiogroup")
    .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
  setGeometry(selected, 72, 188);
  act(() => notifyResize());
  expect(marker.style.transform).toBe("translateX(72px)");
  expect(marker.style.width).toBe("188px");
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  setGeometry(selected, 100, 220);
  act(() => notifyResize());
  expect(marker.style.transform).toBe("translateX(72px)");
});

it.each([true, false])(
  "hides the highlight when an external radio sharing its name wins (form=%s)",
  async (hasForm) => {
    const user = userEvent.setup();
    const content = (
      <>
        <SegmentedControl label="날짜" name="shared-date" options={options} />
        <label>
          <input type="radio" name="shared-date" value="external" />
          외부 선택
        </label>
      </>
    );
    render(hasForm ? <form>{content}</form> : <div>{content}</div>);
    const marker = screen
      .getByRole("radiogroup")
      .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
    expect(marker.hidden).toBe(false);
    await user.click(screen.getByRole("radio", { name: "외부 선택" }));
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "오늘" }).checked).toBe(false);
    expect(marker.hidden).toBe(true);
    await user.click(screen.getByRole("radio", { name: "내일의 모든 기록" }));
    expect(marker.hidden).toBe(false);
  },
);

it("hides the highlight for a radio outside its form with the same form owner", async () => {
  const user = userEvent.setup();
  render(
    <>
      <form id="date-form">
        <SegmentedControl label="날짜" name="shared-date" options={options} size="display-mode" />
      </form>
      <label>
        <input type="radio" name="shared-date" value="external" form="date-form" />
        외부 선택
      </label>
    </>,
  );
  const today = screen.getByRole<HTMLInputElement>("radio", { name: "오늘" });
  const external = screen.getByRole<HTMLInputElement>("radio", { name: "외부 선택" });
  const marker = screen
    .getByRole("radiogroup")
    .querySelector<HTMLSpanElement>('[aria-hidden="true"]')!;
  expect(external.form).toBe(today.form);
  expect(marker.hidden).toBe(false);
  // The test DOM does not uncheck radios across form= associations.
  today.checked = false;
  await user.click(external);
  expect(external.checked).toBe(true);
  expect(marker.hidden).toBe(true);
  await user.click(screen.getByRole("radio", { name: "내일의 모든 기록" }));
  expect(marker.hidden).toBe(false);
});
