import { createRef, useState, type FormEvent, type ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  FormField,
  IconButton,
  Select,
  TextArea,
  TextField,
} from "./ui";
import { ColorField } from "./widgets/WidgetAppearance/ColorField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("preserves required validation and explicit IDs declared on the child", () => {
  render(
    <form aria-label="일정">
      <FormField label="시작 날짜">
        <DateField id="event-start" required />
      </FormField>
      <FormField label="일정 이름">
        <TextField id="event-title" required />
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

it("preserves explicit form submission, native button refs and pending state", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
  const onPendingClick = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  const view = render(
    <form onSubmit={onSubmit}>
      <Button ref={ref}>미리보기</Button>
      <Button type="submit" name="action" value="save">
        저장
      </Button>
      <Button isPending onClick={onPendingClick}>
        연결 중
      </Button>
    </form>,
  );
  expect(ref.current).toBe(screen.getByRole("button", { name: "미리보기" }));
  await user.click(ref.current!);
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(onSubmit).toHaveBeenCalledOnce();
  const pending = screen.getByRole("button", { name: "연결 중" });
  expect(pending).toHaveProperty("disabled", true);
  expect(pending.getAttribute("aria-busy")).toBe("true");
  await user.click(pending);
  expect(onPendingClick).not.toHaveBeenCalled();
  view.rerender(
    <Button disabled aria-busy="false">
      완료
    </Button>,
  );
  expect(screen.getByRole("button", { name: "완료" })).toHaveProperty("disabled", true);
});

it("associates FormField labels, required validation and errors with the actual native fields", async () => {
  const user = userEvent.setup();
  const inputRef = createRef<HTMLInputElement>();
  const selectRef = createRef<HTMLSelectElement>();
  const textareaRef = createRef<HTMLTextAreaElement>();
  const dateRef = createRef<HTMLInputElement>();
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
        <TextField
          ref={inputRef}
          name="name"
          onChange={onChange}
          aria-describedby="additional-description"
        />
      </FormField>
      <FormField label="목록" required>
        <Select ref={selectRef} name="list" defaultValue="home">
          <option value="home">집</option>
          <option value="work">회사</option>
        </Select>
      </FormField>
      <FormField label="메모">
        <TextArea ref={textareaRef} name="memo" />
      </FormField>
      <FormField label="날짜">
        <DateField ref={dateRef} name="date" defaultValue="2026-10-15" />
      </FormField>
    </form>,
  );
  const input = screen.getByRole("textbox", { name: "사용자 이름" });
  expect(inputRef.current).toBe(input);
  expect(selectRef.current).toBe(screen.getByRole("combobox", { name: "목록" }));
  expect(textareaRef.current).toBe(screen.getByRole("textbox", { name: "메모" }));
  expect(dateRef.current).toBe(screen.getByLabelText("날짜"));
  expect(input).toHaveProperty("required", true);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const describedBy = input.getAttribute("aria-describedby")!.split(" ");
  expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
    "캐릭터가 부를 이름",
    "이름을 입력해 주세요",
    "기존 안내",
  ]);
  expect(inputRef.current?.validity.valueMissing).toBe(true);
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
    date: "2026-10-15",
  });
  view.rerender(
    <FormField label="사용자 이름">
      <TextField />
    </FormField>,
  );
  expect(screen.getByRole("textbox").hasAttribute("aria-invalid")).toBe(false);
  expect(screen.getByRole("textbox")).toHaveProperty("required", false);
});

it("retains native checkbox changes, explicit accessible names and description linkage", async () => {
  const user = userEvent.setup();
  const ref = createRef<HTMLInputElement>();
  const onChange = vi.fn();
  render(
    <>
      <p id="automatic-label">자동 대화</p>
      <Checkbox
        ref={ref}
        name="automatic"
        value="enabled"
        onChange={onChange}
        description="쉬는 동안 가끔 이야기해요"
        isInvalid
        aria-labelledby="automatic-label"
      >
        사용
      </Checkbox>
      <Checkbox disabled>잠긴 설정</Checkbox>
    </>,
  );
  const checkbox = screen.getByRole("checkbox", { name: "자동 대화" });
  expect(ref.current).toBe(checkbox);
  expect(checkbox.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(checkbox.getAttribute("aria-describedby")!)?.textContent).toBe(
    "쉬는 동안 가끔 이야기해요",
  );
  await user.click(screen.getByText("사용"));
  expect(checkbox).toHaveProperty("checked", true);
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange.mock.calls[0][0].target).toBe(checkbox);
  await user.click(screen.getByText("잠긴 설정"));
  expect(screen.getByRole("checkbox", { name: "잠긴 설정" })).toHaveProperty("checked", false);
});

it("keeps arbitrary icon button children and the field context for custom controls", async () => {
  const user = userEvent.setup();
  const iconRef = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <>
      <IconButton label="닫기" ref={iconRef} onClick={onClose}>
        <span aria-hidden>×</span>
      </IconButton>
      <FormField label="배경 색상" required error="색상이 필요해요">
        <ColorField value="#112233" onValueChange={() => undefined} />
      </FormField>
      <TextField aria-label="맞춤법" aria-invalid="spelling" isInvalid className="native-class" />
    </>,
  );
  expect(iconRef.current).toBe(screen.getByRole("button", { name: "닫기" }));
  await user.click(iconRef.current!);
  expect(onClose).toHaveBeenCalledOnce();
  const color = screen.getByRole("textbox", { name: "배경 색상" });
  expect(color).toHaveProperty("required", true);
  expect(color.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("색상이 필요해요").id).toBe(color.getAttribute("aria-describedby"));
  const input = screen.getByRole("textbox", { name: "맞춤법" });
  expect(input.getAttribute("aria-invalid")).toBe("spelling");
  expect(input.classList.contains("native-class")).toBe(true);
});

it("keeps native dialog cancellation and returns focus to the opening button", async () => {
  const user = userEvent.setup();
  function Editor(): ReactElement {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>설정 열기</Button>
        <Dialog title="설정" isOpen={open} onOpenChange={setOpen}>
          <FormField label="이름">
            <TextField />
          </FormField>
        </Dialog>
      </>
    );
  }
  render(<Editor />);
  const opener = screen.getByRole("button", { name: "설정 열기" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "설정" });
  expect(screen.getByRole("textbox", { name: "이름" })).toBeDefined();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
  expect(document.activeElement).toBe(opener);
});
