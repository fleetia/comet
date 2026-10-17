import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetadataChip } from "@comet/ui";
const meta = {
  title: "UI/display/MetadataChip",
  component: MetadataChip,
  tags: ["autodocs"],
  argTypes: {
    kind: { control: "select", options: ["list", "envelope", "repeat"] },
    children: { control: "text" },
    color: { control: "color" },
  },
  args: { children: "장보기", kind: "list" },
  parameters: {
    docs: {
      description: {
        component:
          "목록·봉투·반복의 표시 메타데이터입니다. 문구와 색상은 props로 전달하고 링크 동작이나 데이터를 읽지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof MetadataChip>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Envelope: Story = { args: { kind: "envelope", children: "가족 여행" } };
export const Repeat: Story = { args: { kind: "repeat", children: "매주 월" } };
