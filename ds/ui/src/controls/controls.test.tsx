import { createRef, useState, type FormEvent, type ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Button,
  Checkbox,
  IconButton,
  Radio,
  SearchInput,
  Select,
  Slider,
  Stepper,
  Switch,
  Textarea,
  TextInput,
} from "./index";

afterEach(cleanup);

describe("buttons", () => {
  it("uses a safe form default and preserves explicit submit and keyboard actions", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });
    const action = vi.fn();
    render(
      <form onSubmit={submit}>
        <Button onClick={action}>저장 전 확인</Button>
        <Button type="submit">저장</Button>
      </form>,
    );

    await user.tab();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^저장$/ }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it("names icon actions and keeps disabled actions inert", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <IconButton ref={ref} icon="send" aria-label="메시지 보내기" disabled onClick={action} />,
    );

    const button = screen.getByRole("button", { name: "메시지 보내기" });
    expect(ref.current).toBe(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await user.click(button);
    expect(action).not.toHaveBeenCalled();
  });
});

describe("native fields", () => {
  it("links labels, existing descriptions and errors while preserving original input text", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <span id="existing-help">원문을 보존합니다</span>
        <TextInput
          ref={ref}
          id="draft"
          label="메모 제목"
          defaultValue="별이  반짝여 ✨"
          description="제목을 입력해 주세요"
          error="제목을 다시 확인해 주세요"
          aria-describedby="existing-help"
        />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "메모 제목" }) as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.value).toBe("별이  반짝여 ✨");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual([
      "existing-help",
      "draft-description",
      "draft-error",
    ]);
    await user.type(input, "!");
    expect(input.value).toBe("별이  반짝여 ✨!");
  });

  it("keeps multiline text and search values available to native form submission", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Textarea
          label="내용"
          name="body"
          defaultValue={"첫 줄\n  두 번째 줄"}
          layout="code-compact"
        />
        <SearchInput label="위젯 찾기" name="query" defaultValue="메모" />
        <Select label="목록" name="list" defaultValue="work">
          <option value="work">업무</option>
          <option value="life">생활</option>
        </Select>
        <TextInput name="ignored" aria-label="비활성 입력" defaultValue="제외" disabled />
      </form>,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "목록" }), "life");
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const data = new FormData(form!);
    expect(data.get("body")).toBe("첫 줄\n  두 번째 줄");
    expect(data.get("query")).toBe("메모");
    expect(data.get("list")).toBe("life");
    expect(data.has("ignored")).toBe(false);
  });
});

describe("selection controls", () => {
  it("supports native checkbox, switch, radio-group and reset behavior", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <Checkbox label="자동 저장" name="autosave" defaultChecked />
        <Switch label="알림" name="notification" />
        <Radio label="업무" name="category" value="work" defaultChecked />
        <Radio label="생활" name="category" value="life" />
        <Button type="reset">초기화</Button>
      </form>,
    );

    await user.click(screen.getByRole("checkbox", { name: "자동 저장" }));
    await user.click(screen.getByRole("switch", { name: "알림" }));
    await user.click(screen.getByRole("radio", { name: "생활" }));
    const data = new FormData(container.querySelector("form")!);
    expect(data.has("autosave")).toBe(false);
    expect(data.get("notification")).toBe("on");
    expect(data.get("category")).toBe("life");
    expect((screen.getByRole("radio", { name: "업무" }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect((screen.getByRole("checkbox", { name: "자동 저장" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("switch", { name: "알림" }) as HTMLInputElement).checked).toBe(false);
  });

  it("forwards an indeterminate checkbox ref and preserves disabled selection", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} label="모두 선택" indeterminate disabled />);
    expect(ref.current?.indeterminate).toBe(true);
    await user.click(screen.getByText("모두 선택"));
    expect(ref.current?.checked).toBe(false);
    expect(ref.current?.indeterminate).toBe(true);
  });
});

describe("numeric controls", () => {
  it("preserves range input constraints, form value and reset", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { container } = render(
      <form>
        <Slider
          label="대화 속도"
          name="speed"
          min={10}
          max={30}
          step={5}
          defaultValue={15}
          onChange={change}
        />
        <Button type="reset">초기화</Button>
      </form>,
    );
    const input = screen.getByRole("slider", { name: "대화 속도" }) as HTMLInputElement;

    expect(input.style.getPropertyValue("--comet-slider-progress")).toBe("25%");
    fireEvent.change(input, { target: { value: "25" } });
    expect(change).toHaveBeenCalledOnce();
    expect(new FormData(container.querySelector("form")!).get("speed")).toBe("25");
    expect(input.min).toBe("10");
    expect(input.max).toBe("30");
    expect(input.step).toBe("5");
    expect(input.style.getPropertyValue("--comet-slider-progress")).toBe("75%");
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(input.value).toBe("15");
    expect(input.style.getPropertyValue("--comet-slider-progress")).toBe("25%");
  });

  it("uses native sanitized values for controlled and uncontrolled range fill", () => {
    render(
      <>
        <Slider label="기본 크기" defaultValue="invalid" />
        <Slider label="고정 크기" value="invalid" onChange={vi.fn()} />
      </>,
    );

    for (const label of ["기본 크기", "고정 크기"]) {
      const input = screen.getByRole("slider", { name: label }) as HTMLInputElement;
      expect(input.value).toBe("50");
      expect(input.style.getPropertyValue("--comet-slider-progress")).toBe("50%");
    }
  });

  it("steps by decimals within native bounds and resets uncontrolled form values", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <form>
        <Stepper
          label="글자 크기"
          min={1}
          max={2}
          step={0.5}
          defaultValue={1.5}
          onValueChange={change}
          unit="px"
        />
        <Button type="reset">초기화</Button>
      </form>,
    );
    const input = screen.getByRole("spinbutton", { name: "글자 크기" }) as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: "값 늘리기" }));
    expect(input.value).toBe("2");
    expect(change).toHaveBeenLastCalledWith(2);
    expect((screen.getByRole("button", { name: "값 늘리기" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(input.value).toBe("1.5");
    expect((screen.getByRole("button", { name: "값 늘리기" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await user.clear(input);
    await user.type(input, "1");
    expect(change).toHaveBeenLastCalledWith(1);
    expect((screen.getByRole("button", { name: "값 줄이기" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("updates through controlled value changes and respects read-only mode", async () => {
    const user = userEvent.setup();
    function ControlledExample(): ReactElement {
      const [value, setValue] = useState(16);
      return <Stepper label="크기" value={value} onValueChange={setValue} />;
    }
    const { rerender } = render(<ControlledExample />);
    await user.click(screen.getByRole("button", { name: "값 늘리기" }));
    expect((screen.getByRole("spinbutton", { name: "크기" }) as HTMLInputElement).value).toBe("17");

    const change = vi.fn();
    rerender(<Stepper label="크기" value={17} readOnly onValueChange={change} />);
    await user.click(screen.getByRole("button", { name: "값 늘리기" }));
    expect(change).not.toHaveBeenCalled();
    expect((screen.getByRole("spinbutton", { name: "크기" }) as HTMLInputElement).readOnly).toBe(
      true,
    );
  });

  it("keeps a controlled empty draft editable before another value or step is entered", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    function Example(): ReactElement {
      const [value, setValue] = useState("25");
      return (
        <Stepper
          label="집중 시간"
          value={value}
          min={1}
          max={120}
          onChange={(event) => setValue(event.currentTarget.value)}
          onValueChange={(next) => {
            change(next);
            setValue(String(next));
          }}
        />
      );
    }
    render(<Example />);
    const input = screen.getByRole<HTMLInputElement>("spinbutton", { name: "집중 시간" });
    await user.clear(input);
    expect(input.value).toBe("");
    expect(change).not.toHaveBeenCalled();
    await user.type(input, "5");
    expect(input.value).toBe("5");
    expect(change).toHaveBeenLastCalledWith(5);
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "값 늘리기" }));
    expect(input.value).toBe("1");
    expect(change).toHaveBeenLastCalledWith(1);
  });
});
