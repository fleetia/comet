import type { Meta, StoryObj } from "@storybook/react-vite";
import { Surface } from "@comet/ui";

const meta = {
  title: "UI/surface/Surface",
  component: Surface,
  tags: ["autodocs"],
  args: {
    variant: "window",
    open: true,
    children: (
      <>
        <h2>기록</h2>
        <p>내용을 담는 기본 표면입니다.</p>
      </>
    ),
    style: { padding: 24, maxWidth: 480 },
  },
  argTypes: {
    variant: { control: "radio", options: ["window", "sheet", "popover", "card"] },
    open: { control: "boolean", description: "열고 닫기 · 퇴장 완료 후 내용을 숨깁니다." },
    onExitComplete: { control: false, description: "퇴장 완료 후 소비자가 제거 시점을 받는 콜백" },
    children: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Figma의 창·시트·팝오버 표면을 제공하는 native div입니다. 배경·테두리·모서리·그림자와 280ms ease-out 진입을 제공하며 패딩과 크기는 소비자가 지정합니다. open=false는 입력을 즉시 막고 180ms 퇴장이 끝난 뒤 내용을 숨깁니다. 퇴장을 재생하려면 Surface를 바로 unmount하지 않고 open을 변경하세요. onExitComplete로 소비자가 제거 시점을 받을 수 있습니다. 모달 동작·배치·포커스 가두기·바깥 클릭 닫기는 소비자가 native dialog 등 적절한 동작 계층을 조합합니다.",
      },
    },
  },
} satisfies Meta<typeof Surface>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Window: Story = { name: "창" };
export const Sheet: Story = { name: "시트", args: { variant: "sheet" } };
export const Card: Story = { name: "본문 카드", args: { variant: "card" } };
export const Popover: Story = {
  name: "팝오버 표면",
  args: { variant: "popover", children: <p>짧은 안내를 담는 표면입니다.</p> },
};
