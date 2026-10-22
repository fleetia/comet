import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConstellationChoices } from "@comet/ui";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
function ChoiceDemo(args: React.ComponentProps<typeof ConstellationChoices>): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(args.selectedId);
  useEffect(() => {
    setSelectedId(args.selectedId);
  }, [args.selectedId]);
  return <ConstellationChoices {...args} selectedId={selectedId} onChoose={setSelectedId} />;
}
const meta = {
  title: "UI/conversation/ConstellationChoices",
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
          "기본 3개 배치는 Figma 원본 SVG 연결선을 표시합니다. 선택지 개수나 원문 줄바꿈으로 배치가 바뀌면 실제 버튼 중심을 따라 연결선을 계산합니다. 선택값과 onChoose를 연결하면 선택된 항목과 흐려지는 항목이 함께 바뀝니다. 저장·다음 이야기 진행은 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof ConstellationChoices>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { name: "선택 전" };
export const Chosen: Story = { name: "선택 후", args: { selectedId: "market" } };
export const Interactive: Story = {
  name: "선택 연결",
  render: (args) => <ChoiceDemo {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const group = canvas.getByRole("group", { name: "이야기 선택" });
    await waitFor(() => expect(group.getBoundingClientRect().height).toBe(196));
    await expect(group.firstElementChild?.getBoundingClientRect().width).toBe(340);
    await expect(group.firstElementChild?.getBoundingClientRect().height).toBe(196);
    await user.tab();
    await user.tab();
    await expect(canvas.getByRole("button", { name: "시장 골목으로" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "시장 골목으로" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("button", { name: "강가를 따라서" })).toBeDisabled();
  },
};
export const TwoChoices: Story = {
  name: "두 갈래",
  args: {
    options: [
      { id: "listen", label: "천천히 말해도 괜찮아" },
      { id: "wait", label: "다음에 함께 이야기하자" },
    ],
  },
};
export const FourLongChoices: Story = {
  name: "네 갈래 · 긴 원문",
  args: {
    options: [
      { id: "river", label: "강가를 따라서  천천히 걸으며\n하고 싶었던 이야기를 들려줘" },
      { id: "market", label: "시장 골목으로 가자. 아직 문을 닫지 않은 가게가 있을지도 몰라." },
      { id: "rest", label: "오늘은 쉬자" },
      { id: "home", label: "  집으로 돌아가서 따뜻한 차를 마시며 계속 이야기하자.  " },
    ],
  },
  render: (args) => <ChoiceDemo {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const group = canvas.getByRole("group", { name: "이야기 선택" });
    const buttons = within(group).getAllByRole("button");
    await waitFor(() =>
      expect(group.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(5),
    );
    const bounds = group.getBoundingClientRect();
    for (let index = 0; index < buttons.length; index += 1) {
      const box = buttons[index].getBoundingClientRect();
      await expect(buttons[index].textContent).toBe(args.options[index].label);
      await expect(box.right).toBeLessThanOrEqual(bounds.right);
      if (index > 0)
        await expect(box.top).toBeGreaterThanOrEqual(
          buttons[index - 1].getBoundingClientRect().bottom + 20,
        );
      await user.tab();
    }
    await expect(buttons[3]).toHaveFocus();
    await user.keyboard("{Enter}");
    await expect(buttons[3]).toHaveAttribute("aria-pressed", "true");
  },
};
