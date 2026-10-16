import type { JSX } from "react";
import catalog from "@comet/ui/figma/components.json";
import controls from "@comet/ui/figma/controls-sources.json";
import records from "@comet/ui/figma/records-sources.json";
import planner from "@comet/ui/figma/planner-sources.json";
import conversation from "@comet/ui/figma/conversation-sources.json";
import inventory from "@comet/ui/figma/inventory.json";

const components = Array.from(
  [
    ...catalog.components,
    ...controls.components,
    ...records.components,
    ...planner.components,
    ...conversation.components,
  ].reduce((map, component) => {
    const sources = map.get(component.export) ?? [];
    map.set(component.export, [...sources, ...component.sources]);
    return map;
  }, new Map<string, { id: string; name: string }[]>()),
  ([name, sources]) => ({ export: name, sources }),
);

export function SourceInventory(): JSX.Element {
  const componentNodes = inventory.nodes.filter((node) => node.kind === "component");
  const assets = inventory.nodes.filter((node) => node.kind === "content-asset");
  return (
    <>
      <p>
        라이브러리 페이지의 컴포넌트·컴포넌트 세트 {inventory.nodes.length}개를 대조했습니다. 재사용
        UI 원본 {componentNodes.length}개는 아래 export에 연결됩니다. 샘플 이미지·아이콘·선택 문구{" "}
        {assets.length}개는 독립 UI API로 복제하지 않고 graphic, leading, children 같은 콘텐츠
        props로 받습니다.
      </p>
      <p>
        Input/Range Value는 투명한 내부 측정 레이어입니다. Flow/AI Widget Creation의 전체
        요청·가져오기·설치 흐름은 이 카탈로그 범위에서 제외하며, 진행 상태 표시만
        WidgetCreationProgress로 제공합니다. 전체 화면과 앱 상태·외부 서비스 연결은 포함하지
        않습니다.
      </p>
      <p>
        아직 라이브러리 노드와 대조하지 않은 코드 전용 export:{" "}
        {inventory.unsynced.flatMap((entry) => entry.exports).join(", ")}
      </p>
      <details>
        <summary>콘텐츠 자산과 연결 지점 {assets.length}개</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Figma 콘텐츠</th>
              <th scope="col">컴포넌트 props</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td>
                  <a
                    href={`https://www.figma.com/design/${inventory.fileKey}?node-id=${asset.id.replace(":", "-")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {asset.name}
                  </a>
                </td>
                <td>
                  {asset.export} · {asset.prop}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

export function SourceReferences(): JSX.Element {
  return (
    <table>
      <caption>UI export {components.length}개와 Figma 기준 노드</caption>
      <thead>
        <tr>
          <th scope="col">패키지 export</th>
          <th scope="col">Figma 원본</th>
        </tr>
      </thead>
      <tbody>
        {components.map((component) => (
          <tr key={component.export}>
            <th scope="row">
              <code>{component.export}</code>
            </th>
            <td>
              {component.sources.map((source, index) => (
                <span key={source.id}>
                  {index > 0 && " · "}
                  <a
                    href={`https://www.figma.com/design/${catalog.fileKey}?node-id=${source.id.replace(":", "-")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.name}
                  </a>
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
