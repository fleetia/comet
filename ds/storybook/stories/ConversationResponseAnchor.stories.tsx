import { useState, type CSSProperties, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "@comet/ui";
import { tokens } from "@comet/token";
import { ConversationResponse } from "../../../apps/comet/src/components/Balloon/ConversationResponse";
import { PREVIEW_SNAPSHOT } from "../../../apps/comet/src/previewSnapshot";
import type { Snapshot } from "../../../apps/comet/src/types";

function ResponseAnchorExample(): JSX.Element {
  const [second, setSecond] = useState(false);
  const persona = second ? "builtin-b" : "builtin-a";
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona, mode: "input" },
    conversation: {
      session: {
        id: "anchor-preview",
        userId: "preview-user",
        participants: ["builtin-a", "builtin-b"],
        status: "active",
        title: "두 친구의 대답",
        createdAt: 1,
        updatedAt: 2,
        continuedFrom: null,
        draft: "",
      },
      messages: [
        {
          id: second ? "second-reply" : "first-reply",
          role: "assistant",
          persona,
          content: second ? "이번에는 오른쪽 친구가 대답해요." : "먼저 첫 번째 친구가 대답해요.",
          expression: "평온",
          createdAt: 2,
          status: "complete",
        },
      ],
      characterNames: { "first-reply": "첫 친구", "second-reply": "오른쪽 친구" },
      nextBefore: null,
    },
  };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={() => setSecond(false)}>첫 친구</Button>
        <Button onClick={() => setSecond(true)}>오른쪽 친구</Button>
      </div>
      <div
        style={{
          position: "relative",
          width: 560,
          height: 320,
          overflow: "hidden",
          background: tokens["color/glass-window"],
          borderRight: `2px solid ${tokens["color/ink-2"]}`,
        }}
      >
        <div
          style={
            {
              position: "absolute",
              top: 20,
              left: second ? 220 : 212,
              "--comet-response-tail-x": second ? "219px" : "47px",
            } as CSSProperties
          }
        >
          <ConversationResponse snapshot={snapshot} preview />
        </div>
        {["첫 친구", "오른쪽 친구"].map((name, index) => (
          <div
            key={name}
            style={{
              position: "absolute",
              left: index ? 400 : 220,
              top: 176,
              width: 136,
              height: 136,
              display: "grid",
              placeItems: "center",
              border: `1px dashed ${tokens["color/ink-2"]}`,
              borderRadius: 24,
              color: tokens["color/ink"],
            }}
          >
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "App/conversation/Response screen-edge anchor",
  component: ResponseAnchorExample,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "실제 앱의 ConversationResponse와 기존 DS Balloon을 사용합니다. 1364px 화면의 오른쪽 560px를 재현한 합성 배치이며, 네이티브 배치가 반환하는 47px/219px 꼬리 중심을 CSS 변수로 주입합니다. 네이티브 창 이동·DPI·위아래 방향의 실기 검증이 아니며, 기존 꼬리의 세로 모양은 유지합니다.",
      },
    },
  },
} satisfies Meta<typeof ResponseAnchorExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SpeakerSwitch: Story = {
  name: "화면 오른쪽 · 두 화자 전환",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const response = canvas.getByRole("region", { name: "캐릭터 대답" });
    const tailCenter = () =>
      getComputedStyle(response).getPropertyValue("--comet-response-tail-x").trim();
    await expect(tailCenter()).toBe("47px");
    await user.click(canvas.getByRole("button", { name: "오른쪽 친구" }));
    await expect(tailCenter()).toBe("219px");
    await expect(within(response).getByText("이번에는 오른쪽 친구가 대답해요.")).toBeVisible();
    await user.click(canvas.getByRole("button", { name: "첫 친구" }));
    await expect(tailCenter()).toBe("47px");
  },
};
