import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { iconNames } from "@comet/icon";
import { MenuItem, Surface } from "@comet/ui";

function ActionsExample(): JSX.Element {
  const [message, setMessage] = useState("동작을 선택해 보세요.");
  return (
    <div className="comet-catalog-stack">
      <Surface variant="popover" style={{ padding: 8, maxWidth: 260 }}>
        <div role="group" aria-label="기록 동작">
          <MenuItem icon="copy" onClick={() => setMessage("복사 동작을 선택했어요.")}>
            복사
          </MenuItem>
          <MenuItem icon="edit" onClick={() => setMessage("수정 동작을 선택했어요.")}>
            수정
          </MenuItem>
          <MenuItem icon="remove" destructive onClick={() => setMessage("삭제 동작을 선택했어요.")}>
            삭제
          </MenuItem>
        </div>
      </Surface>
      <output aria-live="polite">{message}</output>
    </div>
  );
}

const meta = {
  title: "UI/Actions/MenuItem",
  component: MenuItem,
  tags: ["autodocs"],
  args: { children: "수정", icon: "edit", destructive: false, disabled: false },
  argTypes: {
    children: { control: "text" },
    icon: { control: "select", options: [undefined, ...iconNames] },
  },
  parameters: {
    docs: {
      description: {
        component:
          "목록형 동작을 나타내는 native 버튼입니다. 기본 키보드 조작은 Tab·Enter·Space입니다. destructive는 위험 동작의 시각적 표시를 바꿉니다. role=menu나 방향키 탐색을 자동 추가하지 않으므로 이 예제는 이름 있는 버튼 그룹으로 구성합니다. 팝업 열고 닫기와 실제 동작은 소비자가 연결하세요.",
      },
    },
  },
} satisfies Meta<typeof MenuItem>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "기본" };
export const Destructive: Story = {
  name: "위험 동작",
  args: { children: "삭제", icon: "remove", destructive: true },
};
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
export const InSurface: Story = { name: "동작 목록", render: () => <ActionsExample /> };
