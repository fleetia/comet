import type { JSX } from "react";
import { Button } from "@comet/ui";
import { ReactionEditor } from "../ReactionEditor/ReactionEditor";
import { Lines } from "./Lines";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import { CharacterLinePreview } from "./CharacterLinePreview";
import type { CharacterEditorState } from "./useCharacterEditor";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

export function CharacterDialoguePanel({ editor }: { editor: CharacterEditorState }): JSX.Element {
  const {
    definition,
    character,
    pending,
    definitionActions,
    dialogueType,
    canEditCombination,
    chooseDialogueType,
    expressionKeys,
    setPreviewSelection,
    change,
    previewSelection,
    animationAssets,
    tab,
    children,
    animationVersion,
  } = editor;
  return (
    <div className={e.dialoguePanel}>
      <div className={e.dialogueTypes} role="group" aria-label="대사 유형">
        {(
          [
            ["lines", "인사·수다·출입"],
            ["reactions", "사건 반응"],
            ["keyword", "키워드"],
            ["scenes", "조합"],
          ] as const
        ).map(([type, label]) => (
          <Button
            key={type}
            variant={dialogueType === type ? "primary" : "ghost"}
            aria-pressed={dialogueType === type}
            disabled={type === "scenes" && !canEditCombination}
            onClick={() => chooseDialogueType(type)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div hidden={dialogueType !== "lines"} className={e.authoredLayout}>
        <CharacterWorkPanel footer={definitionActions}>
          <fieldset className={s.fieldset} disabled={pending}>
            <Lines
              title="인사"
              lines={definition.greeting}
              limit={8}
              expressions={expressionKeys}
              clips={definition.animation?.clips ?? []}
              onSelect={(index) => setPreviewSelection({ group: "greeting", index })}
              onChange={(lines) => change("greeting", lines)}
            />
            <div className={e.sectionBoundary}>
              <Lines
                title="자동 수다"
                lines={definition.idleLines}
                limit={64}
                expressions={expressionKeys}
                clips={definition.animation?.clips ?? []}
                onSelect={(index) => setPreviewSelection({ group: "idleLines", index })}
                onChange={(lines) => change("idleLines", lines)}
              />
            </div>
            <div className={e.sectionBoundary}>
              <Lines
                title="떠남"
                lines={definition.departureLines}
                limit={8}
                expressions={expressionKeys}
                clips={definition.animation?.clips ?? []}
                onSelect={(index) => setPreviewSelection({ group: "departureLines", index })}
                onChange={(lines) => change("departureLines", lines)}
              />
            </div>
            <div className={e.sectionBoundary}>
              <Lines
                title="복귀"
                lines={definition.returnLines}
                limit={8}
                expressions={expressionKeys}
                clips={definition.animation?.clips ?? []}
                onSelect={(index) => setPreviewSelection({ group: "returnLines", index })}
                onChange={(lines) => change("returnLines", lines)}
              />
            </div>
            <p className={s.small}>
              말하는 간격·가끔 자리 비우기·AI 생성 허용은 자동 대화에서 정해요. 원문과 줄바꿈은
              그대로 저장해요.
            </p>
          </fieldset>
        </CharacterWorkPanel>
        <CharacterLinePreview
          definition={definition}
          character={character}
          line={
            definition[previewSelection.group][previewSelection.index] ?? definition.greeting[0]
          }
          assets={animationAssets}
          visible={tab === "dialogue" && dialogueType === "lines"}
        />
      </div>
      <div
        hidden={dialogueType !== "keyword" && dialogueType !== "scenes"}
        className={e.independentDialogue}
      >
        {children}
      </div>
      <CharacterWorkPanel hidden={dialogueType !== "reactions"} footer={definitionActions}>
        <fieldset className={s.fieldset} disabled={pending}>
          <ReactionEditor
            key={`${character?.id ?? "new"}:${animationVersion}`}
            definition={definition}
            character={character}
            assets={animationAssets}
            visible={tab === "dialogue" && dialogueType === "reactions"}
            onChange={(reactions) => change("reactions", reactions)}
          />
        </fieldset>
      </CharacterWorkPanel>
    </div>
  );
}
