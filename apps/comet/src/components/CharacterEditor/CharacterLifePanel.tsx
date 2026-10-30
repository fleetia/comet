import type { JSX, ReactNode } from "react";
import { FormField, Select, Textarea } from "@comet/ui";
import { AuthoringTrial } from "./AuthoringTrial";
import { Lines } from "./Lines";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import { CharacterLinePreview } from "./CharacterLinePreview";
import { entries } from "./characterEditorValues";
import type { CharacterEditorState } from "./useCharacterEditor";
import * as s from "../characters.css";

export function CharacterLifePanel({
  editor,
  children,
}: {
  editor: CharacterEditorState;
  children: ReactNode;
}): JSX.Element {
  const {
    definition,
    character,
    pending,
    definitionActions,
    isTogether,
    change,
    changeNpc,
    expressionKeys,
    setNpcPreviewIndex,
    npcPreviewIndex,
    animationAssets,
    tab,
    trialActors,
    packDefinition,
    packBaseline,
    presentIds,
    trialAssets,
  } = editor;
  return (
    <CharacterWorkPanel footer={definitionActions}>
      <fieldset className={s.fieldset} disabled={pending}>
        <section aria-label="캐릭터 등장">
          <h3 className={s.subheading}>역할과 등장</h3>
          <FormField label="바탕화면 역할">
            <Select
              fill
              aria-label="바탕화면 역할"
              value={definition.presenceRole ?? "resident"}
              onChange={(event) =>
                change("presenceRole", event.target.value === "npc" ? "npc" : "resident")
              }
            >
              <option value="resident">함께 지내는 친구</option>
              <option value="npc" disabled={isTogether}>
                찾아오는 친구
              </option>
            </Select>
          </FormField>
          <p className={s.small}>
            찾아오는 친구는 초대나 등록한 이야기에서만 등장해요. 함께 지내는 목록에서 뺀 뒤 역할을 바꿀 수
            있어요. 이름 언급만으로 초대하지 않아요.
          </p>
          {(definition.presenceRole === "npc" || definition.npc) && (
            <>
              <FormField label="명시적인 초대 표현 · 한 줄에 하나">
                <Textarea
                  layout="flexible"
                  fill
                  rows={2}
                  aria-label="찾아오는 친구 초대 표현"
                  value={definition.npc?.inviteKeywords.join("\n") ?? ""}
                  onChange={(event) => changeNpc({ inviteKeywords: entries(event.target.value) })}
                />
              </FormField>
              <FormField label="등장 키워드 · 한 줄에 하나">
                <Textarea
                  layout="flexible"
                  fill
                  rows={2}
                  aria-label="찾아오는 친구 등장 키워드"
                  value={definition.npc?.appearanceKeywords.join("\n") ?? ""}
                  onChange={(event) =>
                    changeNpc({ appearanceKeywords: entries(event.target.value) })
                  }
                />
              </FormField>
              <FormField label="필요한 이야기 조건 · 한 줄에 하나">
                <Textarea
                  layout="flexible"
                  fill
                  rows={2}
                  aria-label="찾아오는 친구 등장 조건"
                  value={definition.npc?.requiredFlags.join("\n") ?? ""}
                  onChange={(event) => changeNpc({ requiredFlags: entries(event.target.value) })}
                />
              </FormField>
              <FormField label="머무는 동안">
                <Select
                  fill
                  aria-label="찾아오는 친구 퇴장 정책"
                  value={definition.npc?.exitPolicy ?? "topicChange"}
                  onChange={(event) =>
                    changeNpc({
                      exitPolicy: event.target.value === "sceneEnd" ? "sceneEnd" : "topicChange",
                    })
                  }
                >
                  <option value="topicChange">화제가 바뀔 때까지</option>
                  <option value="sceneEnd">등록 장면이 끝날 때까지</option>
                </Select>
              </FormField>
              <Lines
                title="찾아오는 친구 입장"
                lines={definition.npc?.entryLines ?? []}
                limit={8}
                expressions={expressionKeys}
                clips={definition.animation?.clips ?? []}
                onSelect={setNpcPreviewIndex}
                allowEmpty
                onChange={(entryLines) => changeNpc({ entryLines })}
              />
              <CharacterLinePreview
                definition={definition}
                character={character}
                line={definition.npc?.entryLines[npcPreviewIndex]}
                assets={animationAssets}
                visible={tab === "life"}
              />
              {character && (
                <AuthoringTrial
                  title="찾아오는 친구 등장 시험"
                  actors={trialActors}
                  subject={{ kind: "npc", actorId: character.id }}
                  packId={character.packId}
                  definition={packDefinition}
                  baseline={packBaseline}
                  presentIds={presentIds}
                  assets={{
                    ...trialAssets,
                    [character.id]: trialAssets[character.id] ?? animationAssets,
                  }}
                  visible={tab === "life" && !pending}
                />
              )}
            </>
          )}
        </section>
      </fieldset>
      {children}
    </CharacterWorkPanel>
  );
}
