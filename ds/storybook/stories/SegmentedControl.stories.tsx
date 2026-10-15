import { useId, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Radio, SegmentedControl } from "@comet/ui";

const options = [
  { value: "day", label: "일" },
  { value: "week", label: "주" },
  { value: "month", label: "월" },
];

const unequalOptions = [
  { value: "day", label: "오늘" },
  { value: "week", label: "이번 주의 기록" },
  { value: "month", label: "이번 달" },
];

function ControlledSegments(): JSX.Element {
  const [value, setValue] = useState("week");
  return (
    <div className="comet-catalog-stack">
      <SegmentedControl
        label="보기 단위"
        options={options}
        value={value}
        onValueChange={setValue}
      />
      <output aria-live="polite">선택된 값: {value}</output>
    </div>
  );
}

function FormAssociatedSegments(): JSX.Element {
  const formId = useId();
  const name = `${formId}-period`;
  return (
    <div className="comet-catalog-stack">
      <form id={formId} className="comet-catalog-stack">
        <SegmentedControl
          label="보기 단위"
          name={name}
          options={options}
          defaultValue="week"
          size="display-mode"
        />
        <Button type="reset" variant="ghost">
          처음 선택으로
        </Button>
      </form>
      <Radio form={formId} name={name} value="all" label="전체 기간 · 폼 밖의 선택지" />
    </div>
  );
}

const meta = {
  title: "UI/Navigation/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
  args: { label: "보기 단위", options, defaultValue: "week", disabled: false },
  argTypes: {
    options: { control: false },
    label: { control: "text" },
    onValueChange: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "관련된 선택지 중 하나를 고르는 native radio 그룹입니다. 선택 배경은 280ms ease-out으로 가로 이동하며 새 선택지의 너비에 맞춰집니다. 값과 포커스는 즉시 바뀝니다. label로 그룹 이름을 제공하고 options의 value는 고유해야 합니다. Tab으로 그룹에 진입한 뒤 방향키로 이동합니다. 전체 disabled와 개별 option.disabled를 지원합니다. 패널 전환이 목적이면 Tabs를 사용하세요.",
      },
    },
  },
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본 · 방향키 이동" };
export const WithDisabledOption: Story = {
  name: "비활성 선택지",
  args: { options: options.map((option) => ({ ...option, disabled: option.value === "month" })) },
};
export const Disabled: Story = { name: "전체 비활성", args: { disabled: true } };
export const Controlled: Story = { name: "값 연결", render: () => <ControlledSegments /> };
export const SharedForm: Story = {
  name: "폼 밖의 선택지 · 초기화",
  render: () => <FormAssociatedSegments />,
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          "같은 name과 form을 가진 바깥 라디오도 하나의 선택 그룹으로 동작합니다. 바깥 선택지를 고르면 세그먼트 배경이 사라지고, 폼을 초기화하면 기본 선택으로 돌아옵니다.",
      },
    },
  },
};
export const UnequalLabels: Story = {
  name: "가로 이동 · 다른 너비",
  args: { options: unequalOptions },
};
export const Narrow: Story = {
  name: "좁은 영역 · 한 줄 이동",
  args: { options: unequalOptions },
  render: (args) => (
    <div style={{ width: 220, maxWidth: "100%" }}>
      <SegmentedControl {...args} />
    </div>
  ),
};
export const Rtl: Story = {
  name: "오른쪽부터 배치",
  args: { options: unequalOptions },
  render: (args) => (
    <div dir="rtl">
      <SegmentedControl {...args} />
    </div>
  ),
};
export const ReducedMotion: Story = {
  name: "움직임 줄이기 · 즉시 선택",
  args: { options: unequalOptions },
  render: (args) => (
    <div data-comet-motion="reduced">
      <SegmentedControl {...args} />
    </div>
  ),
};

export const Contained: Story = { name: "표면 포함", args: { appearance: "contained" } };

export const DisplayMode: Story = {
  name: "화면 모드 선택",
  args: {
    size: "display-mode",
    label: "화면 색상",
    defaultValue: "system",
    options: [
      { value: "system", label: "시스템 따라" },
      { value: "dark", label: "어둡게" },
      { value: "light", label: "밝게" },
    ],
  },
};
