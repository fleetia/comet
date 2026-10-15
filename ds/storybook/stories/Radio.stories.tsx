import { useId, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Radio } from "@comet/ui";

function RadioGroupExample(): JSX.Element {
  const name = useId();
  return (
    <fieldset className="comet-catalog-stack">
      <legend>알림 빈도</legend>
      <Radio name={name} value="quiet" label="조용하게" defaultChecked />
      <Radio name={name} value="normal" label="보통" />
      <Radio name={name} value="often" label="자주" />
      <Radio name={name} value="disabled" label="사용할 수 없는 옵션" disabled />
    </fieldset>
  );
}

const meta = {
  title: "UI/Inputs/Radio",
  component: Radio,
  tags: ["autodocs"],
  args: { label: "조용하게", value: "quiet", disabled: false },
  argTypes: {
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native radio입니다. 같은 name을 가진 선택지 중 하나를 고릅니다. 그룹 제목에는 fieldset·legend를 사용하고 방향키로 그룹 안에서 이동합니다. 각 독립 그룹에는 서로 다른 name을 지정하세요.",
      },
    },
  },
} satisfies Meta<typeof Radio>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Selected: Story = { name: "선택", args: { defaultChecked: true } };
export const Group: Story = { name: "그룹 · 방향키 이동", render: () => <RadioGroupExample /> };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
