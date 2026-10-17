import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChoiceButton } from "@comet/ui";
const meta = {
  title: "UI/choices/ChoiceButton",
  component: ChoiceButton,
  tags: ["autodocs"],
  argTypes: {
    kind: {
      control: "select",
      options: ["compact", "hug", "fill", "list", "weekday", "weekday-compact", "period"],
    },
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
  },
  args: { children: "잠깐 찾아오는 친구", kind: "hug", selected: false },
  parameters: {
    docs: {
      description: {
        component:
          "문구는 children, 크기·배치는 kind, 선택은 selected로 관리합니다. 버튼 기본 type은 button이고 실제 선택 값과 저장은 소비자가 관리합니다.",
      },
    },
  },
} satisfies Meta<typeof ChoiceButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
export const Layouts: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="comet-catalog-row">
      <ChoiceButton kind="compact" selected>
        곡선
      </ChoiceButton>
      <ChoiceButton kind="fill" selected>
        잠깐 찾아오는 친구
      </ChoiceButton>
      <ChoiceButton kind="list" selected>
        건강 관리
      </ChoiceButton>
      <ChoiceButton kind="weekday" selected>
        월
      </ChoiceButton>
      <ChoiceButton kind="weekday-compact" selected>
        월
      </ChoiceButton>
      <ChoiceButton kind="period">주</ChoiceButton>
    </div>
  ),
};
