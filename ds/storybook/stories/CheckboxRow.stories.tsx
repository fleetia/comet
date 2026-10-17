import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckboxRow } from "@comet/ui";
const meta = {
  title: "UI/controls/CheckboxRow",
  component: CheckboxRow,
  tags: ["autodocs"],
  argTypes: {
    layout: {
      control: "select",
      options: ["compact", "export", "inline", "friend", "description", "control"],
    },
    disabled: { control: "boolean" },
    leading: { control: false },
    defaultChecked: { control: "boolean" },
  },
  args: { label: "다음에 이어갈 내용으로 남기기", layout: "compact" },
  parameters: {
    docs: {
      description: {
        component:
          "native Checkbox를 조합합니다. 체크 상태·name·disabled·설명 연결을 유지하며 사용자 데이터는 읽거나 저장하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof CheckboxRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Export: Story = {
  args: {
    layout: "export",
    label: "기억 86개",
    description: "선택한 기록만 공유해요.",
    defaultChecked: true,
  },
};
export const Description: Story = {
  args: {
    layout: "description",
    label: "자료 보내기에 동의해요",
    description: "선택한 내용만 전송해요.",
  },
};
export const Friend: Story = { args: { layout: "friend", label: "나디르", defaultChecked: true } };
