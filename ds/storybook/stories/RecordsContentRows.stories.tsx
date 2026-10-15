import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ContentRow,
  GestureAssignment,
  ResourceLink,
  SceneSummary,
  StatusChip,
  StatusLink,
} from "@comet/ui";
import {
  RecordSampleGesture,
  RecordSampleIcon,
  RecordSampleTile,
  RecordsStack,
} from "./RecordsAssets";
const meta = {
  title: "UI/Lists/ContentRows",
  component: ContentRow,
  tags: ["autodocs"],
  args: {
    title: "10월 3일 대화",
    description: "“비 오는 날 걷는 거 좋아해. 빗소리가 좋아.”",
    variant: "memory",
    leading: <RecordSampleIcon name="memory-source" />,
    trailing: <RecordSampleIcon name="source-chevron" />,
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["memory", "story", "character", "visitor", "knowledge"],
    },
    disabled: { control: "boolean" },

    leading: { control: false },
    trailing: { control: false },
    badge: { control: false },
    onClick: { control: false, action: "열기" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "ContentRow는 기억 출처·이야기 요약·캐릭터 관계·방문 친구·지식 출처의 표시와 열기 동작을 제공합니다. ResourceLink는 native anchor, SceneSummary는 표시용 span, GestureAssignment는 선택 버튼입니다. 콘텐츠·배지·그림은 소비자가 전달하며 외부 연결이나 검색·반응 실행을 포함하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof ContentRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MemorySource: Story = {};
export const StorySummary: Story = {
  args: {
    variant: "story",
    title: "마친 뒤와 거절한 뒤",
    description: "다음 이야기 · 남길 조건 ‘별 조각을 찾았음’ · 함께한 경험 문장",
    leading: null,
    trailing: undefined,
  },
};
export const CharacterDialogue: Story = {
  args: {
    variant: "character",
    title: "조합 대사",
    description: "나디르와 함께 3개 · 둘이 함께 지낼 때 재생돼요",
    leading: (
      <RecordSampleTile>
        <RecordSampleIcon name="dialogue" />
      </RecordSampleTile>
    ),
  },
};
export const CharacterVisitor: Story = {
  args: {
    variant: "visitor",
    title: "달토끼",
    description: "달빛 산책 팩 · 초대나 등록한 이야기로만 들어와요",
    leading: (
      <RecordSampleTile>
        <RecordSampleIcon name="visitor" />
      </RecordSampleTile>
    ),
  },
};
export const KnowledgeAutomatic: Story = {
  args: {
    variant: "knowledge",
    title: "업무 노트",
    description: "Vault · 포함 2곳 · 제외 3곳",
    leading: (
      <RecordSampleTile size={32}>
        <RecordSampleIcon name="knowledge" />
      </RecordSampleTile>
    ),
    badge: <StatusChip status="saved">자동 정리</StatusChip>,
  },
};
export const KnowledgeSearchOnly: Story = {
  args: { ...KnowledgeAutomatic.args, badge: <StatusChip>검색 전용</StatusChip> },
};
export const WebResource: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <ResourceLink
      href="https://example.com/book"
      title="이번 책 소개"
      description="웹 링크 ↗"
      leading={<RecordSampleIcon name="resource" />}
    />
  ),
};
export const GestureRows: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <RecordsStack>
      <GestureAssignment
        title="볼 잡기"
        area="왼쪽 볼"
        expression={<RecordSampleGesture />}
        stages="시작 · 유지 · 끝"
        selected
      />
      <GestureAssignment
        title="볼 잡기"
        area="오른쪽 볼"
        expression={<RecordSampleGesture />}
        stages="시작 · 유지 · 끝"
      />
    </RecordsStack>
  ),
};
export const SceneCount: Story = {
  parameters: { controls: { disable: true } },
  render: () => <SceneSummary count="4줄">처음 인사</SceneSummary>,
};
export const StatusSettingsLink: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <StatusLink href="#conversation-settings" status="켜짐">
      대화 설정
    </StatusLink>
  ),
};
