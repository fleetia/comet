import type { Meta, StoryObj } from "@storybook/react-vite";
import { MusicFreeform } from "@comet/ui";

const meta = {
  title: "UI/Widgets/MusicFreeform",
  component: MusicFreeform,
  tags: ["autodocs"],
  args: { caption: "지금 듣는 곡", title: "밤의 산책", artist: "별빛정원", elapsed: "2:06" },
  argTypes: {
    caption: { control: "text" },
    title: {
      control: "text",
    },
    artist: {
      control: "text",
    },
    elapsed: {
      control: "text",
    },
    artwork: {
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
          "원본 티켓 모양의 음악 표시입니다. 앨범 이미지를 artwork 슬롯으로 전달할 수 있습니다.",
      },
    },
  },
} satisfies Meta<typeof MusicFreeform>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "자유 배치" };
