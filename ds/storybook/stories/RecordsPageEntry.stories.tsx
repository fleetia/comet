import type { Meta, StoryObj } from "@storybook/react-vite";
import { RecordPageEntry, RecordSourceLink, RecordTimelineRow } from "@comet/ui";
import { RecordsStack } from "./RecordsAssets";
const meta = {
  title: "UI/records/PageEntry",
  component: RecordPageEntry,
  tags: ["autodocs"],
  args: {
    date: "10월 12일",
    title: "다음 모임 책 후보: 『작은 아씨들』, 『페스트』",
    source: <RecordSourceLink href="#source">10월 12일 한 줄 기록에서</RecordSourceLink>,
  },
  argTypes: {
    rating: { control: { type: "number", min: 0, max: 5, step: 1 } },
    onMenu: { control: false, action: "기록 메뉴" },
    source: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Record/Page Entry·Record/Source Link·Record/Timeline Row입니다. 날짜·원문·출처 링크·별점은 표시 정보로 전달합니다. 메뉴 콜백은 별도 버튼으로 제공하므로 본문 링크와 중첩하지 않습니다. 타임라인의 종류는 표시 표식과 줄 구성을 구분하며 앱의 기록 상태를 변경하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof RecordPageEntry>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LinkedRecord: Story = {};
export const RatingWithReview: Story = {
  args: {
    date: "10월 5일",
    title: "『페스트』 다 읽음",
    source: null,
    rating: 4,
    review: "버티는 사람들의 이야기라 지금 읽기 좋았다.",
  },
};
export const Rating: Story = {
  args: { date: "9월 8일", title: "『어린 왕자』 다시 읽음", source: null, rating: 5 },
};
export const CollectionPage: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div style={{ width: "min(680px, 100%)" }}>
      <RecordPageEntry {...args} layout="fill" menuLabel="책 후보 기록 수정" />
      <RecordPageEntry
        layout="fill"
        divided
        date="10월 5일"
        title={
          <span style={{ whiteSpace: "pre-wrap" }}>
            {"  책에 남겨 둔 문장\n그다음 줄도 그대로  "}
          </span>
        }
        rating={0}
        review="0점으로 남긴 감상도 그대로 보여 주기"
        onMenu={args.onMenu}
        menuLabel="책 감상 기록 수정"
      />
      <RecordPageEntry
        layout="fill"
        divided
        date="날짜 없음"
        title="언젠가 읽고 싶은 책"
        onMenu={args.onMenu}
        menuLabel="읽고 싶은 책 기록 수정"
      />
    </div>
  ),
};
export const SourceLink: Story = {
  parameters: { controls: { disable: true } },
  render: () => <RecordSourceLink href="#source">10월 12일 한 줄 기록에서</RecordSourceLink>,
};
export const TimelineKinds: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <RecordsStack>
      <RecordTimelineRow onMenu={args.onMenu} timestamp="오전 7:50">
        필사하다 만난 문장: 천천히 가도 멈추지만 않으면 된다.
      </RecordTimelineRow>
      <RecordTimelineRow onMenu={args.onMenu} kind="task" timestamp="오전 9:10">
        메일 정리하기
      </RecordTimelineRow>
      <RecordTimelineRow
        onMenu={args.onMenu}
        kind="moved-task"
        timestamp="오전 11:40"
        detail="10월 14일 (수)로 옮김"
      >
        블로그 글 초안 쓰기
      </RecordTimelineRow>
      <RecordTimelineRow onMenu={args.onMenu} kind="overdue" timestamp="오후 1:30" detail="지남">
        책 모임 질문 두 개 적기
      </RecordTimelineRow>
      <RecordTimelineRow onMenu={args.onMenu} kind="event" timestamp="오후 2:00">
        책 모임 · 동네 서점 2층
      </RecordTimelineRow>
      <RecordTimelineRow
        kind="linked-memo"
        timestamp="오후 3:05"
        source={<RecordSourceLink href="#books">읽은 책에 붙음</RecordSourceLink>}
      >
        다음 모임 책 후보: 『작은 아씨들』, 『페스트』
      </RecordTimelineRow>
    </RecordsStack>
  ),
};
