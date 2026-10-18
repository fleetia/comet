import type { Meta, StoryObj } from "@storybook/react-vite";
import { WidgetHoverActions, WidgetRow, widgetHoverHost } from "@comet/ui";

const meta = {
  title: "UI/widgets/WidgetHoverActions",
  component: WidgetHoverActions,
  tags: ["autodocs"],
  args: {
    settings: { label: "날씨 설정", onClick: () => undefined },
    onCollapse: () => undefined,
    collapseLabel: "날씨 접기",
    handle: { label: "날씨 순서 바꾸기", draggable: true },
  },
  argTypes: {
    settings: { control: "object" },
    handle: { control: "object" },
    collapseLabel: { control: "text" },
    onCollapse: { control: false },
    className: { control: false },
    style: { control: false },
  },
  decorators: [
    (Story) => (
      <div className={widgetHoverHost} style={{ position: "relative", width: 370, marginTop: 16 }}>
        <WidgetRow kind="weather" title="21°C" description="맑음" layout="stack" />
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "모아두기 위젯 오른쪽 위에 떠 있는 동작 막대입니다. `widgetHoverHost`를 붙인 요소에 마우스를 올리거나 키보드 포커스가 들어오면 나타납니다. 설정(톱니)·접기·순서 바꾸기 핸들 중 전달한 것만 그리며, 핸들의 끌기와 화살표 키 처리는 소비자가 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetHoverActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Expanded: Story = { name: "펼친 위젯" };
export const HandleOnly: Story = {
  name: "핸들만",
  args: { settings: undefined, onCollapse: undefined },
};
