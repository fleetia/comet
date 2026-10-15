import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextSurfaceInput } from "@comet/ui";
const meta = {
  title: "UI/Inputs/TextSurfaceInput",
  component: TextSurfaceInput,
  tags: ["autodocs"],
  argTypes: {
    appearance: {
      control: "select",
      options: ["subtle", "plain-compact", "plain-fill", "filled", "compact-field"],
    },
    disabled: { control: "boolean" },
  },
  args: { appearance: "subtle", label: "내용", defaultValue: "어디에 썼나요?" },
  parameters: {
    docs: {
      description: {
        component: "native input의 라벨·설명·오류·ref를 유지하고 다섯 가지 표면 변형을 제공합니다.",
      },
    },
  },
} satisfies Meta<typeof TextSurfaceInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="comet-catalog">
      <TextSurfaceInput aria-label="옅은 입력" defaultValue="어디에 썼나요?" />
      <TextSurfaceInput
        appearance="plain-compact"
        aria-label="작은 입력"
        defaultValue="어디에 썼나요?"
      />
      <TextSurfaceInput
        appearance="plain-fill"
        aria-label="본문 입력"
        defaultValue="어디에 썼나요?"
      />
      <TextSurfaceInput appearance="filled" aria-label="채운 입력" defaultValue="어디에 썼나요?" />
      <TextSurfaceInput
        appearance="compact-field"
        aria-label="좁은 입력"
        defaultValue="어디에 썼나요?"
      />
    </div>
  ),
};
