import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PREVIEW_SNAPSHOT } from "../../../apps/comet/src/previewSnapshot";
import { getWidgetPreview } from "../../../apps/comet/src/widgets/previewWidgets";
import { ToyTool } from "../../../apps/comet/src/widgets/ToyTools/ToyTools";

const interaction = getWidgetPreview().widgets.find((widget) => widget.kind === "interaction");
if (!interaction) {
  throw new Error("Interaction widget preview is missing");
}

const meta = {
  title: "App/widgets/Character interaction",
  component: ToyTool,
  tags: ["autodocs"],
  args: {
    widget: interaction,
    characters: PREVIEW_SNAPSHOT.characters,
    act: fn(async () => true),
  },
  decorators: [
    (Story) => (
      <div
        style={{
          boxSizing: "border-box",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          width: 330,
          height: 250,
          padding: "18px 20px 20px",
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ToyTool>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NativeWindow: Story = { name: "교감 · 330×250 창" };
