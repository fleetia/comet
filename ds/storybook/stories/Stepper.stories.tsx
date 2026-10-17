import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stepper } from "@comet/ui";

function ControlledStepper(): JSX.Element {
  const [value, setValue] = useState(3);
  return (
    <div className="comet-catalog-stack">
      <Stepper
        aria-label="하루 알림 횟수"
        value={value}
        onValueChange={setValue}
        min={1}
        max={10}
        unit="회"
      />
      <output aria-live="polite">하루 {value}회</output>
    </div>
  );
}

const meta = {
  title: "UI/controls/Stepper",
  component: Stepper,
  tags: ["autodocs"],
  args: {
    "aria-label": "알림 간격",
    defaultValue: 10,
    min: 0,
    max: 60,
    step: 5,
    unit: "분",
    disabled: false,
    decreaseLabel: "알림 간격 줄이기",
    increaseLabel: "알림 간격 늘리기",
  },
  argTypes: { unit: { control: "text" }, onValueChange: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          "숫자 입력과 감소·증가 버튼을 조합합니다. min·max·step을 적용하며 직접 숫자를 입력할 수 있습니다. 입력에는 aria-label 등으로 이름을 주고 버튼 이름은 decreaseLabel·increaseLabel로 구체화하세요. value를 사용하면 onValueChange도 연결합니다. 지우는 중의 빈 초안은 문자열 value와 onChange로 보존하며, onValueChange는 유효한 숫자와 증감 동작만 전달합니다.",
      },
    },
  },
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Compact: Story = {
  name: "집중 설정",
  args: { size: "compact", defaultValue: 25, min: 1, max: 1440, step: 1, unit: "분" },
};
export const CompactLargeValue: Story = {
  name: "집중 설정 최대값",
  args: { size: "compact", defaultValue: 1440, min: 1, max: 1440, step: 1 },
};
export const Minimum: Story = { name: "최솟값", args: { defaultValue: 0 } };
export const Maximum: Story = { name: "최댓값", args: { defaultValue: 60 } };
export const Decimal: Story = {
  name: "소수 단위",
  args: { "aria-label": "배율", defaultValue: 1.5, min: 0.5, max: 3, step: 0.25, unit: "배" },
};
export const Controlled: Story = { name: "값 연결", render: () => <ControlledStepper /> };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
