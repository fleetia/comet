import { useState, type JSX } from "react";
import { Button, Select, Textarea } from "@comet/ui";
import { AuthoringTrial } from "./AuthoringTrial";
import { Lines } from "./Lines";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import { MAX_RELATIONSHIPS, relationshipTargetName } from "./characterEditorValues";
import type { CharacterEditorState } from "./useCharacterEditor";
import type { CharacterDefinition } from "../../types";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

export function CharacterRelationshipsPanel({
  editor,
}: {
  editor: CharacterEditorState;
}): JSX.Element {
  const {
    definition,
    character,
    installed,
    pending,
    definitionActions,
    change,
    relationshipTargets,
    reactionTarget,
    expressionKeys,
    trialActors,
    packDefinition,
    packBaseline,
    presentIds,
    trialAssets,
    animationAssets,
    tab,
    nextTarget,
  } = editor;
  const [dismissedTarget, setDismissedTarget] = useState<string | null>(null);
  const requestedRelationship =
    reactionTarget &&
    reactionTarget !== dismissedTarget &&
    definition.relationships.length < MAX_RELATIONSHIPS &&
    relationshipTargets.some((target) => target.id === reactionTarget) &&
    !definition.relationships.some(({ targetId }) => targetId === reactionTarget)
      ? { targetId: reactionTarget, description: "" }
      : null;
  const relationships: CharacterDefinition["relationships"] = requestedRelationship
    ? [...definition.relationships, requestedRelationship]
    : definition.relationships;
  return (
    <fieldset className={`${s.fieldset} ${e.relationshipWorkspace}`} disabled={pending}>
      <CharacterWorkPanel footer={definitionActions}>
        <section aria-label="다른 캐릭터와의 관계">
          <h3 className={s.subheading}>다른 캐릭터와의 관계</h3>
          <p className={`${s.small} ${e.relationshipIntro}`}>
            이 캐릭터가 상대를 어떻게 생각하고 대하는지 적어요. 상대의 관점은 상대 캐릭터에서 따로
            설정해요.
          </p>
          {relationships.map((relationship, index) => {
            const isRequested = index >= definition.relationships.length;
            function updateRelationship(value: typeof relationship): void {
              if (isRequested && value.targetId !== relationship.targetId) {
                setDismissedTarget(relationship.targetId);
              }
              change(
                "relationships",
                isRequested
                  ? [...definition.relationships, value]
                  : definition.relationships.map((current, i) => (i === index ? value : current)),
              );
            }
            const target = relationshipTargets.find(
              (member) => member.id === relationship.targetId,
            );
            const missingTarget = !relationshipTargets.some(
              (target) => target.id === relationship.targetId,
            );
            return (
              <div className={s.relationshipRow} key={index}>
                <div className={s.relationshipControls}>
                  <Select
                    fill
                    aria-label={`관계 ${index + 1} 대상`}
                    value={relationship.targetId}
                    onChange={(event) =>
                      updateRelationship({ ...relationship, targetId: event.target.value })
                    }
                  >
                    {missingTarget && (
                      <option value={relationship.targetId} disabled>
                        삭제된 캐릭터 · {relationship.targetId.slice(-8)}
                      </option>
                    )}
                    {relationshipTargets
                      .filter(
                        (target) =>
                          target.id === relationship.targetId ||
                          !definition.relationships.some(({ targetId }) => targetId === target.id),
                      )
                      .map((target) => (
                        <option key={target.id} value={target.id}>
                          {relationshipTargetName(target, installed)}
                        </option>
                      ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="small"
                    type="button"
                    aria-label={`관계 ${index + 1} 삭제`}
                    onClick={() => {
                      if (isRequested) {
                        setDismissedTarget(relationship.targetId);
                      } else {
                        if (relationship.targetId === reactionTarget) {
                          setDismissedTarget(relationship.targetId);
                        }
                        change(
                          "relationships",
                          definition.relationships.filter((_, i) => i !== index),
                        );
                      }
                    }}
                  >
                    삭제
                  </Button>
                </div>
                <Textarea
                  layout="flexible"
                  fill
                  aria-label={`관계 ${index + 1} 설명`}
                  className={s.textarea}
                  rows={2}
                  maxLength={500}
                  required
                  placeholder="예: 오래된 친구라 편하게 장난치지만 힘들어하면 먼저 챙겨요."
                  value={relationship.description}
                  onChange={(event) =>
                    updateRelationship({ ...relationship, description: event.target.value })
                  }
                />
                <details open={relationship.targetId === reactionTarget || undefined}>
                  <summary>이름을 언급했을 때의 등록 반응</summary>
                  <Lines
                    title={`관계 ${index + 1} 반응`}
                    lines={relationship.replyLines ?? []}
                    limit={8}
                    expressions={expressionKeys}
                    clips={definition.animation?.clips ?? []}
                    onSelect={() => {}}
                    allowEmpty
                    onChange={(replyLines) => updateRelationship({ ...relationship, replyLines })}
                  />
                </details>
                {character && target && (
                  <AuthoringTrial
                    title={`관계 ${index + 1} 시험`}
                    actors={
                      trialActors.some((member) => member.id === target.id)
                        ? trialActors
                        : [...trialActors, target]
                    }
                    subject={{
                      kind: "relation",
                      actorId: character.id,
                      targetId: target.id,
                    }}
                    packId={character.packId}
                    definition={packDefinition}
                    baseline={packBaseline}
                    presentIds={presentIds}
                    assets={{
                      ...trialAssets,
                      [character.id]: trialAssets[character.id] ?? animationAssets,
                    }}
                    visible={tab === "relationships" && !pending}
                  />
                )}
              </div>
            );
          })}
          <div className={e.relationshipAdd}>
            <Button
              variant="ghost"
              size="small"
              type="button"
              disabled={!nextTarget || definition.relationships.length >= MAX_RELATIONSHIPS}
              onClick={() => {
                if (nextTarget) {
                  change("relationships", [
                    ...definition.relationships,
                    { targetId: nextTarget.id, description: "" },
                  ]);
                }
              }}
            >
              관계 추가
            </Button>
          </div>
          {relationshipTargets.length === 0 && (
            <p className={s.small}>다른 캐릭터를 추가하면 관계를 설정할 수 있어요.</p>
          )}
        </section>
      </CharacterWorkPanel>
    </fieldset>
  );
}
