import type { Meta, StoryObj } from "@storybook/react-vite";
import { TitleInput } from "@comet/ui";
const meta = {
  title: "UI/controls/TitleInput",
  component: TitleInput,
  tags: ["autodocs"],
  argTypes: {
    disabled: { control: "boolean" },
  },
  args: { label: "제목", defaultValue: "작은 생각" },
  parameters: {
    docs: {
      description: {
        component:
          "제목용 타이포그래피를 적용한 native input입니다. 크기는 className·style로 조정할 수 있습니다.",
      },
    },
  },
} satisfies Meta<typeof TitleInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
