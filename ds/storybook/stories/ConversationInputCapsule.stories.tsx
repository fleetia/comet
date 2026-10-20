import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { InputCapsule } from "@comet/ui";

const meta = {
  title: "UI/conversation/InputCapsule",
  component: InputCapsule,
  tags: ["autodocs"],
  args: { defaultValue: "질문 두 개만 골라 줘", form: "single", sending: false, label: "메시지" },
  argTypes: {
    form: {
      control: "select",
      options: ["single", "multiline", "large"],
    },
    sending: {
      control: "boolean",
    },
    asTextarea: {
      control: "boolean",
    },
    disableInputWhileSending: {
      control: "boolean",
    },
    sendDisabled: {
      control: "boolean",
    },
    textareaProps: {
      control: false,
    },
    inputRef: {
      control: false,
    },
    disabled: {
      control: "boolean",
    },
    defaultValue: {
      control: "text",
    },
    value: {
      control: false,
    },
    label: {
      control: "text",
    },
    placeholder: {
      control: "text",
    },
    sendLabel: {
      control: "text",
    },
    sendSize: {
      control: "select",
      options: ["regular", "compact"],
    },
    onValueChange: {
      control: false,
    },
    onSend: {
      control: false,
    },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  render: (args) => <InputCapsule key={args.defaultValue ?? ""} {...args} />,
  parameters: {
    docs: {
      description: {
        component:
          "기본 입력·여러 줄·큰 입력·보내는 중 상태를 담습니다. onSend는 원문을 전달하며 제출 후에도 초안을 유지합니다. sending은 기본적으로 제출과 입력을 막고, disableInputWhileSending=false이면 다음 초안을 적을 수 있습니다. sendDisabled는 제출만 막습니다. asTextarea는 큰 입력에도 textarea를 사용하며, textareaProps와 inputRef로 소비자의 조합·키보드·포커스 처리를 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof InputCapsule>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Single: Story = { name: "한 줄" };
export const Multiline: Story = {
  name: "여러 줄",
  args: {
    form: "multiline",
    defaultValue: "오늘 회의 내용 메모로 정리하고, 시간\n공유는 할 일에 넣어 줘",
  },
};
export const Large: Story = {
  name: "큰 입력",
  args: { form: "large", defaultValue: "좋아, 십 분만 쉬자." },
};
export const CompactSend: Story = {
  name: "기록 창 · 작은 보내기",
  args: { form: "multiline", sendSize: "compact" },
};
export const Sending: Story = { name: "보내는 중", args: { sending: true } };
export const DraftWhileSending: Story = {
  name: "보내는 중 · 다음 초안",
  args: {
    form: "large",
    asTextarea: true,
    sending: true,
    disableInputWhileSending: false,
    defaultValue: "다음 이야기",
    textareaProps: { maxLength: 2000 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const field = canvas.getByRole("textbox", { name: "메시지" });
    await user.tab();
    await expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, "다음 이야기");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(field, "새 초안");
    await expect(field).toHaveValue("다음 이야기\n새 초안");
    await expect(canvas.getByRole("button", { name: "보내는 중" })).toBeDisabled();
  },
};
export const Disabled: Story = { name: "입력 불가", args: { disabled: true } };
export const ResumeRequired: Story = {
  name: "지난 대화 · 재개 전",
  parameters: {
    docs: {
      description: {
        story:
          "재개 전에는 저장된 초안을 유지하고 입력과 보내기를 비활성화합니다. [Figma · Multiline Disabled](https://www.figma.com/design/aWNznF6uo5AlqF0YokiXZY?node-id=780-1943)",
      },
    },
  },
  args: {
    form: "multiline",
    sendSize: "compact",
    defaultValue: "",
    disabled: true,
    placeholder: "이어서 말하기를 눌러 대화를 재개하세요",
    label: "이어서 말하기",
    style: { width: 420 },
  },
};
