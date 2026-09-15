import type { JSX } from "react";
import type { CharacterPack } from "../types";
import * as ui from "../styles.css";
import * as s from "./characters.css";

type Props = { pack: CharacterPack };

export function CharacterPackPreview({ pack }: Props): JSX.Element {
  return (
    <>
      <h3 className={s.subheading}>{pack.name}</h3>
      <p className={ui.quiet}>
        제작자: {pack.author || "미지정"} · 형식 버전 {pack.formatVersion}
      </p>
      <p className={s.preview}>
        배포 조건: {pack.license || "미지정 — 재배포 조건을 제작자에게 확인해 주세요."}
      </p>
      {pack.characters.map((character, index) => (
        <details key={`${character.sourceId}:${index}`} open>
          <summary>
            {character.name} · 버전 {character.version}
          </summary>
          <div className={s.preview}>
            <p>{character.description}</p>
            <p>성격과 말투: {character.personality}</p>
            <p>
              {Object.entries(character.expressions)
                .map(([key, value]) => `${key} [${value}]`)
                .join(" · ")}
            </p>
            <strong>인사</strong>
            {character.greeting.map((line, i) => (
              <p key={i}>
                [{line.expression}] {line.text}
              </p>
            ))}
            <strong>자동 수다</strong>
            {character.idleLines.map((line, i) => (
              <p key={i}>
                [{line.expression}] {line.text}
              </p>
            ))}
          </div>
        </details>
      ))}
      <details>
        <summary>
          조합 대사 {pack.pairScenes.length}개 · 키워드 대사 {pack.wordbook.length}개
        </summary>
        <div className={s.preview}>
          {pack.pairScenes.map((lines, index) => (
            <div key={index}>
              {lines.map((line, i) => (
                <p key={i}>
                  {line.persona.toUpperCase()} [{line.expression}] {line.text}
                </p>
              ))}
            </div>
          ))}
          {pack.wordbook.map((entry) => (
            <div key={entry.id}>
              <strong>
                {entry.title} · {entry.keywords.join(", ")}
              </strong>
              {entry.lines.map((line, i) => (
                <p key={i}>
                  {line.persona.toUpperCase()} [{line.expression}] {line.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
