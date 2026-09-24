import { useEffect, useId, useState, type JSX, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  FormField,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
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
import { balloonTextStyle, DEFAULT_BALLOON_STYLE } from "../balloonTypography";
import { AnimationEditor } from "../AnimationEditor/AnimationEditor";
import { animationError } from "../AnimationEditor/helpers";
import { MotionSelect, motionError } from "../MotionSelect/MotionSelect";
import { ReactionEditor } from "../ReactionEditor/ReactionEditor";
import { reactionError } from "../ReactionEditor/reactionValidation";
import * as s from "../characters.css";

export const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
const MAX_EXPRESSIONS = 24;
const MAX_RELATIONSHIPS = 32;

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
  memoryContent?: ReactNode;
  settingsContent?: ReactNode;
  memoryTabRequest?: number;
};

function Lines({
  title,
  lines,
  limit,
  expressions,
  clips,
  onChange,
}: {
  title: string;
  lines: CharacterLine[];
  limit: number;
  expressions: string[];
  clips: AnimationClip[];
  onChange: (lines: CharacterLine[]) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className={s.dialogueRow}>
        <span>{title}</span>
        <span className={s.lineSummary}>{lines.map((line) => line.text).join(" / ")}</span>
        <Button
          variant="secondary"
          size="compact"
          type="button"
          aria-expanded={editing}
          aria-label={`${title} 편집`}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "접기" : "편집"}
        </Button>
      </div>
      <div hidden={!editing} className={s.lineEditor}>
        {lines.map((line, index) => (
          <div className={s.line} key={index}>
            <div className={s.compactActions}>
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
              <Button
                variant="secondary"
                size="compact"
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
                size="compact"
                type="button"
                disabled={lines.length <= 1}
                aria-label={`${title} ${index + 1} 삭제`}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                삭제
              </Button>
            </div>
            <TextArea
              className={s.textarea}
              aria-label={`${title} ${index + 1} 대사`}
              rows={2}
              maxLength={500}
              required
              value={line.text}
              onChange={(event) =>
                onChange(
                  lines.map((value, i) =>
                    i === index ? { ...value, text: event.target.value } : value,
                  ),
                )
              }
            />
            <MotionSelect
              label={`${title} ${index + 1}`}
              value={line.motion}
              clips={clips}
              onChange={(motion) =>
                onChange(lines.map((value, i) => (i === index ? { ...value, motion } : value)))
              }
            />
          </div>
        ))}
        <Button
          variant="secondary"
          size="compact"
          type="button"
          disabled={lines.length >= limit}
          onClick={() => onChange([...lines, { expression: DEFAULT_EXPRESSION, text: "" }])}
        >
          {title} 대사 추가
        </Button>
        <p className={s.small}>
          원문과 줄바꿈을 보존해요. 인사·자동 수다는 캐릭터 저장으로 반영해요.
        </p>
      </div>
    </div>
  );
}

function Expressions({
  definition,
  character,
  onChange,
  onSprite,
}: Pick<Props, "definition" | "character" | "onSprite"> & {
  onChange: (
    patch: Partial<Pick<CharacterDefinition, "expressions" | "faceIcon" | "spriteSize">>,
  ) => void;
}): JSX.Element {
  const [newKey, setNewKey] = useState("");
  const keys = Object.keys(definition.expressions);
  const candidate = newKey.trim();
  const canAdd =
    candidate.length > 0 &&
    candidate.length <= 20 &&
    !candidate.startsWith("$") &&
    !(candidate in definition.expressions) &&
    keys.length < MAX_EXPRESSIONS;
  function add(): void {
    if (!canAdd) {
      return;
    }
    onChange({ expressions: { ...definition.expressions, [candidate]: candidate } });
    setNewKey("");
  }
  return (
    <section aria-label="모습과 표정">
      <h3 className={s.subheading}>모습과 표정</h3>
      <div className={s.appearanceLayout}>
        <div>
          <div className={s.expressionHead} aria-hidden="true">
            <span>표정</span>
            <span>문자 표정</span>
            <span>이미지</span>
          </div>
          {keys.map((key) => {
            const saved = Boolean(character?.sprites[key]);
            const url = saved && character ? spriteUrl(character, key) : null;
            return (
              <div className={s.expressionRow} key={key}>
                <span>
                  {key}
                  {key === DEFAULT_EXPRESSION ? " · 기본" : ""}
                </span>
                <TextField
                  required
                  maxLength={40}
                  aria-label={`${key} 텍스트 표정`}
                  value={definition.expressions[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      expressions: { ...definition.expressions, [key]: event.target.value },
                    })
                  }
                />
                <div className={s.spriteActions}>
                  <span className={s.spriteFrame} aria-label={`${key} 이미지`}>
                    {url ? (
                      <img className={s.spriteImage} src={url} alt={`${key} 표정 이미지`} />
                    ) : (
                      <span>{saved ? "이미지" : "—"}</span>
                    )}
                  </span>
                  <Button
                    variant="secondary"
                    size="compact"
                    type="button"
                    disabled={!character || !character.definition.expressions[key] || !onSprite}
                    aria-label={`${key} 이미지 선택`}
                    onClick={() => onSprite?.(key, false)}
                  >
                    {saved ? "변경" : "선택"}
                  </Button>
                  {saved && (
                    <Button
                      variant="quiet"
                      size="compact"
                      type="button"
                      aria-label={`${key} 이미지 제거`}
                      onClick={() => onSprite?.(key, true)}
                    >
                      ×
                    </Button>
                  )}
                </div>
                {key !== DEFAULT_EXPRESSION && (
                  <Button
                    variant="quiet"
                    size="compact"
                    type="button"
                    aria-label={`${key} 표정 삭제`}
                    onClick={() => {
                      const next = { ...definition.expressions };
                      delete next[key];
                      onChange({ expressions: next });
                    }}
                  >
                    ×
                  </Button>
                )}
              </div>
            );
          })}
          <div className={s.expressionAdd}>
            <TextField
              aria-label="새 표정 이름"
              placeholder="새 표정 이름"
              maxLength={20}
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button
              variant="secondary"
              size="compact"
              type="button"
              disabled={!canAdd}
              onClick={add}
            >
              표정 추가
            </Button>
          </div>
          <p className={s.small}>
            없는 표정은 평온으로 표시해요. 새 표정은 저장 후 이미지를 넣어요.
          </p>
          {!character && (
            <p className={s.small}>캐릭터를 먼저 저장하면 표정마다 이미지를 넣을 수 있어요.</p>
          )}
        </div>
        <div className={s.appearanceSettings}>
          <h4 className={s.subheading}>표시 설정</h4>
          <FormField className={s.inlineField} label="크기">
            <TextField
              type="number"
              min={32}
              max={512}
              step={8}
              aria-label="이미지 크기(px)"
              value={definition.spriteSize}
              onChange={(event) => onChange({ spriteSize: Number(event.target.value) })}
            />
          </FormField>
          <span className={s.small}>32~512 px</span>
          <Checkbox
            className={s.appearanceCheckbox}
            checked={definition.faceIcon}
            onChange={(event) => onChange({ faceIcon: event.target.checked })}
          >
            텍스트 표정을 따로 움직이는 창으로 표시
          </Checkbox>
          <p className={s.small}>이미지는 선택 즉시 저장해요. SVG·PNG·GIF·WebP·JPEG, 2 MiB 이하.</p>
        </div>
      </div>
    </section>
  );
}

function BalloonAppearance({
  definition,
  character,
  onChange,
  onSprite,
}: Pick<Props, "definition" | "character" | "onSprite"> & {
  onChange: (patch: Pick<CharacterDefinition, "balloonStyle">) => void;
}): JSX.Element {
  const fontOptionsId = useId();
  const balloonStyle = {
    ...(definition.balloonStyle ?? DEFAULT_BALLOON_STYLE),
    textSpeed: definition.balloonStyle?.textSpeed ?? 0,
  };
  return (
    <section aria-label="말풍선 설정">
      <h3 className={s.subheading}>말풍선</h3>
      <div className={s.appearanceSettings}>
        <div className={s.balloonSetting}>
          <span>말풍선</span>
          <span className={s.spriteFrame} aria-label="말풍선 이미지">
            {character && spriteUrl(character, BALLOON_SPRITE) ? (
              <img
                className={s.spriteImage}
                src={spriteUrl(character, BALLOON_SPRITE) ?? undefined}
                alt="말풍선 이미지"
              />
            ) : (
              "기본"
            )}
          </span>
          <Button
            variant="secondary"
            size="compact"
            type="button"
            disabled={!character || !onSprite}
            onClick={() => onSprite?.(BALLOON_SPRITE, false)}
          >
            말풍선 이미지 선택
          </Button>
          {character?.sprites[BALLOON_SPRITE] && (
            <Button
              variant="quiet"
              size="compact"
              type="button"
              onClick={() => onSprite?.(BALLOON_SPRITE, true)}
            >
              말풍선 이미지 제거
            </Button>
          )}
        </div>
        <p className={s.small}>이미지는 선택 즉시 저장해요. SVG·PNG·GIF·WebP·JPEG, 2 MiB 이하.</p>
        <FormField className={s.inlineField} label="글자 크기">
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
        <span className={s.small}>12~40 px</span>
        <div className={s.balloonSetting}>
          <FormField className={s.inlineField} label="글자 색">
            <TextField
              className={s.balloonColorInput}
              type="color"
              aria-label="말풍선 글자 색"
              value={balloonStyle.textColor ?? "#302a33"}
              onChange={(event) =>
                onChange({
                  balloonStyle: { ...balloonStyle, textColor: event.target.value },
                })
              }
            />
          </FormField>
          <Button
            variant="quiet"
            size="compact"
            type="button"
            disabled={balloonStyle.textColor === null}
            onClick={() => onChange({ balloonStyle: { ...balloonStyle, textColor: null } })}
          >
            기본색
          </Button>
          {balloonStyle.textColor === null && <span className={s.small}>기본색 사용 중</span>}
        </div>
        <FormField className={s.inlineField} label="폰트">
          <TextField
            aria-label="말풍선 폰트"
            list={fontOptionsId}
            maxLength={100}
            placeholder="기본 글꼴"
            value={balloonStyle.fontFamily}
            onChange={(event) =>
              onChange({
                balloonStyle: { ...balloonStyle, fontFamily: event.target.value },
              })
            }
          />
        </FormField>
        <datalist id={fontOptionsId}>
          {["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Arial", "Georgia"].map(
            (font) => (
              <option key={font} value={font} />
            ),
          )}
        </datalist>
        <p className={s.small}>
          이 컴퓨터에 설치된 폰트 이름을 입력해요. 비워 두면 기본 글꼴을 쓰고, 없는 폰트는 시스템
          글꼴로 표시해요. 글자 설정은 캐릭터마다 저장해요.
        </p>
        <FormField className={s.inlineField} label="출력 속도">
          <TextField
            type="number"
            min={0}
            max={100}
            step={1}
            aria-label="글자 출력 속도 (초당 글자 수)"
            value={balloonStyle.textSpeed}
            onChange={(event) =>
              onChange({
                balloonStyle: { ...balloonStyle, textSpeed: Number(event.target.value) },
              })
            }
          />
        </FormField>
        <p className={s.small}>초당 1~100글자, 0이면 대사를 즉시 표시해요.</p>
        <p
          className={s.balloonTextPreview}
          aria-label="말풍선 글자 미리보기"
          style={balloonTextStyle(balloonStyle)}
        >
          안녕. 만나서 반가워!
        </p>
      </div>
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
}: Props): JSX.Element {
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
    [...definition.greeting, ...definition.idleLines]
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
    [...definition.greeting, ...definition.idleLines].every((line) => line.text.trim());
  return (
    <Tabs className={s.editor} value={tab} onValueChange={setTab}>
      <div className={s.editorHeader}>
        <div className={s.sectionHeader}>
          <h2 className={s.subheading}>{definition.name || "새 캐릭터"}</h2>
          <span className={s.characterFace} aria-hidden="true">
            {portrait ? (
              <img className={s.characterPortrait} src={portrait} alt="" />
            ) : (
              definition.expressions[DEFAULT_EXPRESSION]
            )}
          </span>
        </div>
        <TabList aria-label="캐릭터 편집">
          <Tab value="profile">프로필</Tab>
          <Tab value="appearance">모습·표정</Tab>
          <Tab value="balloon">말풍선</Tab>
          <Tab value="dialogue">대사·반응</Tab>
          <Tab value="memory">기억</Tab>
          <Tab value="settings">설정</Tab>
        </TabList>
      </div>
      <TabPanel value="profile" className={s.editorPanel}>
        <fieldset className={s.fieldset} disabled={pending}>
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
                  className={s.textarea}
                  rows={3}
                  maxLength={2000}
                  placeholder="예: 먼저 짧게 답하고, 모르는 사실은 지어내지 않아요."
                  value={definition.instructions}
                  onChange={(event) => change("instructions", event.target.value)}
                />
              </FormField>
            </div>
            <p className={s.small}>
              지침은 LLM 대화 생성에 사용해요. 긴 지침·관계는 일부만 전달될 수 있으니 중요한
              내용부터 적어 주세요. 등록 대사는 원문 그대로 재생해요.
            </p>
          </section>
          <section className={s.section} aria-label="다른 캐릭터와의 관계">
            <h3 className={s.subheading}>다른 캐릭터와의 관계</h3>
            <p className={s.small}>
              이 캐릭터가 상대를 어떻게 생각하고 대하는지 적어요. 상대의 관점은 상대 캐릭터에서 따로
              설정해요.
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
        </fieldset>
      </TabPanel>
      <TabPanel value="appearance" className={s.editorPanel}>
        <fieldset className={s.fieldset} disabled={pending}>
          <Expressions
            definition={definition}
            character={character}
            onSprite={onSprite}
            onChange={(patch) => {
              const animation = definition.animation;
              onChange({
                ...definition,
                ...patch,
                ...(patch.expressions && animation
                  ? {
                      animation: {
                        ...animation,
                        overrides: Object.fromEntries(
                          Object.entries(animation.overrides).filter(
                            ([key]) => key in patch.expressions!,
                          ),
                        ),
                      },
                    }
                  : {}),
              });
            }}
          />
          <AnimationEditor
            key={`${character?.id ?? "new"}:${animationVersion}`}
            animation={definition.animation}
            character={character}
            expressions={expressionKeys}
            assets={animationAssets}
            size={definition.spriteSize}
            visible={tab === "appearance"}
            onChange={onAnimationChange ?? ((animation) => change("animation", animation))}
            onChooseAssets={onChooseAnimationAssets}
          />
        </fieldset>
      </TabPanel>
      <TabPanel value="balloon" className={s.editorPanel}>
        <fieldset className={s.fieldset} disabled={pending}>
          <BalloonAppearance
            definition={definition}
            character={character}
            onSprite={onSprite}
            onChange={(patch) => onChange({ ...definition, ...patch })}
          />
        </fieldset>
      </TabPanel>
      <TabPanel value="dialogue" className={s.editorPanel}>
        <section aria-label="등록 대사">
          <h3 className={s.subheading}>등록 대사</h3>
          <fieldset className={s.fieldset} disabled={pending}>
            <Lines
              title="인사"
              lines={definition.greeting}
              limit={8}
              expressions={expressionKeys}
              clips={definition.animation?.clips ?? []}
              onChange={(lines) => change("greeting", lines)}
            />
            <Lines
              title="자동 수다"
              lines={definition.idleLines}
              limit={32}
              expressions={expressionKeys}
              clips={definition.animation?.clips ?? []}
              onChange={(lines) => change("idleLines", lines)}
            />
          </fieldset>
          {children}
        </section>
        <fieldset className={s.fieldset} disabled={pending}>
          <ReactionEditor
            key={`${character?.id ?? "new"}:${animationVersion}`}
            definition={definition}
            character={character}
            assets={animationAssets}
            visible={tab === "dialogue"}
            onChange={(reactions) => change("reactions", reactions)}
          />
        </fieldset>
      </TabPanel>
      <TabPanel value="memory" className={s.editorPanel}>
        {memoryContent ?? (
          <p className={s.small}>캐릭터를 저장하면 함께 나눈 기억을 볼 수 있어요.</p>
        )}
      </TabPanel>
      <TabPanel value="settings" className={s.editorPanel}>
        {settingsContent ?? <p className={s.small}>캐릭터를 먼저 저장해 주세요.</p>}
      </TabPanel>
      <footer className={s.saveBar} hidden={tab === "memory" || tab === "settings"}>
        <span className={s.small}>
          {dialogueError
            ? `대사·반응: ${dialogueError}`
            : dirty
              ? "● 캐릭터 변경 · 키워드와 조합 대사는 별도 저장"
              : "키워드와 조합 대사는 별도 저장"}
        </span>
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
      </footer>
    </Tabs>
  );
}
