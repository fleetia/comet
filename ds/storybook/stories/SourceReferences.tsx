import type { JSX } from "react";
import catalog from "@comet/ui/figma/components.json";

export function SourceReferences(): JSX.Element {
  return (
    <table>
      <caption>UI {catalog.components.length}개와 Figma 기준 노드</caption>
      <thead>
        <tr>
          <th scope="col">패키지 export</th>
          <th scope="col">Figma 원본</th>
        </tr>
      </thead>
      <tbody>
        {catalog.components.map((component) => (
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
