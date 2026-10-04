import { useEffect, useId, useState, type JSX, type ReactNode } from "react";
import {
  Button,
  ActionBar,
  Surface,
  FormField,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  SettingsRow,
} from "@fleetia/lagrange";
import type {
  AnimationAsset,
  AnimationClip,
  CharacterAnimation,
  CharacterDefinition,
  CharacterLine,
  InstalledCharacter,
} from "../../types";
import { BALLOON_SPRITE, DEFAULT_EXPRESSION, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { balloonTextStyle, DEFAULT_BALLOON_STYLE } from "../balloonTypography";
import { AppearanceEditor, type AssetSelection } from "./AppearanceEditor";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import { CharacterLinePreview } from "./CharacterLinePreview";
import { useTypewriter } from "../../hooks/useTypewriter";
import * as e from "./CharacterEditor.css";
import { animationError } from "../AnimationEditor/helpers";
import { MotionSelect, motionError } from "../MotionSelect/MotionSelect";
import { ReactionEditor } from "../ReactionEditor/ReactionEditor";
import { reactionError } from "../ReactionEditor/reactionValidation";
import * as s from "../characters.css";

export const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
const MAX_RELATIONSHIPS = 32;

export type DialogueType = "lines" | "reactions" | "keyword" | "scenes";

type Props = {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  installed?: InstalledCharacter[];
  onChange: (definition: CharacterDefinition) => void;
  onSave: () => void;
  onCancel?: () => void;
  onSprite?: (expression: string, remove: boolean) => void;
  animationAssets?: AnimationAsset[];
  animationVersion?: number;
  onAnimationChange?: (animation: CharacterAnimation, assets?: AnimationAsset[]) => void;
  onChooseAnimationAssets?: () => Promise<AnimationAsset[]>;
  pending: boolean;
  dirty: boolean;
  children?: ReactNode;
  memoryContent?: ReactNode | ((onManage: () => void) => ReactNode);
  settingsContent?: ReactNode;
  memoryTabRequest?: number;
  isTogether?: boolean;
  dialogueType?: DialogueType;
  onDialogueTypeChange?: (type: DialogueType) => void;
  canEditCombination?: boolean;
  packName?: string;
  packContent?: ReactNode;
  headerActions?: ReactNode;
};

function Lines({
  title,
  lines,
  limit,
  expressions,
  clips,
  onChange,
  onSelect,
}: {
  title: string;
  lines: CharacterLine[];
  limit: number;
  expressions: string[];
  clips: AnimationClip[];
  onChange: (lines: CharacterLine[]) => void;
  onSelect: (index: number) => void;
}): JSX.Element {
  return (
    <section className={e.authoredGroup} aria-label={`${title} 대사`}>
      <div className={e.authoredHeading}>
        <h3 className={s.subheading}>
          {title} · {lines.length} / {limit}줄
        </h3>
        <Button
          variant="quiet"
          type="button"
          disabled={lines.length >= limit}
          onClick={() => onChange([...lines, { expression: DEFAULT_EXPRESSION, text: "" }])}
        >
          {title} 대사 추가
        </Button>
      </div>
      {lines.map((line, index) => (
        <div className={e.authoredRow} key={index}>
          <span className={s.small}>{index + 1}</span>
          <TextArea
            className={e.authoredText}
            aria-label={`${title} ${index + 1} 대사`}
            rows={1}
            maxLength={500}
            required
            value={line.text}
            onFocus={() => onSelect(index)}
            onChange={(event) => {
              onSelect(index);
              onChange(
                lines.map((value, i) =>
                  i === index ? { ...value, text: event.target.value } : value,
                ),
              );
            }}
          />
          <Select
            aria-label={`${title} ${index + 1} 표정`}
            value={line.expression}
            onChange={(event) =>
              onChange(
                lines.map((value, i) =>
                  i === index ? { ...value, expression: event.target.value } : value,
                ),
              )
            }
          >
            {[...new Set([...expressions, line.expression])].map((expression) => (
              <option key={expression}>{expression}</option>
            ))}
          </Select>
          <div className={e.authoredMotion}>
            <MotionSelect
              label={`${title} ${index + 1}`}
              value={line.motion}
              clips={clips}
              onChange={(motion) =>
                onChange(lines.map((value, i) => (i === index ? { ...value, motion } : value)))
              }
            />
          </div>
          <div className={s.compactActions}>
            <Button
              variant="quiet"
              type="button"
              disabled={index === 0}
              aria-label={`${title} ${index + 1} 위로`}
              onClick={() => {
                const next = [...lines];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
            >
              ↑
            </Button>
            <Button
              variant="quiet"
              type="button"
              disabled={index === lines.length - 1}
              aria-label={`${title} ${index + 1} 아래로`}
              onClick={() => {
                const next = [...lines];
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                onChange(next);
              }}
            >
              ↓
            </Button>
            <Button
              variant="quiet"
              type="button"
              disabled={lines.length <= 1}
              aria-label={`${title} ${index + 1} 삭제`}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              ×
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function BalloonAppearance({
  definition,
  character,
  onChange,
  onSprite,
  footer,
  visible,
}: Pick<Props, "definition" | "character" | "onSprite"> & {
  onChange: (patch: Pick<CharacterDefinition, "balloonStyle">) => void;
  footer: ReactNode;
  visible: boolean;
}): JSX.Element {
  const fontOptionsId = useId();
  const skin = spriteUrl(character, BALLOON_SPRITE);
  const { slice } = useImageSlice(skin);
  const skinned = skin && slice ? skinStyle(skin, slice) : undefined;
  const balloonStyle = {
    ...(definition.balloonStyle ?? DEFAULT_BALLOON_STYLE),
    textSpeed: definition.balloonStyle?.textSpeed ?? 0,
  };
  const [samples, setSamples] = useState<Record<string, { short: string; long: string }>>({});
  const id = character?.id ?? "new";
  const sample = samples[id] ?? {
    short: definition.greeting[0]?.text ?? "",
    long: definition.idleLines.map((line) => line.text).join("\n"),
  };
  const [playing, setPlaying] = useState(false);
  const [version, setVersion] = useState(0);
  const shown = useTypewriter(
    `${version}:${id}`,
    sample.short,
    playing && visible ? balloonStyle.textSpeed : 0,
    visible,
  );
  return (
    <section aria-label="말풍선 설정" className={e.balloonLayout}>
      <CharacterWorkPanel footer={footer}>
        <h3 className={s.subheading}>글자 표시</h3>
        <div className={e.balloonFontFields}>
          <FormField label="글자 크기 · 12~40px">
            <TextField
              type="number"
              min={12}
              max={40}
              step={1}
              aria-label="말풍선 글자 크기(px)"
              value={balloonStyle.fontSize}
              onChange={(event) =>
                onChange({
                  balloonStyle: { ...balloonStyle, fontSize: Number(event.target.value) },
                })
              }
            />
          </FormField>
          <FormField label="글자 색상">
            <div className={s.compactActions}>
              <TextField
                className={s.balloonColorInput}
                type="color"
                aria-label="말풍선 글자 색"
                value={balloonStyle.textColor ?? "#302a33"}
                onChange={(event) =>
                  onChange({ balloonStyle: { ...balloonStyle, textColor: event.target.value } })
                }
              />
              <Button
                variant="quiet"
                disabled={balloonStyle.textColor === null}
                onClick={() => onChange({ balloonStyle: { ...balloonStyle, textColor: null } })}
              >
                기본색
              </Button>
            </div>
          </FormField>
          <FormField label="설치된 폰트 이름">
            <TextField
              aria-label="말풍선 폰트"
              list={fontOptionsId}
              maxLength={100}
              placeholder="기본 글꼴"
              value={balloonStyle.fontFamily}
              onChange={(event) =>
                onChange({ balloonStyle: { ...balloonStyle, fontFamily: event.target.value } })
              }
            />
          </FormField>
        </div>
        <datalist id={fontOptionsId}>
          {["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Arial", "Georgia"].map(
            (font) => (
              <option key={font} value={font} />
            ),
          )}
        </datalist>
        <SettingsRow
          label="글자 출력 속도"
          description="초당 1~100글자, 0이면 대사를 즉시 표시해요."
        >
          <TextField
            type="number"
            min={0}
            max={100}
            step={1}
            aria-label="글자 출력 속도 (초당 글자 수)"
            value={balloonStyle.textSpeed}
            onChange={(event) =>
              onChange({ balloonStyle: { ...balloonStyle, textSpeed: Number(event.target.value) } })
            }
          />
        </SettingsRow>
        <p className={s.small}>폰트를 비워 두거나 설치된 이름이 아니면 기본 글꼴로 표시해요.</p>
        <section className={e.sectionBoundary}>
          <div className={e.authoredHeading}>
            <h3 className={s.subheading}>말풍선 이미지</h3>
            <span className={s.small}>선택·제거 즉시 반영</span>
          </div>
          <Surface tone="inset" padding="compact">
            <span className={s.spriteFrame} aria-label="말풍선 이미지">
              {skin ? <img className={s.spriteImage} src={skin} alt="말풍선 이미지" /> : "기본"}
            </span>
            <div className={s.compactActions}>
              <Button
                variant="primary"
                disabled={!character || !onSprite}
                onClick={() => onSprite?.(BALLOON_SPRITE, false)}
              >
                말풍선 이미지 선택
              </Button>
              {character?.sprites[BALLOON_SPRITE] && (
                <Button variant="quiet" onClick={() => onSprite?.(BALLOON_SPRITE, true)}>
                  말풍선 이미지 제거
                </Button>
              )}
            </div>
            <p className={s.small}>SVG·PNG·GIF·WebP·JPEG · 최대 2 MiB</p>
          </Surface>
          <p className={s.small}>가운데 1px 행·열을 늘리고 모서리 모양은 유지해요.</p>
        </section>
        <section className={e.sectionBoundary}>
          <h3 className={s.subheading}>미리보기 문장</h3>
          {(["short", "long"] as const).map((key) => (
            <FormField
              className={e.balloonSample}
              key={key}
              label={key === "short" ? "짧은 대사" : "긴 대사"}
            >
              <TextArea
                className={s.personalityInput}
                value={sample[key]}
                maxLength={500}
                onChange={(event) =>
                  setSamples((previous) => ({
                    ...previous,
                    [id]: { ...sample, [key]: event.target.value },
                  }))
                }
              />
            </FormField>
          ))}
        </section>
      </CharacterWorkPanel>
      <CharacterWorkPanel aria-label="말풍선 표시 미리보기">
        <div className={e.authoredHeading}>
          <h3 className={s.subheading}>말풍선 미리보기</h3>
          <Button
            variant="secondary"
            onClick={() => {
              setVersion((value) => value + 1);
              setPlaying(true);
            }}
          >
            출력 시험
          </Button>
        </div>
        <Surface tone="accent" className={e.balloonStage}>
          <div className={e.balloonSpecimen} style={skinned}>
            <strong>{definition.name || "새 캐릭터"}</strong>
            <p
              className={s.balloonTextPreview}
              aria-label="말풍선 글자 미리보기"
              style={balloonTextStyle(balloonStyle)}
            >
              {shown}
            </p>
          </div>
          <div className={e.balloonSpecimen} style={skinned}>
            <p className={s.balloonTextPreview} style={balloonTextStyle(balloonStyle)}>
              {sample.long}
            </p>
          </div>
        </Surface>
        <p className={s.small}>선택지 스토리는 바로 표시해요.</p>
      </CharacterWorkPanel>
    </section>
  );
}

export function CharacterEditor({
  definition,
  character,
  installed = [],
  onChange,
  onSave,
  onCancel,
  onSprite,
  animationAssets = [],
  animationVersion = 0,
  onAnimationChange,
  onChooseAnimationAssets,
  pending,
  dirty,
  children,
  memoryContent,
  settingsContent,
  memoryTabRequest = 0,
  isTogether = false,
  dialogueType: controlledDialogueType,
  onDialogueTypeChange,
  canEditCombination = true,
  packName,
  packContent,
  headerActions,
}: Props): JSX.Element {
  const [previewSelection, setPreviewSelection] = useState<{
    group: "greeting" | "idleLines" | "departureLines" | "returnLines";
    index: number;
  }>({ group: "greeting", index: 0 });
  const [assetSelections, setAssetSelections] = useState<Record<string, AssetSelection>>({});
  const [localDialogueType, setLocalDialogueType] = useState<DialogueType>("lines");
  const dialogueType = controlledDialogueType ?? localDialogueType;
  function chooseDialogueType(type: DialogueType): void {
    setLocalDialogueType(type);
    onDialogueTypeChange?.(type);
  }
  const [tab, setTab] = useState(memoryTabRequest > 0 ? "memory" : "profile");
  useEffect(() => {
    if (memoryTabRequest > 0) setTab("memory");
  }, [memoryTabRequest]);
  function change<K extends keyof CharacterDefinition>(
    key: K,
    value: CharacterDefinition[K],
  ): void {
    onChange({ ...definition, [key]: value });
  }
  const expressionKeys = Object.keys(definition.expressions);
  const portrait = spriteUrl(character, DEFAULT_EXPRESSION);
  const relationshipTargets = installed.filter((candidate) => candidate.id !== character?.id);
  const nextTarget = relationshipTargets.find(
    (candidate) => !definition.relationships.some(({ targetId }) => targetId === candidate.id),
  );
  function targetName(target: InstalledCharacter): string {
    const sameName = installed.filter(
      (candidate) => candidate.definition.name === target.definition.name,
    );
    if (sameName.length < 2) {
      return target.definition.name;
    }
    const suffix = target.id.slice(-8);
    const hasSharedSuffix = sameName.some(
      (candidate) => candidate.id !== target.id && candidate.id.endsWith(suffix),
    );
    return `${target.definition.name} · ${hasSharedSuffix ? target.id : suffix}`;
  }
  const validRelationships =
    definition.relationships.length <= MAX_RELATIONSHIPS &&
    new Set(definition.relationships.map(({ targetId }) => targetId)).size ===
      definition.relationships.length &&
    definition.relationships.every(
      ({ targetId, description }) =>
        targetId !== character?.id &&
        (relationshipTargets.some((target) => target.id === targetId) ||
          character?.definition.relationships.some((saved) => saved.targetId === targetId)) &&
        Boolean(description.trim()) &&
        Array.from(description).length <= 500,
    );
  const balloonStyle = definition.balloonStyle ?? DEFAULT_BALLOON_STYLE;
  const textSpeed = balloonStyle.textSpeed ?? 0;
  const validBalloonStyle =
    Number.isInteger(balloonStyle.fontSize) &&
    balloonStyle.fontSize >= 12 &&
    balloonStyle.fontSize <= 40 &&
    Number.isInteger(textSpeed) &&
    textSpeed >= 0 &&
    textSpeed <= 100 &&
    Array.from(balloonStyle.fontFamily).length <= 100 &&
    (balloonStyle.textColor === null || /^#[0-9a-f]{6}$/i.test(balloonStyle.textColor));
  const dialogueError =
    reactionError(definition) ??
    [
      ...definition.greeting,
      ...definition.idleLines,
      ...definition.departureLines,
      ...definition.returnLines,
    ]
      .map((line) => motionError(line.motion, definition.animation?.clips ?? []))
      .find(Boolean);
  const valid =
    Boolean(definition.name.trim()) &&
    Array.from(definition.instructions).length <= 2000 &&
    validRelationships &&
    validBalloonStyle &&
    !dialogueError &&
    !animationError(definition.animation, {
      ...character?.animationAssets,
      ...Object.fromEntries(animationAssets.map((asset) => [asset.assetId, asset])),
    }) &&
    DEFAULT_EXPRESSION in definition.expressions &&
    Number.isInteger(definition.spriteSize) &&
    definition.spriteSize >= 32 &&
    definition.spriteSize <= 512 &&
    expressionKeys.every((key) => definition.expressions[key]?.trim()) &&
    [
      definition.greeting,
      definition.idleLines,
      definition.departureLines,
      definition.returnLines,
    ].every((lines) => lines.length > 0 && lines.every((line) => line.text.trim())) &&
    definition.departureLines.length <= 8 &&
    definition.returnLines.length <= 8;
  const definitionActions = (
    <ActionBar
      className={s.saveBar}
      status={
        <span className={s.small}>
          {dialogueError
            ? `대사·반응: ${dialogueError}`
            : dirty
              ? "● 캐릭터 변경 · 키워드와 조합 대사는 별도 저장"
              : "키워드와 조합 대사는 별도 저장"}
        </span>
      }
    >
      <div className={s.compactActions}>
        {dirty && onCancel && (
          <Button size="compact" variant="secondary" disabled={pending} onClick={onCancel}>
            캐릭터 수정 취소
          </Button>
        )}
        <Button
          size="compact"
          variant="primary"
          disabled={pending || !valid || !dirty}
          onClick={onSave}
        >
          {pending ? "저장 중…" : "캐릭터 저장"}
        </Button>
      </div>
    </ActionBar>
  );
  return (
    <Tabs className={s.editor} value={tab} onValueChange={setTab}>
      <div className={s.editorHeader}>
        <div className={e.heroHeader}>
          <span className={s.characterFace} aria-hidden="true">
            {portrait ? (
              <img className={s.characterPortrait} src={portrait} alt="" />
            ) : (
              definition.expressions[DEFAULT_EXPRESSION]
            )}
          </span>
          <div className={e.heroIdentity}>
            <h2 className={e.title}>{definition.name || "새 캐릭터"}</h2>
            <p className={e.packCaption}>{packName ?? "새 캐릭터"}</p>
          </div>
          <div className={e.headerActions}>{headerActions}</div>
        </div>
        <TabList aria-label="캐릭터 편집" className={e.navigation}>
          <Tab value="profile">프로필</Tab>
          <Tab value="appearance">모습·표정</Tab>
          <Tab value="balloon">말풍선</Tab>
          <Tab value="dialogue">대사·반응</Tab>
          <span className={e.tabDivider} aria-hidden="true">
            |
          </span>
          <Tab value="memory">기억</Tab>
          <Tab value="settings">관리</Tab>
        </TabList>
      </div>
      <TabPanel value="profile" className={s.editorPanel}>
        <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
          <div className={e.profileLayout}>
            <CharacterWorkPanel className={e.profileMain} footer={definitionActions}>
              <section aria-label="기본 정보">
                <h3 className={s.subheading}>기본 정보</h3>
                <div className={s.basicFields}>
                  <FormField className={s.inlineField} label="이름">
                    <TextField
                      required
                      maxLength={40}
                      value={definition.name}
                      onChange={(event) => change("name", event.target.value)}
                    />
                  </FormField>
                  <FormField className={s.inlineField} label="소개">
                    <TextArea
                      className={s.personalityInput}
                      rows={1}
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
                    <TextArea
                      aria-label="성격과 말투"
                      className={s.personalityInput}
                      rows={1}
                      maxLength={500}
                      value={definition.personality}
                      onChange={(event) => change("personality", event.target.value)}
                    />
                  </FormField>
                  <FormField className={s.personalityField} label="지침">
                    <TextArea
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
                  <Surface tone="inset" padding="compact" className={e.authoredSummary}>
                    <div className={e.authoredHeading}>
                      <strong>작성한 대사</strong>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setTab("dialogue");
                          chooseDialogueType("lines");
                        }}
                      >
                        대사·반응 편집
                      </Button>
                    </div>
                    <div className={e.detailRow}>
                      <span className={s.small}>인사 · {definition.greeting.length}줄</span>
                      <span>{definition.greeting[0]?.text}</span>
                    </div>
                    <div className={e.detailRow}>
                      <span className={s.small}>자동 수다 · {definition.idleLines.length}줄</span>
                      <span>{definition.idleLines[0]?.text}</span>
                    </div>
                    <div className={e.detailRow}>
                      <span className={s.small}>떠남 · {definition.departureLines.length}줄</span>
                      <span>{definition.departureLines[0]?.text}</span>
                    </div>
                    <div className={e.detailRow}>
                      <span className={s.small}>복귀 · {definition.returnLines.length}줄</span>
                      <span>{definition.returnLines[0]?.text}</span>
                    </div>
                  </Surface>
                </div>
              </section>
            </CharacterWorkPanel>
            <div className={e.profileAside}>
              <CharacterWorkPanel className={e.relationshipPanel}>
                <section aria-label="다른 캐릭터와의 관계">
                  <h3 className={s.subheading}>다른 캐릭터와의 관계</h3>
                  <p className={s.small}>
                    이 캐릭터가 상대를 어떻게 생각하고 대하는지 적어요. 상대의 관점은 상대
                    캐릭터에서 따로 설정해요.
                  </p>
                  {definition.relationships.map((relationship, index) => {
                    const missingTarget = !relationshipTargets.some(
                      (target) => target.id === relationship.targetId,
                    );
                    return (
                      <div className={s.relationshipRow} key={index}>
                        <div className={s.relationshipControls}>
                          <Select
                            aria-label={`관계 ${index + 1} 대상`}
                            value={relationship.targetId}
                            onChange={(event) =>
                              change(
                                "relationships",
                                definition.relationships.map((value, i) =>
                                  i === index ? { ...value, targetId: event.target.value } : value,
                                ),
                              )
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
                                  !definition.relationships.some(
                                    ({ targetId }) => targetId === target.id,
                                  ),
                              )
                              .map((target) => (
                                <option key={target.id} value={target.id}>
                                  {targetName(target)}
                                </option>
                              ))}
                          </Select>
                          <Button
                            variant="quiet"
                            size="compact"
                            type="button"
                            aria-label={`관계 ${index + 1} 삭제`}
                            onClick={() =>
                              change(
                                "relationships",
                                definition.relationships.filter((_, i) => i !== index),
                              )
                            }
                          >
                            삭제
                          </Button>
                        </div>
                        <TextArea
                          aria-label={`관계 ${index + 1} 설명`}
                          className={s.textarea}
                          rows={2}
                          maxLength={500}
                          required
                          placeholder="예: 오래된 친구라 편하게 장난치지만 힘들어하면 먼저 챙겨요."
                          value={relationship.description}
                          onChange={(event) =>
                            change(
                              "relationships",
                              definition.relationships.map((value, i) =>
                                i === index ? { ...value, description: event.target.value } : value,
                              ),
                            )
                          }
                        />
                      </div>
                    );
                  })}
                  <Button
                    variant="secondary"
                    size="compact"
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
                  {relationshipTargets.length === 0 && (
                    <p className={s.small}>다른 캐릭터를 추가하면 관계를 설정할 수 있어요.</p>
                  )}
                </section>
              </CharacterWorkPanel>
              <Surface
                tone="accent"
                className={e.identityPreview}
                aria-label="캐릭터 정체성 미리보기"
              >
                <div className={e.portrait} aria-hidden="true">
                  {portrait ? (
                    <img className={s.characterPortrait} src={portrait} alt="" />
                  ) : (
                    definition.expressions[DEFAULT_EXPRESSION]
                  )}
                </div>
                <div>
                  <strong>{definition.name || "새 캐릭터"}</strong>
                  <p>
                    {character ? (isTogether ? "함께 지내는 중" : "쉬는 중") : "아직 저장하지 않음"}
                  </p>
                  <p>
                    표정 {expressionKeys.length}개 · 동작 {definition.animation?.clips.length ?? 0}
                    개
                  </p>
                  <p>{definition.description}</p>
                </div>
              </Surface>
              <div className={e.attributionPanel}>{packContent}</div>
            </div>
          </div>
        </fieldset>
      </TabPanel>
      <TabPanel value="appearance" className={s.editorPanel}>
        <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
          <AppearanceEditor
            key={`${character?.id ?? "new"}:${animationVersion}`}
            footer={definitionActions}
            definition={definition}
            character={character}
            selection={assetSelections[character?.id ?? "new"]}
            onSelectionChange={(value) =>
              setAssetSelections((previous) => ({ ...previous, [character?.id ?? "new"]: value }))
            }
            onSprite={onSprite}
            assets={animationAssets}
            visible={tab === "appearance"}
            onChange={onChange}
            onAnimationChange={onAnimationChange ?? ((animation) => change("animation", animation))}
            onChooseAssets={onChooseAnimationAssets}
          />
        </fieldset>
      </TabPanel>
      <TabPanel value="balloon" className={s.editorPanel}>
        <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
          <BalloonAppearance
            footer={definitionActions}
            visible={tab === "balloon"}
            definition={definition}
            character={character}
            onSprite={onSprite}
            onChange={(patch) => onChange({ ...definition, ...patch })}
          />
        </fieldset>
      </TabPanel>
      <TabPanel value="dialogue" className={s.editorPanel}>
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
                variant={dialogueType === type ? "primary" : "secondary"}
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
                    limit={32}
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
      </TabPanel>
      <TabPanel value="memory" className={s.editorPanel}>
        {(typeof memoryContent === "function"
          ? memoryContent(() => setTab("settings"))
          : memoryContent) ?? (
          <p className={s.small}>캐릭터를 저장하면 함께 나눈 기억을 볼 수 있어요.</p>
        )}
      </TabPanel>
      <TabPanel value="settings" className={s.editorPanel}>
        {settingsContent ?? <p className={s.small}>캐릭터를 먼저 저장해 주세요.</p>}
      </TabPanel>
    </Tabs>
  );
}
