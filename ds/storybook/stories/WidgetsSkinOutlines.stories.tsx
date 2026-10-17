import type { Meta, StoryObj } from "@storybook/react-vite";
import { FREEFORM_SKIN_OUTLINES, type FreeformSkinName } from "@comet/ui";

const meta = {
  title: "UI/widgets/FreeformSkinOutlines",
  tags: ["autodocs"],
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        component:
          "FREEFORM_SKIN_OUTLINES는 자유 배치 위젯 그림(clock·weather·focus·music·envelope·memo)의 윤곽 경로와 위치입니다. 경로는 width×height 상자 안 left/top에 놓이고 자체 크기는 artWidth×artHeight입니다. 모양 편집에서 기본 그림을 점으로 바꿀 때 사용합니다.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end" }}>
      {(Object.keys(FREEFORM_SKIN_OUTLINES) as FreeformSkinName[]).map((name) => {
        const outline = FREEFORM_SKIN_OUTLINES[name];
        return (
          <figure key={name} style={{ margin: 0, display: "grid", gap: 6 }}>
            <svg
              width={outline.width}
              height={outline.height}
              viewBox={`0 0 ${outline.width} ${outline.height}`}
              overflow="visible"
              aria-hidden
            >
              <rect
                width={outline.width}
                height={outline.height}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="4 4"
              />
              <path
                d={outline.d}
                transform={`translate(${outline.left} ${outline.top})`}
                fill="currentColor"
                fillOpacity={0.15}
                stroke="currentColor"
              />
            </svg>
            <figcaption style={{ fontSize: 11 }}>
              {name} · {outline.width}×{outline.height}
            </figcaption>
          </figure>
        );
      })}
    </div>
  ),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Outlines: Story = { name: "그림 윤곽" };
