import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FocusAppUsage,
  FocusProgramPicker,
  FocusProgramRow,
  FocusRecordRow,
  FocusRecordsPanel,
  type FocusProgramOption,
} from "@comet/ui";

const options: FocusProgramOption[] = [
  { value: "none", label: "측정하지 않음" },
  { value: "code", label: "Visual Studio Code", icon: "code" },
  { value: "word", label: "Microsoft Word", icon: "page" },
  { value: "memo", label: "메모장", icon: "memo" },
];
function ProgramExample(): JSX.Element {
  const [value, setValue] = useState("word");
  return (
    <div className="comet-catalog-stack">
      <FocusProgramPicker
        label="측정할 프로그램"
        options={options}
        value={value}
        onValueChange={setValue}
      />
      <output aria-live="polite">
        선택: {options.find((option) => option.value === value)?.label}
      </output>
    </div>
  );
}
const meta = {
  title: "UI/Planner/Focus",
  component: FocusAppUsage,
  tags: ["autodocs"],
  argTypes: {
    state: { control: "select", options: ["unselected", "measuring", "idle", "finished"] },
    program: { control: "text" },
    duration: { control: "text" },
    statusLabel: { control: "text" },
    description: { control: "text" },
    chooseLabel: { control: "text" },
  },
  args: { state: "unselected", program: "Microsoft Word", duration: "6분" },
  parameters: {
    docs: {
      description: {
        component:
          "프로그램·측정 상태·집중 기록을 props로 전달합니다. 실제 전면 앱 감지·타이머·저장은 포함하지 않습니다. ProgramPicker는 native radio group이며 controlled value/onValueChange 또는 defaultValue로 사용합니다. RecordsPanel의 기록/노트 전환은 로컬 표시 상태이고 메모는 note.value/onChange로 연결합니다.",
      },
    },
  },
} satisfies Meta<typeof FocusAppUsage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "Props 조절" };
export const AppUsage: Story = {
  parameters: { controls: { disable: true } },
  name: "App Usage · 4상태",
  render: () => (
    <div className="comet-catalog-row">
      {(["unselected", "measuring", "idle", "finished"] as const).map((state) => (
        <FocusAppUsage key={state} state={state} program="Microsoft Word" duration="6분" />
      ))}
    </div>
  ),
};
export const ProgramRow: Story = {
  parameters: { controls: { disable: true } },
  name: "Program Row · 3상태",
  render: () => (
    <div style={{ width: 302 }}>
      <FocusProgramRow name="program-row" label="측정하지 않음" value="none" />
      <FocusProgramRow name="program-row" label="Visual Studio Code" value="code" icon="code" />
      <FocusProgramRow
        name="program-row"
        label="Microsoft Word"
        value="word"
        icon="page"
        defaultChecked
      />
    </div>
  ),
};
export const ProgramPicker: Story = {
  parameters: { controls: { disable: true } },
  name: "Program Picker · 선택",
  render: () => <ProgramExample />,
};
export const DisabledPicker: Story = {
  parameters: { controls: { disable: true } },
  name: "Program Picker · 비활성",
  render: () => (
    <FocusProgramPicker label="측정할 프로그램" options={options} defaultValue="word" disabled />
  ),
};
export const RecordRow: Story = {
  parameters: { controls: { disable: true } },
  name: "Record Row",
  render: () => (
    <div style={{ width: 512 }}>
      <FocusRecordRow
        time="오후 4:40 – 5:05"
        title="블로그 글감 정리"
        description="시간 종료"
        duration="25분"
      />
    </div>
  ),
};
const bars = [110, 145, 70, 160, 50, 0, 80].map((value, index) => ({
  id: String(index),
  label: ["월", "화", "수", "목", "금", "토", "일"][index],
  valueLabel: value === 0 ? "–" : `${Math.floor(value / 60)}시간 ${value % 60}분`,
  value,
  max: 180,
  current: index === 6,
}));
export const RecordsPanel: Story = {
  parameters: { controls: { disable: true } },
  name: "Records Panel · 기록",
  render: () => (
    <FocusRecordsPanel
      periodLabel="10월 5일 – 11일 · 지난주"
      total="10시간 15분"
      summary="23번 집중"
      bars={bars}
      recordsLabel="10월 11일 (일) · 1시간 20분"
      records={[
        {
          id: "blog",
          time: "오후 4:40 – 5:05",
          title: "블로그 글감 정리",
          description: "시간 종료",
          duration: "25분",
        },
        {
          id: "outline",
          time: "오후 2:10 – 2:35",
          title: "기획서 목차",
          description: "시간 종료 · 할 일 완료 · 메모 있음",
          duration: "25분",
        },
      ]}
      help="휴식과 일시정지는 빼고 실제로 집중한 시간이에요."
    />
  ),
};
export const NotesPanel: Story = {
  parameters: { controls: { disable: true } },
  name: "Records Panel · 노트",
  render: () => (
    <FocusRecordsPanel
      defaultTab="notes"
      notesHeader={<FocusAppUsage state="measuring" program="기획서 초안 다듬기" duration="18분" />}
      note={{
        defaultValue: "2장은 사례 하나만 남기기.\n결론에 다음 단계 표 넣기.",
        description: "메모 저장 동작은 소비자가 연결합니다.",
      }}
      notesContent={<p>연결한 메모를 표시하는 자리입니다.</p>}
    />
  ),
};
