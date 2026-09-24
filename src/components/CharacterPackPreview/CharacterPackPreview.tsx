import type { JSX } from "react";
import type { CharacterPack } from "../../types";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";
import { BALLOON_SPRITE } from "../characterIdentity";

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
      {pack.sourceUrl && <p className={s.preview}>출처: {pack.sourceUrl}</p>}
      {pack.characters.map((character, index) => (
        <details key={`${character.sourceId}:${index}`} open>
          <summary className={s.disclosureSummary}>{character.name}</summary>
          <div className={s.preview}>
            <p>{character.description}</p>
            <p>성격과 말투: {character.personality}</p>
            {character.instructions && <p>지침: {character.instructions}</p>}
            {character.relationships.map((relationship) => {
              const target = pack.characters.find(
                (candidate) => candidate.sourceId === relationship.targetId,
              );
              return (
                <p key={relationship.targetId}>
                  {character.name} → {target?.name ?? relationship.targetId}:{" "}
                  {relationship.description}
                </p>
              );
            })}
            <p>
              {Object.entries(character.expressions)
                .map(([key, value]) => `${key} [${value}]`)
                .join(" · ")}
            </p>
            <p>
              표정 이미지{" "}
              {
                (pack.sprites ?? []).filter(
                  (sprite) =>
                    sprite.sourceId === character.sourceId && sprite.expression !== BALLOON_SPRITE,
                ).length
              }
              개
              {(pack.sprites ?? []).some(
                (sprite) =>
                  sprite.sourceId === character.sourceId && sprite.expression === BALLOON_SPRITE,
              )
                ? " · 말풍선 이미지 포함"
                : ""}
              {character.faceIcon ? " · 이미지 옆 텍스트 표정 표시" : ""}
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
        <summary className={s.disclosureSummary}>
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
