import { useId, useState, type CSSProperties, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { themes, tokenNames, tokens, type Theme, type TokenPath } from "@comet/token";

const paths = Object.keys(tokenNames) as TokenPath[];
const categories = Array.from(new Set(paths.map((path) => path.split("/")[0])));

type TokenCatalogProps = {
  category: string;
  mode: "both" | Theme;
};

function TokenPreview({ path }: { path: TokenPath }): JSX.Element {
  let style: CSSProperties = {};
  const category = path.split("/")[0];

  if (category === "typography") {
    const property = path.split("/").at(-1);
    switch (property) {
      case "fontFamily":
        style = { fontFamily: `${tokens[path]}, sans-serif` };
        break;
      case "fontSize":
        style = { fontSize: tokens[path] };
        break;
      case "fontWeight":
        style = { fontWeight: tokens[path] };
        break;
      case "lineHeight":
        style = { lineHeight: tokens[path] };
        break;
    }
    return (
      <span style={style} aria-hidden="true">
        Aa · 별을 기록해요
      </span>
    );
  }

  switch (category) {
    case "color":
    case "palette":
      style = { background: tokens[path] };
      break;
    case "radius":
      style = { background: tokens["color/primary"], borderRadius: tokens[path] };
      break;
    case "spacing":
    case "size":
      style = { background: tokens["color/primary"], width: tokens[path], maxWidth: "100%" };
      break;
    case "opacity":
      style = { background: tokens["color/primary"], opacity: tokens[path] };
      break;
    default:
      return <span aria-hidden="true">Aa · 별을 기록해요</span>;
  }

  return <div className="comet-catalog-token-preview" style={style} aria-hidden="true" />;
}

const MODE_LABELS: Record<Theme, string> = {
  dark: "밤하늘 · Dark",
  light: "낮 · Light",
  paper: "따뜻한 종이 · Paper",
  play: "놀이 · Play",
};

function TokenCatalog({ category, mode }: TokenCatalogProps): JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = paths.filter((path) => {
    const matchesCategory = category === "all" || path.startsWith(`${category}/`);
    return (
      matchesCategory && `${path} ${tokenNames[path]}`.toLocaleLowerCase().includes(normalized)
    );
  });
  const modes = mode === "both" ? (Object.keys(themes) as Theme[]) : [mode];

  return (
    <section aria-label="디자인 토큰 목록">
      <h1>Figma 토큰 {paths.length}개</h1>
      <p>경로와 CSS 변수명을 검색할 수 있습니다. 값은 @comet/token의 원본에서 읽습니다.</p>
      <label htmlFor={searchId}>토큰 검색</label>
      <input
        id={searchId}
        type="search"
        className="comet-catalog-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="color/primary 또는 --comet-color-primary"
      />
      <p role="status">{filtered.length}개 표시</p>
      <table className="comet-catalog-table">
        <caption>토큰 경로, CSS 변수, 색상 모드별 값과 미리보기</caption>
        <thead>
          <tr>
            <th scope="col">토큰</th>
            {modes.map((theme) => (
              <th scope="col" key={theme}>
                {MODE_LABELS[theme]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((path) => (
            <tr key={path}>
              <th scope="row">
                <code>{path}</code>
                <br />
                <code>{tokenNames[path]}</code>
              </th>
              {modes.map((theme) => (
                <td key={theme}>
                  <div className="comet-catalog-mode" data-comet-theme={theme}>
                    <TokenPreview path={path} />
                    <code>{String(themes[theme][path])}</code>
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const meta = {
  title: "Foundations/Token",
  component: TokenCatalog,
  tags: ["autodocs"],
  args: { category: "all", mode: "both" },
  argTypes: {
    category: {
      control: "select",
      options: ["all", ...categories],
      description: "Figma 토큰 경로의 첫 분류",
    },
    mode: {
      control: "radio",
      options: ["both", ...Object.keys(themes)],
      description: "모든 모드를 나란히 보거나 한 모드만 보기",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Figma variable·text style에서 생성한 토큰 전체입니다. `tokens[path]`는 타입이 지정된 CSS var 참조이고 `themes.dark`·`themes.light`·`themes.paper`·`themes.play`는 모드별 원본 값입니다. paper(따뜻한 종이)와 play(놀이)는 한 모습뿐인 스킨입니다. `@comet/token/styles.css`를 한 번 불러오고 컨테이너에 `data-comet-theme="dark"`·`"light"`·`"paper"`·`"play"` 중 하나를 지정하세요. 표의 숫자는 원본 값이며 길이·시간의 CSS 단위는 배포 CSS가 처리합니다.',
      },
    },
  },
} satisfies Meta<typeof TokenCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllTokens: Story = { name: "전체 토큰" };
export const Colors: Story = { name: "색상 · 모든 모드", args: { category: "color" } };
export const Typography: Story = { name: "타이포그래피", args: { category: "typography" } };
export const Spacing: Story = { name: "간격", args: { category: "spacing" } };
export const Radius: Story = { name: "모서리", args: { category: "radius" } };
