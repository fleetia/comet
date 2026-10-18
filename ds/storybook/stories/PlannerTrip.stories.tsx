import type { Meta, StoryObj } from "@storybook/react-vite";
import { TripInfoRow } from "@comet/ui";
const meta = {
  title: "UI/planner/Trip Info Row",
  component: TripInfoRow,
  tags: ["autodocs"],
  argTypes: { title: { control: "text" }, detail: { control: "text" }, value: { control: "text" } },
  args: { title: "애월 숙소", detail: "10월 24일 (토) – 25일 (일) · 1박", value: "결제 완료" },
  parameters: {
    docs: {
      description: {
        component:
          "여행의 예약·일정·비용·사람 목록에 재사용하는 표시 행입니다. title/detail/value는 콘텐츠이며 예약 조회나 결제 동작을 포함하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof TripInfoRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "기본" };
export const Cost: Story = {
  name: "금액",
  args: { title: "교통비", detail: "렌터카 · 2일", value: "120,000원" },
};
export const Button: Story = {
  name: "누르는 행",
  args: {
    title: "오전 9:10  김포 → 제주",
    detail: "도착 오전 10:20 · 비행 1시간 10분",
    value: "이동",
    onClick: () => undefined,
  },
  parameters: {
    docs: { description: { story: "onClick을 주면 행 전체가 하나의 버튼이 되어 편집 창을 열 수 있습니다." } },
  },
};
