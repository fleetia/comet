import type { JSX } from "react";
import { FormField, SettingsSummary, Textarea, TextInput } from "@comet/ui";
import { Icon } from "@comet/icon";
import { FriendProfilePreview } from "./FriendOverview";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import type { CharacterEditorState } from "./useCharacterEditor";
import * as detail from "./friendDetail.css";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

export function CharacterProfilePanel({ editor }: { editor: CharacterEditorState }): JSX.Element {
  const {
    definition,
    character,
    pending,
    definitionActions,
    change,
    navigate,
    chooseDialogueType,
  } = editor;
  return (
    <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
      <div className={e.profileLayout}>
        <CharacterWorkPanel className={e.profileMain} footer={definitionActions}>
          <section aria-label="기본 정보">
            <h3 className={s.subheading}>기본 정보</h3>
            <div className={s.basicFields}>
              <FormField className={s.inlineField} label="이름" required>
                <TextInput
                  fill
                  required
                  aria-label="이름"
                  maxLength={40}
                  value={definition.name}
                  onChange={(event) => change("name", event.target.value)}
                />
              </FormField>
              <FormField className={s.inlineField} label="소개">
                <TextInput
                  fill
                  maxLength={500}
                  value={definition.description}
                  onChange={(event) => change("description", event.target.value)}
                />
              </FormField>
              <div className={e.sectionBoundary} style={{ gridColumn: "1 / -1" }}>
                <div className={e.contextHeading}>
                  <h3 className={s.subheading}>성격과 대화 지침</h3>
                  <span className={s.small}>생성 대화에 사용</span>
                </div>
              </div>
              <FormField className={s.personalityField} label="성격·말투">
                <Textarea
                  layout="flexible"
                  fill
                  aria-label="성격과 말투"
                  className={s.personalityInput}
                  rows={1}
                  maxLength={500}
                  value={definition.personality}
                  onChange={(event) => change("personality", event.target.value)}
                />
              </FormField>
              <FormField className={s.personalityField} label="지침">
                <Textarea
                  layout="flexible"
                  fill
                  aria-label="캐릭터 지침"
                  className={e.instructionsInput}
                  rows={3}
                  maxLength={2000}
                  placeholder="예: 먼저 짧게 답하고, 모르는 사실은 지어내지 않아요."
                  value={definition.instructions}
                  onChange={(event) => change("instructions", event.target.value)}
                />
              </FormField>
            </div>
            <p className={s.small}>
              등록한 인사와 수다 원문은 그대로 사용해요. 긴 지침과 관계는 중요한 내용부터 적어
              주세요.
            </p>
            <div className={e.sectionBoundary}>
              <SettingsSummary
                aria-label="대사·반응 편집"
                title="대사·반응 편집"
                className={e.authoredSummary}
                variant="badges"
                leading={
                  <span className={detail.iconTile}>
                    <Icon name="quote" size={20} />
                  </span>
                }
                badges={[
                  `인사 ${definition.greeting.length}줄`,
                  `자동 수다 ${definition.idleLines.length}줄`,
                  `떠날 때 ${definition.departureLines.length}줄`,
                  `돌아올 때 ${definition.returnLines.length}줄`,
                ]}
                onClick={() => {
                  navigate("dialogue");
                  chooseDialogueType("lines");
                }}
              />
            </div>
          </section>
        </CharacterWorkPanel>
        <FriendProfilePreview character={character} definition={definition} />
      </div>
    </fieldset>
  );
}
