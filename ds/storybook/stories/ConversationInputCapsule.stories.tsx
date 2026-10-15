import type { Meta, StoryObj } from "@storybook/react-vite";
import { InputCapsule } from "@comet/ui";

const meta = {
  title: "UI/Conversation/InputCapsule",
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
          "기본 입력·여러 줄·큰 입력·보내는 중 상태를 담습니다. onSend는 원문을 전달합니다. sending은 중복 제출과 입력을 막습니다. 여러 줄 입력은 native textarea와 보내기 버튼을 사용합니다.",
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
export const Sending: Story = { name: "보내는 중", args: { sending: true } };
export const Disabled: Story = { name: "입력 불가", args: { disabled: true } };
