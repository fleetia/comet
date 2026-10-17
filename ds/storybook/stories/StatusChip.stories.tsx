import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusChip } from "@comet/ui";

const meta = {
  title: "UI/display/StatusChip",
  component: StatusChip,
  tags: ["autodocs"],
  args: { status: "saved" },
  argTypes: {
    status: {
      control: "select",
      options: ["saved", "reverted", "readOnly", "overdue", "selected"],
    },
    children: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "저장·되돌림·읽기 전용·기한 지남·선택 상태를 보여주는 텍스트 칩입니다. status별 기본 문구를 사용하거나 children으로 문구를 지정합니다. 클릭 동작은 없습니다.",
      },
    },
  },
} satisfies Meta<typeof StatusChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const States: Story = {
  name: "모든 상태",
  render: () => (
    <div className="comet-catalog-row">
      {(["saved", "reverted", "readOnly", "overdue", "selected"] as const).map((status) => (
        <StatusChip key={status} status={status} />
      ))}
    </div>
  ),
};
export const CustomText: Story = { name: "문구 지정", args: { children: "변경사항 저장됨" } };
