import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeatherWidget } from "@comet/ui";

const meta = {
  title: "UI/Widgets/WeatherWidget",
  component: WeatherWidget,
  tags: ["autodocs"],
  args: { temperature: "23°", condition: "구름 조금", location: "서울" },
  argTypes: {
    temperature: {
      control: "text",
    },
    condition: {
      control: "text",
    },
    location: {
      control: "text",
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
      description: { component: "원본 구름 모양의 날씨 표시입니다. 날씨 API를 호출하지 않습니다." },
    },
  },
} satisfies Meta<typeof WeatherWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
