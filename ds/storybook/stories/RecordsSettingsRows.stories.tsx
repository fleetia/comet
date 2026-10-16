import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, iconNames } from "@comet/icon";
import { ManageListRow, Select, SettingControlRow, SettingsRow, Stepper, Switch } from "@comet/ui";
import { RecordsStack } from "./RecordsAssets";
const meta = {
  title: "UI/Lists/SettingsRows",
  component: SettingsRow,
  tags: ["autodocs"],
  args: { icon: "bell", children: "알림과 소리" },
  argTypes: {
    icon: { control: "select", options: iconNames },
    disabled: { control: "boolean" },
    onClick: { control: false, action: "열기" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "SettingsRow는 hover·pressed·focus·disabled의 native 버튼 상태를 제공합니다. SettingControlRow는 라벨·설명과 실제 Switch/Stepper를 조합합니다. ManageListRow는 이름 입력·색 선택 요청·지우기/추가 콜백만 제공하며 목록 순서·저장·삭제는 소비자가 관리합니다. dragHandle은 소비자가 접근 가능한 재정렬 UI를 전달하는 슬롯입니다.",
      },
    },
  },
} satisfies Meta<typeof SettingsRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
export const SwitchControl: Story = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [checked, setChecked] = useState(true);
    return (
      <SettingControlRow
        title="바탕화면에서 먼저 이야기하기"
        description="꺼도 간격과 자리 비우기 설정은 그대로예요"
        control={
          <Switch
            aria-label="바탕화면에서 먼저 이야기하기"
            checked={checked}
            onChange={(event) => setChecked(event.currentTarget.checked)}
          />
        }
      />
    );
  },
};
export const StepperControl: Story = {
  parameters: { controls: { disable: true } },
  render: () => {
    const [value, setValue] = useState(5);
    return (
      <SettingControlRow
        title="이야기 간격"
        description="1~60분 · 실제 간격은 조금씩 달라져요"
        control={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Stepper label="이야기 간격" value={value} min={1} max={60} onValueChange={setValue} />
            분
          </span>
        }
      />
    );
  },
};
export const SelectControl: Story = {
  name: "선택 필드 · 긴 라벨",
  parameters: { controls: { disable: true } },
  render: () => {
    const [value, setValue] = useState("system");
    return (
      <div style={{ width: 418, maxWidth: "100%" }}>
        <SettingControlRow
          title="알림 소리"
          description="선택 필드가 넓어져도 라벨은 읽을 수 있어요"
          control={
            <Select
              aria-label="알림 소리"
              value={value}
              style={{ width: "100%" }}
              onChange={(event) => setValue(event.currentTarget.value)}
            >
              <option value="system">시스템 설정을 따름</option>
              <option value="off">소리 없음</option>
            </Select>
          }
        />
      </div>
    );
  },
};
export const ManagedLists: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <RecordsStack>
      <ManagedListExample initialValue="할 일" color="#79afff" description="기본 목록 · 9개" />
      <ManagedListExample initialValue="장보기" color="#ff9f85" description="3개" />
      <ManagedListExample initialValue="여행" color="#77d9ca" isNew />
    </RecordsStack>
  ),
};

function ManagedListExample({
  initialValue,
  color,
  description,
  isNew = false,
}: {
  initialValue: string;
  color: string;
  description?: string;
  isNew?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [lastAction, setLastAction] = useState("");
  return (
    <div>
      <ManageListRow
        value={value}
        onValueChange={setValue}
        inputLabel={isNew ? "새 목록 이름" : `${initialValue} 목록 이름`}
        color={color}
        colorLabel={`${value} 색 바꾸기`}
        onColorClick={() => setLastAction("색 선택 요청")}
        description={description}
        dragHandle={isNew ? undefined : <Icon name="grip" size={16} />}
        variant={isNew ? "add" : "existing"}
        actionLabel={isNew ? "추가" : "지우기…"}
        onAction={() => setLastAction(isNew ? "추가 요청" : "삭제 요청")}
      />
      <span role="status">{lastAction}</span>
    </div>
  );
}
