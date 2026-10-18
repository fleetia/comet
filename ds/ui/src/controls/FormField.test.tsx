import { createRef, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Checkbox } from "./Checkbox";
import { FormField, useFormField } from "./FormField";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { TextInput } from "./TextInput";

afterEach(cleanup);

it("preserves required validation and explicit IDs declared on the child", () => {
  render(
    <form aria-label="일정">
      <FormField label="시작 날짜">
        <TextInput type="date" id="event-start" required />
      </FormField>
      <FormField label="일정 이름">
        <TextInput id="event-title" required />
      </FormField>
    </form>,
  );
  expect(screen.getByLabelText("시작 날짜").id).toBe("event-start");
  const title = screen.getByRole("textbox", { name: "일정 이름" });
  expect(title.id).toBe("event-title");
  expect(title).toHaveProperty("required", true);
  expect(title.getAttribute("aria-required")).toBe("true");
  expect((screen.getByRole("form", { name: "일정" }) as HTMLFormElement).checkValidity()).toBe(
    false,
  );
});

it("associates labels, required validation and errors with the actual native fields", async () => {
  const user = userEvent.setup();
  const inputRef = createRef<HTMLInputElement>();
  const selectRef = createRef<HTMLSelectElement>();
  const textareaRef = createRef<HTMLTextAreaElement>();
  const onChange = vi.fn();
  const view = render(
    <form aria-label="설정">
      <p id="additional-description">기존 안내</p>
      <FormField
        label="사용자 이름"
        description="캐릭터가 부를 이름"
        error="이름을 입력해 주세요"
        required
      >
        <TextInput
          fill
          ref={inputRef}
          name="name"
          onChange={onChange}
          aria-describedby="additional-description"
        />
      </FormField>
      <FormField label="목록" required>
        <Select fill ref={selectRef} name="list" defaultValue="home">
          <option value="home">집</option>
          <option value="work">회사</option>
        </Select>
      </FormField>
      <FormField label="메모">
        <Textarea fill ref={textareaRef} name="memo" />
      </FormField>
    </form>,
  );
  const input = screen.getByRole("textbox", { name: "사용자 이름" });
  expect(inputRef.current).toBe(input);
  expect(selectRef.current).toBe(screen.getByRole("combobox", { name: "목록" }));
  expect(textareaRef.current).toBe(screen.getByRole("textbox", { name: "메모" }));
  expect(input).toHaveProperty("required", true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toBe("이름을 입력해 주세요");
  const describedBy = input.getAttribute("aria-describedby")!.split(" ");
  expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
    "캐릭터가 부를 이름",
    "이름을 입력해 주세요",
    "기존 안내",
  ]);
  await user.click(screen.getByText("사용자 이름"));
  expect(document.activeElement).toBe(input);
  await user.type(input, "별");
  await user.selectOptions(selectRef.current!, "work");
  await user.type(textareaRef.current!, "  첫째 줄\n둘째 줄  ");
  expect(onChange).toHaveBeenCalled();
  const data = new FormData(screen.getByRole("form", { name: "설정" }) as HTMLFormElement);
  expect(Object.fromEntries(data)).toEqual({
    name: "별",
    list: "work",
    memo: "  첫째 줄\n둘째 줄  ",
  });
  view.rerender(
    <FormField label="사용자 이름">
      <TextInput />
    </FormField>,
  );
  expect(screen.getByRole("textbox").hasAttribute("aria-invalid")).toBe(false);
  expect(screen.getByRole("textbox")).toHaveProperty("required", false);
});

it("wires checkboxes and keeps specific invalid tokens from the control", () => {
  render(
    <>
      <FormField label="자동 대화" description="쉬는 동안 가끔 이야기해요">
        <Checkbox label="사용" />
      </FormField>
      <FormField label="맞춤법">
        <TextInput aria-invalid="spelling" className="native-class" />
      </FormField>
    </>,
  );
  const checkbox = screen.getByRole("checkbox", { name: "자동 대화 사용" });
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)?.textContent).toBe(
    "쉬는 동안 가끔 이야기해요",
  );
  const input = screen.getByRole("textbox", { name: "맞춤법" });
  expect(input.getAttribute("aria-invalid")).toBe("spelling");
  expect(input.classList.contains("native-class")).toBe(true);
});

it("shares field state with custom controls", () => {
  function CustomControl(): ReactElement {
    const field = useFormField();
    return (
      <input
        id={field?.controlId}
        required={field?.isRequired}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.isInvalid || undefined}
      />
    );
  }
  render(
    <FormField label="배경 색상" required error="색상이 필요해요">
      <CustomControl />
    </FormField>,
  );
  const control = screen.getByRole("textbox", { name: "배경 색상" });
  expect(control).toHaveProperty("required", true);
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("색상이 필요해요").id).toBe(control.getAttribute("aria-describedby"));
});
