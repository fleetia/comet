import { useState, type JSX, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  FormField,
  SelectableListRow,
  Surface,
  TextField,
} from "@fleetia/lagrange";
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
  function setSelection(value: AssetSelection): void {
    setLocalSelection(value);
    onSelectionChange?.(value);
  }
  const [addingExpression, setAddingExpression] = useState(false);
  const [newKey, setNewKey] = useState("");
  const keys = [
    DEFAULT_EXPRESSION,
    ...Object.keys(definition.expressions).filter((key) => key !== DEFAULT_EXPRESSION),
  ].filter((key) => key in definition.expressions);
  const expression = selection.id in definition.expressions ? selection.id : DEFAULT_EXPRESSION;
  const animation = definition.animation ?? EMPTY_ANIMATION;
  const portrait = spriteSource(character, expression);
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
  return (
    <section className={s.appearanceLayout} aria-label="표정과 동작 자산">
      <CharacterWorkPanel className={s.assetList} role="complementary" aria-label="캐릭터 자산">
        <div className={s.assetHeading}>
          <strong>표정 · {keys.length}개</strong>
          <Button
            variant="quiet"
            type="button"
            aria-label="표정 추가 열기"
            disabled={keys.length >= 24}
            onClick={() => setAddingExpression(!addingExpression)}
          >
            + 추가
          </Button>
        </div>
        <div hidden={!addingExpression} className={common.expressionAdd}>
          <TextField
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
          <Button variant="secondary" type="button" disabled={!canAdd} onClick={addExpression}>
            표정 추가
          </Button>
        </div>
        <div className={s.assetItems}>
          {keys.map((key) => (
            <SelectableListRow
              key={key}
              className={s.assetRow}
              selected={selection.type === "expression" && expression === key}
              aria-label={`${key} 표정 선택`}
              onClick={() => setSelection({ type: "expression", id: key })}
            >
              <span>{key}</span>
              <span className={s.assetMeta}>
                {key === DEFAULT_EXPRESSION ? "기본 표정" : definition.expressions[key]}
              </span>
            </SelectableListRow>
          ))}
        </div>
        <div className={s.assetHeading}>
          <strong>동작 · {animation.clips.length}개</strong>
          <Button
            variant="quiet"
            type="button"
            disabled={animation.clips.length >= MAX_ANIMATION_CLIPS}
            onClick={addMotion}
          >
            동작 추가
          </Button>
        </div>
        <div className={s.assetItems}>
          {animation.clips.map((clip) => (
            <SelectableListRow
              key={clip.id}
              className={s.assetRow}
              selected={selection.type === "motion" && selection.id === clip.id}
              aria-label={`${clip.name || "이름 없는 동작"} 동작 선택`}
              onClick={() => setSelection({ type: "motion", id: clip.id })}
            >
              <span>{clip.name || "이름 없는 동작"}</span>
              <span className={s.assetMeta}>
                {clip.frames.length}프레임 · {clip.fps}fps
              </span>
            </SelectableListRow>
          ))}
        </div>
        <p className={common.small}>표정 최대 24개 · 동작 최대 {MAX_ANIMATION_CLIPS}개</p>
      </CharacterWorkPanel>
      <CharacterWorkPanel className={s.inspector} footer={footer}>
        <div hidden={selection.type !== "expression"}>
          <div className={common.sectionHeader}>
            <h3 className={common.subheading}>{expression}</h3>
            <span className={common.small}>이미지 변경 즉시 반영</span>
          </div>
          <div className={s.expressionTop}>
            <Surface tone="accent" className={s.previewStage} aria-label={`${expression} 이미지`}>
              {portrait ? (
                <img
                  className={s.expressionImage}
                  src={portrait}
                  alt={`${expression} 표정 이미지`}
                />
              ) : (
                <span>{definition.expressions[expression]}</span>
              )}
              {!hasImage && (
                <span className={common.small}>
                  {character?.sprites[DEFAULT_EXPRESSION]
                    ? "이 표정의 이미지가 없어 평온 이미지로 표시해요."
                    : "텍스트 표정으로 표시해요."}
                </span>
              )}
            </Surface>
            <div className={s.expressionAttributes}>
              <div className={s.fields}>
                <FormField label="표정 이름">
                  <TextField value={expression} readOnly />
                </FormField>
                <FormField label="텍스트 표정">
                  <TextField
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
                  variant="quiet"
                  disabled={!hasImage || !onSprite}
                  aria-label={`${expression} 이미지 제거`}
                  onClick={() => onSprite?.(expression, true)}
                >
                  이미지 제거
                </Button>
                {expression !== DEFAULT_EXPRESSION ? (
                  <Button
                    type="button"
                    variant="quiet"
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
            <Surface tone="inset" padding="compact" className={s.expressionBindings}>
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
        </div>
        <div hidden={selection.type !== "motion"}>
          <AnimationEditor
            animation={definition.animation}
            character={character}
            expressions={keys}
            assets={assets}
            size={definition.spriteSize}
            visible={visible && selection.type === "motion"}
            selectedClipId={selection.type === "motion" ? selection.id : undefined}
            onSelectClip={(id) => setSelection({ type: "motion", id })}
            hideNavigation
            onChange={onAnimationChange}
            onChooseAssets={onChooseAssets}
          />
        </div>
        <div className={s.commonSettings}>
          <h4 className={common.subheading}>캐릭터 공통 표시</h4>
          <div className={s.fields}>
            <FormField label="본체 크기 · 32~512px">
              <TextField
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
            >
              텍스트 표정을 따로 움직이는 창으로 표시
            </Checkbox>
          </div>
          <Surface tone="inset">
            {(
              [
                ["idle", "평소"],
                ["speaking", "말하는 동안"],
                ["click", "클릭했을 때"],
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
        </div>
      </CharacterWorkPanel>
    </section>
  );
}
