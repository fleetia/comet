import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox, FormField, Select, Textarea, TextInput } from "@comet/ui";

const meta = {
  title: "UI/controls/FormField",
  component: FormField,
  tags: ["autodocs"],
  args: {
    label: "사용자 이름",
    description: "친구들이 부르는 이름이에요.",
    required: false,
    children: <TextInput fill placeholder="이름" />,
  },
  argTypes: {
    children: { control: false },
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  decorators: [(Story) => <div style={{ width: 360 }}>{Story()}</div>],
  parameters: {
    docs: {
      description: {
        component:
          "라벨·필수 표시·설명·오류를 컨트롤 하나에 연결하는 필드 묶음입니다. TextInput·Textarea·Select·Checkbox와 native input·textarea·select에는 id, required, aria-describedby, aria-invalid를 자동으로 연결합니다. 그 밖의 맞춤 컨트롤은 useFormField로 같은 상태를 받아 연결합니다. 오류는 role=alert로 알립니다.",
      },
    },
  },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Required: Story = {
  name: "필수와 오류",
  args: { required: true, error: "이름을 입력해 주세요." },
};
export const Controls: Story = {
  name: "컨트롤 조합",
  render: () => (
    <div className="comet-catalog-stack">
      <FormField label="알림 시간">
        <Select fill defaultValue="10">
          <option value="0">정시에</option>
          <option value="10">10분 전</option>
        </Select>
      </FormField>
      <FormField label="메모" description="줄바꿈을 그대로 남겨요.">
        <Textarea fill layout="flexible" rows={3} />
      </FormField>
      <FormField label="날짜">
        <TextInput fill type="date" defaultValue="2026-10-18" />
      </FormField>
      <FormField label="자동 대화">
        <Checkbox label="사용" />
      </FormField>
    </div>
  ),
};
