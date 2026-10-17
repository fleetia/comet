import type { Meta, StoryObj } from "@storybook/react-vite";
import { MusicWidget } from "@comet/ui";

const meta = {
  title: "UI/widgets/MusicWidget",
  component: MusicWidget,
  tags: ["autodocs"],
  args: {
    title: "밤의 산책",
    artist: "별빛정원",
    album: "조용한 궤도",
    source: "Apple Music · 방금 읽음",
    labels: {
      heading: "음악 정보",
      progress: "음악 재생 위치",
      discuss: "이 곡 이야기하기",
      openPlayer: "Apple Music 열기",
      openPlayerAccessible: "음악 앱 열기",
      share: "친구들이 이 곡 이야기하기",
      shareDescription: "곡 제목과 아티스트만 대화에 써요",
      disclaimer: "곡 정보만 읽어요. 재생과 음량은 그 앱에서 바꿔요.",
      settings: "음악 정보 설정",
    },
    elapsed: "2:06",
    duration: "4:12",
    progress: 0.5,
    shareEnabled: true,
  },
  argTypes: {
    title: {
      control: "text",
    },
    artist: {
      control: "text",
    },
    album: { control: "text" },
    source: { control: "text" },
    labels: { control: "object" },
    showArtwork: { control: "boolean" },
    busy: { control: "boolean" },
    elapsed: {
      control: "text",
    },
    duration: {
      control: "text",
    },
    progress: {
      control: {
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
      },
    },
    shareEnabled: {
      control: "boolean",
    },
    artwork: {
      control: false,
    },
    onCollapse: {
      control: false,
    },
    onDiscuss: {
      control: false,
      action: "곡 대화 초안 열기",
    },
    onOpenPlayer: {
      control: false,
      action: "음악 앱 열기",
    },
    onSettings: { control: false, action: "음악 정보 설정 열기" },
    onShareChange: {
      control: false,
      action: "곡 대화 사용 변경",
    },
    className: {
      control: false,
    },
    style: {
      control: false,
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "앱이 제공한 제목·아티스트·앨범·출처와 읽기 전용 재생 위치를 표시합니다. 제목줄·버튼·안내 문구는 labels로 앱이 제공합니다. 앱 열기와 곡 대화 초안 콜백을 연결하며 재생 제어는 제공하지 않습니다. 콜백이 없거나 busy이면 해당 동작을 비활성화합니다.",
      },
    },
  },
} satisfies Meta<typeof MusicWidget>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { name: "음악 정보" };
export const SharingOff: Story = { name: "대화 연결 꺼짐", args: { shareEnabled: false } };
export const MissingAlbum: Story = { name: "앨범 정보 없음", args: { album: undefined } };
export const ArtworkHidden: Story = { name: "앨범 아트 숨김", args: { showArtwork: false } };
export const Busy: Story = { name: "요청 처리 중", args: { busy: true } };
