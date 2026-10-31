import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, PlusIcon } from "@comet/icon";
import bodyPart from "../../ui/src/choices/assets/body-part.svg";
import cup from "../../ui/src/choices/assets/cup.svg";
import circle from "../../ui/src/choices/assets/widget-circle.svg";
import cloud from "../../ui/src/choices/assets/widget-cloud.svg";
import { ChoiceTile, SkinScene } from "@comet/ui";
import character from "../../ui/src/choices/assets/imgGroup1.svg";
import frame from "../../ui/src/choices/assets/imgGroup.svg";
import frameGraphic from "../../ui/src/choices/assets/imgOriginalGraphic.svg";
import widget from "../../ui/src/choices/assets/imgOriginalGraphic1.svg";
import check from "../../ui/src/choices/assets/imgSvg0131010110.svg";
const graphic = (
  <span
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 46,
      height: 46,
    }}
  >
    <img src={character} alt="" />
  </span>
);
const meta = {
  title: "UI/choices/ChoiceTile",
  component: ChoiceTile,
  tags: ["autodocs"],
  args: { label: "별꼬리", description: "함께 지내는 중", graphic, selected: false },
  argTypes: {
    kind: {
      control: "select",
      options: [
        "character",
        "element",
        "widget",
        "animation-frame",
        "expression",
        "expression-text",
        "body-part",
        "theme",
        "theme-add",
        "desktop-layout",
        "cup",
        "widget-preview",
        "anchor",
      ],
    },
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
    hideLabel: { control: "boolean" },
    graphic: { control: false },
    badge: { control: false },
    label: { control: "text" },
    description: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "이미지·텍스트는 props, 크기·배치는 kind, 선택 상태는 selected로 구분합니다. graphic은 소비자가 제공하며 캐릭터·표정·애니메이션 데이터를 패키지에 저장하지 않습니다. onClick으로 소비자가 선택을 관리합니다.",
      },
    },
  },
} satisfies Meta<typeof ChoiceTile>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};
export const Selected: Story = { args: { selected: true } };
export const Disabled: Story = { args: { disabled: true } };
export const Element: Story = {
  args: {
    kind: "element",
    label: "사각형",
    description: undefined,
    hideLabel: true,
    graphic: (
      <span
        style={{
          boxSizing: "border-box",
          width: 16,
          height: 16,
          border: "1.5px dashed var(--comet-color-ink-3)",
          borderRadius: 4,
        }}
      />
    ),
    selected: true,
  },
};
export const WidgetShape: Story = {
  args: {
    kind: "widget",
    label: "둥근 사각형",
    description: undefined,
    hideLabel: true,
    graphic: <img src={widget} alt="" />,
  },
};
export const AnimationFrame: Story = {
  args: {
    kind: "animation-frame",
    label: "3",
    description: undefined,
    selected: true,
    graphic: (
      <span
        style={{
          width: 52,
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img src={frameGraphic} alt="" />
      </span>
    ),
  },
};
export const Expression: Story = {
  args: {
    kind: "expression",
    label: "호기심",
    description: undefined,
    badge: "기본",
    graphic: (
      <span
        style={{
          width: 50,
          height: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img src={frame} alt="" />
      </span>
    ),
    selected: true,
  },
};
export const Anchor: Story = {
  args: {
    kind: "anchor",
    label: "왼쪽 위",
    hideLabel: true,
    description: undefined,
    graphic: null,
    selected: false,
  },
};
export const Themes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="comet-catalog-row">
      {(["play", "night", "paper"] as const).map((theme) => (
        <ChoiceTile
          key={theme}
          kind="theme"
          label={theme === "play" ? "놀이" : theme === "night" ? "밤하늘" : "따뜻한 종이"}
          description={
            theme === "play"
              ? "선명한 색과 굵은 테두리"
              : theme === "night"
                ? "은은한 밤과 낮의 유리창"
                : "종이 질감과 차분한 글씨"
          }
          selected={theme === "night"}
          graphic={
            theme === "night" ? (
              <span style={{ display: "flex", gap: 4, width: "100%" }}>
                <SkinScene theme="dark" />
                <SkinScene theme="light" />
              </span>
            ) : (
              <SkinScene theme={theme} />
            )
          }
          badge={theme === "night" ? <img src={check} alt="" /> : undefined}
        />
      ))}
      <ChoiceTile
        kind="theme-add"
        label="내 스킨"
        description="배경·말풍선·위젯 색을 직접 골라요"
        graphic={<PlusIcon size={18} />}
      />
    </div>
  ),
};
export const DesktopLayout: Story = {
  args: {
    kind: "desktop-layout",
    label: "스택",
    description: "한 줄로 쌓고\n누른 것만 펼쳐요",
    selected: true,
    graphic: (
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          justifyContent: "center",
          alignItems: "center",
          width: 143,
          height: 98,
          borderRadius: 9,
          background: "#0a0f26",
        }}
      >
        {[12, 30, 12, 12].map((height, i) => (
          <span
            key={i}
            style={{
              width: 54,
              height,
              borderRadius: 7,
              border: "1px solid rgba(166,178,230,.32)",
              background: "rgba(32,42,92,.96)",
            }}
          />
        ))}
      </span>
    ),
  },
};
function ControlledChoice(): JSX.Element {
  const [selected, setSelected] = useState(false);
  return (
    <ChoiceTile
      label="별꼬리"
      graphic={graphic}
      selected={selected}
      onClick={() => setSelected(!selected)}
      description={selected ? "선택했어요" : "눌러서 선택해요"}
    />
  );
}
export const Interactive: Story = {
  parameters: { controls: { disable: true } },
  render: () => <ControlledChoice />,
};

export const ExpressionText: Story = {
  args: { kind: "expression-text", label: "기쁨", graphic: "(^‿^)", description: undefined },
};
export const ExpressionTextSelected: Story = {
  args: {
    kind: "expression-text",
    label: "평온",
    graphic: "(・_・)",
    badge: "기본",
    description: undefined,
    selected: true,
  },
};
export const BodyPart: Story = {
  args: {
    kind: "body-part",
    label: "오른쪽 볼",
    graphic: <img src={bodyPart} alt="" />,
    description: undefined,
  },
};
export const Cup: Story = {
  args: { kind: "cup", label: "1번", graphic: <img src={cup} alt="" />, description: undefined },
};
export const WidgetPreview: Story = {
  args: {
    kind: "widget-preview",
    label: "할 일",
    graphic: (
      <span
        style={{
          boxSizing: "border-box",
          position: "relative",
          display: "flex",
          alignItems: "center",
          width: 98.4,
          height: 30,
          gap: 6,
          padding: "0 10px",
          borderRadius: 9,
          background: "var(--comet-color-glass-widget)",
          border: "1px solid var(--comet-color-glass-border-soft)",
          fontSize: 11.5,
          fontWeight: 400,
          boxShadow: "0 4px 12px -2px rgba(0,0,0,.14),inset 0 1px rgba(255,255,255,.09)",
        }}
      >
        <Icon name="todo" size={13} />3 / 5
      </span>
    ),
    description: undefined,
  },
};
export const CircleShape: Story = {
  args: {
    kind: "widget",
    label: "원형",
    hideLabel: true,
    graphic: <img src={circle} alt="" />,
    description: undefined,
  },
};
export const CloudShape: Story = {
  args: {
    kind: "widget",
    label: "구름",
    hideLabel: true,
    graphic: <img src={cloud} alt="" />,
    description: undefined,
  },
};
