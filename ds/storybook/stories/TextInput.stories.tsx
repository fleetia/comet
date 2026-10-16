import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextInput } from "@comet/ui";

const meta = {
  title: "UI/Inputs/TextInput",
  component: TextInput,
  tags: ["autodocs"],
  args: {
    label: "이름",
    placeholder: "이름을 입력하세요",
    description: "캐릭터가 불러줄 이름이에요.",
    disabled: false,
    required: false,
  },
  argTypes: {
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native input에 label, 설명, 오류를 연결합니다. error가 있으면 aria-invalid와 오류 설명을 제공합니다. label을 생략할 때는 aria-label이나 aria-labelledby를 지정하세요. 입력값은 defaultValue 또는 value와 onChange로 소비자가 관리합니다.",
      },
    },
  },
} satisfies Meta<typeof TextInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Filled: Story = { name: "입력됨", args: { defaultValue: "별꼬리" } };
export const Invalid: Story = {
  name: "오류",
  args: { error: "이름을 입력해 주세요.", required: true },
};
export const ReadOnly: Story = {
  name: "읽기 전용",
  args: { defaultValue: "별꼬리", readOnly: true },
};
export const Disabled: Story = { name: "비활성", args: { disabled: true } };

export const Time: Story = {
  name: "시간",
  args: {
    label: "조용한 시간 시작",
    type: "time",
    defaultValue: "22:00",
    placeholder: undefined,
    description: "오전·오후, 시·분과 선택 아이콘이 잘리지 않도록 고유 너비를 유지해요.",
    style: { width: "auto" },
  },
};
