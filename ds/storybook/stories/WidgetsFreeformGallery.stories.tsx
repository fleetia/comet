import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ClockWidget,
  CounterWidget,
  EnvelopeFreeform,
  FocusTimerFreeform,
  MemoWidget,
  MusicFreeform,
  WeatherWidget,
} from "@comet/ui";

const meta = {
  title: "UI/widgets/FreeformGallery",
  tags: ["autodocs"],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component:
          "자유 배치 위젯의 원본 모양과 글자·이미지 배치를 함께 확인합니다. 각 표시는 독립 컴포넌트이며 실제 시간·음악·날씨를 읽지 않습니다.",
      },
    },
  },
  render: () => (
    <div
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 32, maxWidth: 1100 }}
    >
      <ClockWidget time="3:24" date="10월 12일 월" badge="D+42" />
      <FocusTimerFreeform label="집중 중" time="18:42" task="기획서 초안" />
      <MusicFreeform caption="지금 듣는 곡" title="밤의 산책" artist="별빛정원" elapsed="2:06" />
      <WeatherWidget temperature="23°" condition="구름 조금" location="서울" />
      <EnvelopeFreeform
        label="준비 봉투"
        title="가족 여행"
        date="10월 24일 (토)"
        completed={2}
        total={9}
      />
      <MemoWidget title="작은 생각">
        {"오늘 떠오른 문장을 적어 두기.\n다음에 이어서 생각해요."}
      </MemoWidget>
      <CounterWidget value={84} target={120} unit="단" />
      <CounterWidget value={84} target={120} unit="단" layout="editor" />
    </div>
  ),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Gallery: Story = { name: "자유 배치 위젯" };
