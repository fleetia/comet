import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchInput } from "@comet/ui";

const meta = {
  title: "UI/controls/SearchInput",
  component: SearchInput,
  tags: ["autodocs"],
  args: {
    label: "기록 검색",
    placeholder: "검색어를 입력하세요",
    appearance: "outlined",
    disabled: false,
  },
  argTypes: {
    appearance: { control: "select", options: ["outlined", "plain", "large", "medium"] },
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Figma SearchField를 native input type=search로 제공합니다. outlined·plain·large·medium 표현을 지원합니다. 실제 검색 요청과 결과 목록은 소비자가 관리하며 이 컴포넌트는 입력만 담당합니다.",
      },
    },
  },
} satisfies Meta<typeof SearchInput>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "테두리" };
export const Plain: Story = { name: "간결한 표현", args: { appearance: "plain" } };
export const Large: Story = { name: "큰 크기", args: { appearance: "large" } };
export const Medium: Story = { name: "중간 크기", args: { appearance: "medium" } };
export const Filled: Story = { name: "입력됨", args: { defaultValue: "별" } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
