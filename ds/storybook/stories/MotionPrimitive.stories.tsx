import type { Meta, StoryObj } from "@storybook/react-vite";
import { Motion } from "@comet/ui";

const meta = {
  title: "UI/motion/Motion",
  component: Motion,
  tags: ["autodocs"],
  args: { preset: "pop", open: true, staggerIndex: 0, children: "하던 일을 이어가요" },
  argTypes: {
    preset: { control: "radio", options: ["pop", "slide", "fade"] },
    open: { control: "boolean" },
    staggerIndex: { control: { type: "number", min: 0, step: 1 } },
    children: { control: "text" },
    onExitComplete: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "등장·퇴장을 제공하는 native div입니다. pop은 420ms ease-bounce, slide는 280ms ease-out, fade는 180ms ease-standard로 나타납니다. staggerIndex마다 40ms씩 늦게 시작합니다. open=false가 되면 즉시 inert·aria-hidden을 적용하고 180ms 퇴장 뒤 내용을 숨기며 onExitComplete를 호출합니다. 소비자가 이 콜백을 받기 전에 Motion을 제거하면 퇴장도 사라집니다. 모달·포커스 이동·배치는 소비자가 소유합니다.",
      },
    },
  },
} satisfies Meta<typeof Motion>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { name: "통통" };
export const Slide: Story = { name: "미끄러지기", args: { preset: "slide" } };
export const Fade: Story = { name: "흐려지기", args: { preset: "fade" } };
