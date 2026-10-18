import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetBubble, WidgetRow, WidgetStackSummary } from "@comet/ui";

const items = [
  { id: "clock", icon: "clock", label: "3:24" },
  { id: "weather", icon: "cloud", label: "23° 구름 조금", active: true },
  { id: "todo", icon: "check", label: "할 일" },
] as const;

const meta = {
  title: "UI/widgets/WidgetBubble",
  component: WidgetBubble,
  tags: ["autodocs"],
  args: { placement: "below", tailOffset: 150, "aria-label": "날씨" },
  argTypes: {
    placement: { control: "inline-radio", options: ["below", "above"] },
    tailOffset: { control: { type: "number", min: 16, max: 360 } },
    children: { control: false },
    className: { control: false },
    style: { control: false },
  },
  render: (args) => {
    const bubble = (
      <WidgetBubble {...args} style={{ width: 370 }}>
        <WidgetRow kind="weather" title="23°C" description="구름 조금" layout="stack" />
      </WidgetBubble>
    );
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, padding: 12 }}>
        {args.placement === "above" && bubble}
        <WidgetStackSummary items={[...items]} />
        {args.placement !== "above" && bubble}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        component:
          "접어 둔 캡슐 막대에서 위젯 하나를 말풍선으로 띄웁니다. 내용은 자체 표면을 유지하고, 꼬리는 `tailOffset` 위치에서 캡슐을 가리킵니다. 꼬리 색은 `--comet-widget-bubble-fill`이 없으면 현재 유리 표면 색을 따릅니다. 위·아래 결정과 바깥 클릭 닫기는 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetBubble>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Below: Story = { name: "아래로" };
export const Above: Story = { name: "위로", args: { placement: "above" } };
