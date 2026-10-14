import { useId, useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icon, iconNames } from "@comet/icon";

function IconCatalog({ size }: { size: number }): JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const names = iconNames.filter((name) => name.includes(query.trim().toLocaleLowerCase()));

  return (
    <section aria-label="아이콘 목록">
      <h1>Figma 아이콘 {iconNames.length}개</h1>
      <p>아이콘은 currentColor를 사용합니다. 크기는 Controls에서 바꿀 수 있습니다.</p>
      <label htmlFor={searchId}>아이콘 이름 검색</label>
      <input
        id={searchId}
        type="search"
        className="comet-catalog-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="bell, calendar, star…"
      />
      <p role="status">{names.length}개 표시</p>
      <div className="comet-catalog-grid">
        {names.map((name) => (
          <figure key={name} className="comet-catalog-tile comet-catalog-icon">
            <Icon name={name} size={size} />
            <figcaption>
              <code>{name}</code>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: "Icon/Icon",
  component: Icon,
  tags: ["autodocs"],
  args: { name: "bell", size: 24, label: "알림" },
  argTypes: {
    name: {
      control: "select",
      options: iconNames,
      description: "Figma Icon/ 이름과 같은 소문자 식별자",
    },
    size: {
      control: { type: "range", min: 12, max: 64, step: 2 },
      description: "SVG의 표시 크기. 원본 viewBox는 유지합니다.",
    },
    label: {
      control: "text",
      description: "아이콘이 단독으로 의미를 전달할 때 제공하는 접근 가능한 이름",
    },
    color: { control: "color", description: "currentColor에 전달할 색상" },
  },
  parameters: {
    docs: {
      description: {
        component:
          '모든 아이콘은 Figma SVG의 경로와 선을 보존합니다. 정적 사용은 `BellIcon`처럼 개별 컴포넌트를 import하고, 동적인 선택은 `<Icon name="bell" />`을 사용하세요. 기본값은 장식용(`aria-hidden`)이며 단독 의미가 있으면 `label` 또는 `aria-label`을 제공합니다. IconButton 안에서는 버튼에 이름을 주고 아이콘은 장식용으로 유지하세요.',
      },
    },
  },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { name: "속성 조절" };
export const Decorative: Story = {
  name: "장식용 아이콘",
  args: { label: undefined },
  parameters: {
    docs: {
      description: {
        story:
          "텍스트 옆의 장식용 아이콘은 label 없이 사용합니다. 이 경우 스크린 리더가 같은 정보를 중복해서 읽지 않습니다.",
      },
    },
  },
};
export const AllIcons: Story = {
  name: "전체 아이콘",
  render: ({ size }) => <IconCatalog size={typeof size === "number" ? size : 24} />,
};
