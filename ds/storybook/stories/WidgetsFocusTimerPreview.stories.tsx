import type { Meta, StoryObj } from "@storybook/react-vite";
import { FocusTimerPreview } from "@comet/ui";

const meta = {
  title: "UI/Widgets/FocusTimerPreview",
  component: FocusTimerPreview,
  tags: ["autodocs"],
  args: { time: "25:00", presentation: "dial", description: "기본 집중 시간" },
  argTypes: { presentation: { control: "select", options: ["dial", "digits"] } },
  parameters: {
    docs: {
      description: {
        component:
          "집중 설정의 읽기 전용 미리보기입니다. 타이머 위젯과 같은 고리·숫자 표시를 재사용하며 시작·완료 동작은 제공하지 않습니다. [Figma 설정 미리보기](https://www.figma.com/design/aWNznF6uo5AlqF0YokiXZY?node-id=118-5996)와 [집중 타이머 원본](https://www.figma.com/design/aWNznF6uo5AlqF0YokiXZY?node-id=256-9195)에 대응합니다.",
      },
    },
  },
} satisfies Meta<typeof FocusTimerPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ring: Story = { name: "고리" };
export const Digits: Story = { name: "숫자만", args: { presentation: "digits" } };
