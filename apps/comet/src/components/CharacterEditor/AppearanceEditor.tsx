import { useState, type JSX, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  ChoiceTile,
  FormField,
  SettingsSummary,
  Surface,
  TextInput,
} from "@comet/ui";
import { Icon } from "@comet/icon";
import { AppearancePreview } from "./AppearancePreview";
import * as appearance from "./appearance.css";
import type {
  AnimationAsset,
  AnimationBinding,
  CharacterAnimation,
  CharacterDefinition,
  InstalledCharacter,
} from "../../types";
import { AnimationEditor, BindingEditor } from "../AnimationEditor/AnimationEditor";
import { EMPTY_ANIMATION, MAX_ANIMATION_CLIPS } from "../AnimationEditor/helpers";
import { DEFAULT_EXPRESSION, spriteSource } from "../characterIdentity";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import { GestureMotionEditor } from "./GestureMotionEditor";
import * as common from "../characters.css";
import * as s from "./CharacterEditor.css";

type Props = {
  footer: ReactNode;
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  assets: AnimationAsset[];
  visible: boolean;
  onChange: (definition: CharacterDefinition) => void;
  onAnimationChange: (animation: CharacterAnimation, assets?: AnimationAsset[]) => void;
  onChooseAssets?: () => Promise<AnimationAsset[]>;
  onSprite?: (expression: string, remove: boolean) => void;
  selection?: AssetSelection;
  onSelectionChange?: (selection: AssetSelection) => void;
};
export type AssetSelection = { type: "expression" | "motion"; id: string };

export function AppearanceEditor({
  footer,
  definition,
  character,
  assets,
  visible,
  onChange,
  onAnimationChange,
  onChooseAssets,
  onSprite,
  selection: controlledSelection,
  onSelectionChange,
}: Props): JSX.Element {
  const [localSelection, setLocalSelection] = useState<AssetSelection>({
    type: "expression",
    id: DEFAULT_EXPRESSION,
  });
  const selection = controlledSelection ?? localSelection;
  const [animationOpen, setAnimationOpen] = useState(false);
  function setSelection(value: AssetSelection): void {
    if (value.type === "motion") setAnimationOpen(true);
    setLocalSelection(value);
    onSelectionChange?.(value);
  }
  const [addingExpression, setAddingExpression] = useState(false);
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [showAllMotions, setShowAllMotions] = useState(false);
  const [newKey, setNewKey] = useState("");
  const keys = [
    DEFAULT_EXPRESSION,
    ...Object.keys(definition.expressions).filter((key) => key !== DEFAULT_EXPRESSION),
  ].filter((key) => key in definition.expressions);
  const expression = selection.id in definition.expressions ? selection.id : DEFAULT_EXPRESSION;
  const animation = definition.animation ?? EMPTY_ANIMATION;
  const hasImage = Boolean(character?.sprites[expression]);
  const candidate = newKey.trim();
  const canAdd =
    candidate.length > 0 &&
    candidate.length <= 20 &&
    !candidate.startsWith("$") &&
    !(candidate in definition.expressions) &&
    keys.length < 24;
  function addExpression(): void {
    if (!canAdd) return;
    onChange({ ...definition, expressions: { ...definition.expressions, [candidate]: candidate } });
    setSelection({ type: "expression", id: candidate });
    setNewKey("");
    setAddingExpression(false);
  }
  function addMotion(): void {
    const id = crypto.randomUUID();
    onAnimationChange({
      ...animation,
      clips: [
        ...animation.clips,
        { id, name: `새 동작 ${animation.clips.length + 1}`, fps: 8, frames: [] },
      ],
    });
    setSelection({ type: "motion", id });
  }
  function setOverride(
    situation: "idle" | "speaking",
    binding: AnimationBinding | null | undefined,
  ): void {
    const override = { ...animation.overrides[expression] };
    if (binding === undefined) delete override[situation];
    else override[situation] = binding;
    const overrides = { ...animation.overrides, [expression]: override };
    if (Object.keys(override).length === 0) delete overrides[expression];
    onAnimationChange({ ...animation, overrides });
  }
  function removeExpression(): void {
    if (expression === DEFAULT_EXPRESSION) return;
    const expressions = { ...definition.expressions };
    delete expressions[expression];
    const overrides = { ...animation.overrides };
    delete overrides[expression];
    onChange({
      ...definition,
      expressions,
      ...(definition.animation ? { animation: { ...animation, overrides } } : {}),
    });
    setSelection({ type: "expression", id: DEFAULT_EXPRESSION });
  }
  if (interactionOpen) {
    return (
      <section className={appearance.interaction} aria-label="부위와 교감 동작 편집">
        <Button variant="ghost" onClick={() => setInteractionOpen(false)}>
          ‹ 모습·표정
        </Button>
        <GestureMotionEditor definition={definition} onChange={onChange} defaultOpen />
        {footer}
      </section>
    );
  }
  return (
    <section className={appearance.layout} aria-label="표정과 동작 자산">
      <aside className={appearance.aside}>
        <AppearancePreview
          definition={definition}
          character={character}
          assets={assets}
          selection={selection}
          onSelect={setSelection}
          visible={visible}
        />
        <p className={appearance.caption}>크기는 설정 › 바탕화면에서 모든 친구에게 같이 바꿔요.</p>
        <SettingsSummary
          title="부위와 교감 동작"
          description={`부위 ${definition.bodyRegions?.length ?? 0}개 · 교감 동작 ${definition.gestureMotions?.length ?? 0}개`}
          leading={<Icon name="paw" size={20} />}
          onClick={() => setInteractionOpen(true)}
          className={appearance.summary}
        />
      </aside>
      <CharacterWorkPanel className={appearance.inspector} footer={footer}>
        <div className={appearance.contentHeading}>
          <h3 className={appearance.sectionTitle}>표정 {keys.length}개</h3>
          <Button
            variant="ghost"
            type="button"
            aria-label="표정 추가 열기"
            disabled={keys.length >= 24}
            onClick={() => setAddingExpression(!addingExpression)}
          >
            ＋ 표정 추가
          </Button>
        </div>
        <div hidden={!addingExpression} className={common.expressionAdd}>
          <TextInput
            fill
            aria-label="새 표정 이름"
            placeholder="새 표정 이름"
            maxLength={20}
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                addExpression();
              }
            }}
          />
          <Button variant="ghost" disabled={!canAdd} onClick={addExpression}>
            표정 추가
          </Button>
        </div>
        <div className={appearance.expressionGrid}>
          {keys.map((key) => {
            const image = spriteSource(character, key);
            return (
              <ChoiceTile
                key={key}
                kind="expression"
                label={key}
                graphic={
                  image ? (
                    <img className={appearance.expressionThumbnail} src={image} alt="" />
                  ) : (
                    <span>{definition.expressions[key]}</span>
                  )
                }
                selected={selection.type === "expression" && expression === key}
                aria-label={`${key} 표정 선택`}
                className={appearance.expressionTile}
                badge={key === DEFAULT_EXPRESSION ? "기본" : undefined}
                onClick={() => setSelection({ type: "expression", id: key })}
              />
            );
          })}
        </div>
        <div className={appearance.contentHeading}>
          <h3 className={appearance.sectionTitle}>
            동작 {animation.clips.length} / {MAX_ANIMATION_CLIPS}
          </h3>
          {animation.clips.length > 8 && (
            <Button variant="ghost" onClick={() => setShowAllMotions((value) => !value)}>
              {showAllMotions ? "접기" : `${animation.clips.length}개 모두 보기`}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={animation.clips.length >= MAX_ANIMATION_CLIPS}
            onClick={addMotion}
          >
            ＋ 동작 추가
          </Button>
        </div>
        <div className={appearance.motionGrid}>
          {(showAllMotions ? animation.clips : animation.clips.slice(0, 8)).map((clip) => (
            <SettingsSummary
              key={clip.id}
              title={clip.name || "이름 없는 동작"}
              description={`${clip.frames.length}장 · 초당 ${clip.fps}`}
              leading={<Icon name="play" size={20} />}
              trailing={null}
              selected={selection.type === "motion" && selection.id === clip.id}
              className={appearance.motionTile}
              aria-label={`${clip.name || "이름 없는 동작"} 동작 선택`}
              onClick={() => setSelection({ type: "motion", id: clip.id })}
            />
          ))}
        </div>
        <details
          className={appearance.expressionInspector}
          hidden={selection.type !== "expression"}
        >
          <summary className={common.disclosureSummary}>선택한 표정 편집</summary>
          <div className={common.sectionHeader}>
            <h3 className={common.subheading}>{expression}</h3>
            <span className={common.small}>이미지 변경 즉시 반영</span>
          </div>
          <div className={s.expressionTop}>
            <div className={s.expressionAttributes}>
              <div className={s.fields}>
                <FormField label="표정 이름">
                  <TextInput fill value={expression} readOnly />
                </FormField>
                <FormField label="텍스트 표정">
                  <TextInput
                    fill
                    required
                    maxLength={40}
                    aria-label={`${expression} 텍스트 표정`}
                    value={definition.expressions[expression] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...definition,
                        expressions: {
                          ...definition.expressions,
                          [expression]: event.target.value,
                        },
                      })
                    }
                  />
                </FormField>
              </div>
              <div className={common.compactActions}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    !character || !character.definition.expressions[expression] || !onSprite
                  }
                  aria-label={`${expression} 이미지 선택`}
                  onClick={() => onSprite?.(expression, false)}
                >
                  {hasImage ? "이미지 변경" : "이미지 선택"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!hasImage || !onSprite}
                  aria-label={`${expression} 이미지 제거`}
                  onClick={() => onSprite?.(expression, true)}
                >
                  이미지 제거
                </Button>
                {expression !== DEFAULT_EXPRESSION ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`${expression} 표정 삭제`}
                    onClick={removeExpression}
                  >
                    표정 삭제
                  </Button>
                ) : (
                  <span className={common.small}>기본 평온은 삭제할 수 없어요.</span>
                )}
              </div>
              <p className={common.small}>SVG·PNG·GIF·WebP·JPEG · 최대 2 MiB</p>
              {!character && (
                <p className={common.small}>
                  캐릭터를 먼저 저장하면 표정마다 이미지를 넣을 수 있어요.
                </p>
              )}
            </div>
          </div>

          <div className={s.sectionBoundary}>
            <h4 className={common.subheading}>이 표정의 동작 연결</h4>
            <Surface variant="card" className={s.expressionBindings}>
              <BindingEditor
                label={`${expression} · 평소`}
                situation="idle"
                value={animation.overrides[expression]?.idle}
                clips={animation.clips}
                inherit
                onChange={(value) => setOverride("idle", value)}
              />
              <BindingEditor
                label={`${expression} · 말하는 동안`}
                situation="speaking"
                value={animation.overrides[expression]?.speaking}
                clips={animation.clips}
                inherit
                onChange={(value) => setOverride("speaking", value)}
              />
            </Surface>
          </div>
        </details>
        <div className={s.commonSettings}>
          <h4 className={common.subheading}>캐릭터 공통 표시</h4>
          <div className={s.fields}>
            <FormField label="본체 크기 · 32~512px">
              <TextInput
                fill
                type="number"
                min={32}
                max={512}
                step={8}
                aria-label="이미지 크기(px)"
                value={definition.spriteSize}
                onChange={(event) =>
                  onChange({ ...definition, spriteSize: Number(event.target.value) })
                }
              />
            </FormField>
            <Checkbox
              className={common.appearanceCheckbox}
              checked={definition.faceIcon}
              onChange={(event) => onChange({ ...definition, faceIcon: event.target.checked })}
              label="텍스트 표정을 따로 움직이는 창으로 표시"
            />
          </div>
          <Surface variant="card" className={s.cardPanel}>
            {(
              [
                ["idle", "평소"],
                ["speaking", "말하는 동안"],
                ["click", "클릭했을 때"],
                ["calendarOpen", "캘린더를 보고 있는 동안"],
                ["musicPlaying", "음악을 재생하는 동안"],
                ["moodHigh", "기분이 좋을 때"],
                ["moodLow", "기분이 가라앉았을 때"],
              ] as const
            ).map(([situation, label]) => (
              <BindingEditor
                key={situation}
                label={label}
                situation={situation}
                value={animation.bindings[situation]}
                clips={animation.clips}
                onChange={(value) =>
                  onAnimationChange({
                    ...animation,
                    bindings: { ...animation.bindings, [situation]: value },
                  })
                }
              />
            ))}
          </Surface>
          <p className={common.small}>
            반응 → 말하는 동안 → 캘린더 → 음악 → 평소 순서로 재생돼요. 캘린더·음악은 동작을 지정해야
            켜져요. 다이어리에서 월간·주간 보기를 연 동안, 음악 연결이 재생을 확인한 동안에만
            적용해요. 동작이 끝나거나 쉬는 동안에는 현재 표정으로 돌아와요.
          </p>
        </div>
        <details
          className={s.sectionBoundary}
          open={animationOpen}
          onToggle={(event) => setAnimationOpen(event.currentTarget.open)}
        >
          <summary className={common.disclosureSummary}>고급: 애니메이션 편집</summary>
          <AnimationEditor
            animation={definition.animation}
            character={character}
            expressions={keys}
            assets={assets}
            size={definition.spriteSize}
            visible={visible && animationOpen}
            selectedClipId={selection.type === "motion" ? selection.id : undefined}
            onSelectClip={(id) => setSelection({ type: "motion", id })}
            hideNavigation
            onChange={onAnimationChange}
            onChooseAssets={onChooseAssets}
          />
        </details>
      </CharacterWorkPanel>
    </section>
  );
}
