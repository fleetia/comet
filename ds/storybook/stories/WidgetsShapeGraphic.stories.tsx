import type { Meta, StoryObj } from "@storybook/react-vite";
import { SHAPE_GROUPS, WidgetShapeGraphic } from "@comet/ui";

const meta = {
  title: "UI/widgets/WidgetShapeGraphic",
  component: WidgetShapeGraphic,
  tags: ["autodocs"],
  args: { preset: "01" },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", ...SHAPE_GROUPS.flatMap((group) => group.items.map(([id]) => id))],
    },
    className: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "모양 선택지에 쓰는 24px 프리셋 그림입니다. default는 둥근 사각형(01)으로 표시합니다. SHAPE_GROUPS는 선택지의 묶음과 이름을 제공합니다.",
      },
    },
  },
} satisfies Meta<typeof WidgetShapeGraphic>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "프리셋 그림" };
export const Groups: Story = {
  name: "모양 묶음",
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      {SHAPE_GROUPS.map((group) => (
        <section key={group.label}>
          <strong>{group.label}</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {group.items.map(([id, name]) => (
              <figure key={id} style={{ display: "grid", justifyItems: "center", margin: 0 }}>
                <WidgetShapeGraphic preset={id} />
                <figcaption style={{ fontSize: 11 }}>{name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};
