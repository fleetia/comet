import type { Meta, StoryObj } from "@storybook/react-vite";
import { MultilineEditor } from "@comet/ui";
const meta = {
  title: "UI/controls/MultilineEditor",
  component: MultilineEditor,
  tags: ["autodocs"],
  args: { label: "본문", defaultValue: "오늘 떠오른 문장을 적어 두기.\n다음에 이어서 생각해요." },
  parameters: {
    docs: {
      description: {
        component:
          "원문 공백과 줄바꿈을 보존하는 native textarea입니다. 문서 저장이나 편집기 상태는 소비자가 관리합니다.",
      },
    },
  },
} satisfies Meta<typeof MultilineEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Disabled: Story = { args: { disabled: true } };
