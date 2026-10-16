import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon } from "@comet/icon";
import { SettingsSummary, StatusChip } from "@comet/ui";
import { RecordSampleIcon, RecordSampleTile } from "./RecordsAssets";
const meta = {
  title: "UI/Lists/SettingsSummary",
  component: SettingsSummary,
  tags: ["autodocs"],
  args: {
    title: "대사·반응 편집",
    description: "54줄",
    variant: "plain",
    leading: <Icon name="memory" size={20} />,
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "badges",
        "avatarCount",
        "categoryCount",
        "choice",
        "status",
        "compactIcon",
        "textAvatar",
        "plain",
        "profile",
        "textCount",
        "inline",
      ],
    },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },

    leading: { control: false },
    trailing: { control: false },
    trailingAction: { control: false },
    badges: { control: false },
    onClick: { control: false, action: "열기" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "List/Settings Summary의 12개 구조를 variant와 selected로 표현합니다. 문구·개수·배지·이미지·끝 아이콘은 데이터 props이며 스크린별 컴포넌트를 복제하지 않습니다. 선택 항목에만 selected를 전달하고 링크/설정의 실제 열기 동작은 소비자 onClick이 소유합니다.",
      },
    },
  },
} satisfies Meta<typeof SettingsSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Plain: Story = {};
export const BadgeList: Story = {
  args: {
    variant: "badges",
    description: undefined,
    leading: (
      <RecordSampleTile>
        <Icon name="memory" size={20} />
      </RecordSampleTile>
    ),
    badges: ["인사 5줄", "자동 수다 13줄", "떠날 때 3줄", "돌아올 때 3줄"],
  },
};
export const AvatarAndCount: Story = {
  args: {
    variant: "avatarCount",
    count: "친구 8명",
    leading: (
      <RecordSampleTile>
        <Icon name="memory" size={20} />
      </RecordSampleTile>
    ),
  },
};
export const CategoryCount: Story = {
  args: {
    variant: "categoryCount",
    title: "대사·반응 편집",
    count: "인사 6줄",
    description: undefined,
    leading: undefined,
    trailing: <RecordSampleIcon name="summary-chevron" />,
  },
};
export const Choice: Story = {
  args: {
    variant: "choice",
    leading: (
      <RecordSampleTile size={36}>
        <Icon name="memory" size={18} />
      </RecordSampleTile>
    ),
    trailing: null,
  },
};
export const SelectedChoice: Story = { args: { ...Choice.args, selected: true, trailing: "✓" } };
export const Status: Story = {
  args: {
    variant: "status",
    leading: (
      <RecordSampleTile>
        <Icon name="memory" size={20} />
      </RecordSampleTile>
    ),
    count: <StatusChip>마지막 4시간 전</StatusChip>,
  },
};
export const CompactIcon: Story = {
  args: {
    variant: "compactIcon",
    title: "대사·반응 편집",
    description: "54줄",
    leading: <Icon name="todo" size={16} />,
  },
};
export const TextAvatar: Story = {
  args: { variant: "textAvatar", leading: <RecordSampleTile>여</RecordSampleTile> },
};
export const Profile: Story = {
  args: {
    variant: "profile",
    leading: (
      <RecordSampleTile>
        <Icon name="memory" size={20} />
      </RecordSampleTile>
    ),
  },
};
export const TextCount: Story = {
  args: { variant: "textCount", leading: undefined, count: "인사 6개씩 12줄" },
};
export const Inline: Story = {
  args: {
    variant: "inline",
    title: "오늘 할 일 3개",
    description: "간격은 1분",
    leading: (
      <RecordSampleTile size={28}>
        <Icon name="memory" size={14} />
      </RecordSampleTile>
    ),
  },
};
export const EmptyCount: Story = {
  args: { variant: "categoryCount", count: 0, leading: undefined, description: undefined },
};

export const TrailingAction: Story = {
  name: "열기 버튼 표시",
  args: {
    title: "AI 위젯 만들기",
    description: "9B보다 큰 로컬 모델이나 외부 API가 필요해요",
    leading: (
      <RecordSampleTile size={32}>
        <Icon name="sparkle" size={16} />
      </RecordSampleTile>
    ),
    trailingAction: { label: "열기", icon: "habit" },
  },
  parameters: {
    docs: {
      description: {
        story:
          "끝의 둥근 표시는 행과 같은 동작을 안내합니다. 전체 행이 하나의 버튼이며 내부에 별도 버튼이나 링크를 만들지 않습니다.",
      },
    },
  },
};
