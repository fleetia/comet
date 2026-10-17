import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "@comet/ui";

const meta = {
  title: "UI/Inputs/Select",
  component: Select,
  tags: ["autodocs"],
  args: {
    label: "알림 시간",
    defaultValue: "10",
    description: "방향키로 옵션을 선택할 수 있습니다.",
    disabled: false,
    children: (
      <>
        <option value="0">정시에</option>
        <option value="5">5분 전</option>
        <option value="10">10분 전</option>
        <option value="30">30분 전</option>
      </>
    ),
  },
  argTypes: {
    children: { control: false },
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native select를 사용합니다. 옵션은 option·optgroup children으로 전달하고 defaultValue 또는 value·onChange로 선택을 관리합니다. 옵션 팝업과 키보드 조작은 운영체제와 브라우저의 기본 동작을 따릅니다.",
      },
    },
  },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Invalid: Story = { name: "오류", args: { error: "알림 시간을 확인해 주세요." } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
export const LongLabel: Story = {
  name: "긴 계정명 · 좁은 영역",
  args: {
    label: "ChatGPT 계정",
    defaultValue: "preview",
    description: "긴 옵션도 영역 안에 맞추고, 선택 목록에는 전체 이름을 유지합니다.",
    children: (
      <>
        <option value="preview">
          verylong.preview.account@privaterelay.example.com · preview-account-1234567890
        </option>
        <option value="another">다른 계정</option>
      </>
    ),
  },
  render: (args) => (
    <div
      style={{
        width: 260,
        maxWidth: "100%",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
      }}
    >
      <Select {...args} style={{ width: "100%" }} />
    </div>
  ),
};
