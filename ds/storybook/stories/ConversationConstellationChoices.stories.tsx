import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConstellationChoices } from "@comet/ui";
import { useEffect, useState } from "react";
function ChoiceDemo(args: React.ComponentProps<typeof ConstellationChoices>): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(args.selectedId);
  useEffect(() => {
    setSelectedId(args.selectedId);
  }, [args.selectedId]);
  return <ConstellationChoices {...args} selectedId={selectedId} onChoose={setSelectedId} />;
}
const meta = {
  title: "UI/Conversation/ConstellationChoices",
  component: ConstellationChoices,
  tags: ["autodocs"],
  args: {
    options: [
      { id: "river", label: "강가를 따라서" },
      { id: "market", label: "시장 골목으로" },
      { id: "rest", label: "오늘은 쉬자" },
    ] as const,
  },
  argTypes: {
    selectedId: {
      control: "select",
      options: ["river", "market", "rest"],
    },
    label: {
      control: "text",
    },
    options: {
      control: false,
    },
    onChoose: {
      control: false,
    },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "세 개의 선택지와 원본 SVG 연결선을 표시합니다. 선택값과 onChoose를 연결하면 선택된 항목과 흐려지는 항목이 함께 바뀝니다. 선택 결과를 저장하거나 다음 이야기로 진행하는 동작은 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof ConstellationChoices>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { name: "선택 전" };
export const Chosen: Story = { name: "선택 후", args: { selectedId: "market" } };
export const Interactive: Story = { name: "선택 연결", render: (args) => <ChoiceDemo {...args} /> };
