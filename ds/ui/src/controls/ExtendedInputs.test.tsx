import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmountInput,
  MultilineEditor,
  NumberInput,
  PropertyItem,
  ShortcutInput,
  TextSurfaceInput,
  TimeInput,
  URLInput,
} from "./ExtendedInputs";
afterEach(cleanup);

describe("specialized native fields", () => {
  it("preserves raw amount text, field messages and forwarded refs", async () => {
    const ref = createRef<HTMLInputElement>();
    render(<AmountInput ref={ref} label="지출" defaultValue="4,500" error="금액 확인" />);
    const input = screen.getByRole("textbox", { name: "지출" }) as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.value).toBe("4,500");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "금액 확인",
    );
    await userEvent.setup().type(input, "0");
    expect(input.value).toBe("4,5000");
  });
  it("keeps numeric, URL, and time fields native and multiline text intact", () => {
    render(
      <>
        <NumberInput label="개수" min={1} max={12} defaultValue={3} />
        <TimeInput label="시각" defaultValue="22:00" />
        <URLInput label="링크" defaultValue="https://example.com" />
        <MultilineEditor label="본문" defaultValue={"첫 줄\n  둘째 줄"} />
      </>,
    );
    const number = screen.getByRole("spinbutton", { name: "개수" }) as HTMLInputElement;
    expect(number.min).toBe("1");
    expect(number.max).toBe("12");
    expect((screen.getByLabelText("시각") as HTMLInputElement).type).toBe("time");
    expect((screen.getByLabelText("링크") as HTMLInputElement).type).toBe("url");
    expect((screen.getByRole("textbox", { name: "본문" }) as HTMLTextAreaElement).value).toBe(
      "첫 줄\n  둘째 줄",
    );
  });
  it("preserves controlled values and disabled fields", async () => {
    const change = vi.fn();
    render(<TextSurfaceInput label="내용" value="기존 값" disabled onChange={change} />);
    await userEvent.setup().type(screen.getByRole("textbox", { name: "내용" }), "수정");
    expect(change).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "내용" }) as HTMLInputElement).value).toBe(
      "기존 값",
    );
  });
});
describe("shortcut capture", () => {
  it("captures only focused key combinations and leaves Tab navigation available", () => {
    const change = vi.fn();
    render(<ShortcutInput label="열기 단축키" onShortcutChange={change} />);
    const button = screen.getByRole("button", { name: "열기 단축키" });
    expect(fireEvent.keyDown(button, { key: "Tab" })).toBe(true);
    fireEvent.keyDown(button, { key: "Meta", metaKey: true });
    expect(change).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(button, { key: " ", metaKey: true, shiftKey: true })).toBe(false);
    expect(change).toHaveBeenCalledWith(["Meta", "Shift", "Space"]);
    expect(button.textContent).toBe("⌘⇧Space");
  });
  it("keeps controlled shortcuts and composed input unchanged", () => {
    const change = vi.fn();
    render(<ShortcutInput label="단축키" value={["Control", "k"]} onShortcutChange={change} />);
    const button = screen.getByRole("button", { name: "단축키" });
    fireEvent.keyDown(button, { key: "Process", isComposing: true });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "a", altKey: true });
    expect(change).toHaveBeenCalledWith(["Alt", "a"]);
    expect(button.textContent).toBe("Ctrlk");
  });
  it("restores an uncontrolled shortcut when its form resets", async () => {
    render(
      <form aria-label="단축키 설정">
        <ShortcutInput label="열기" defaultValue={["Meta", "k"]} />
        <button type="reset">초기화</button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "열기" });
    fireEvent.keyDown(button, { key: "a", ctrlKey: true });
    expect(button.textContent).toBe("Ctrla");
    await userEvent.setup().click(screen.getByRole("button", { name: "초기화" }));
    expect(button.textContent).toBe("⌘k");
  });
});
it("property actions are keyboard buttons and retain zero-valued details", async () => {
  const action = vi.fn();
  render(<PropertyItem label="스티커" valueLabel={0} selected onClick={action} />);
  const button = screen.getByRole("button", { name: "스티커 0" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  await userEvent.setup().click(button);
  expect(action).toHaveBeenCalledOnce();
});
