import { useState, type JSX, type ReactNode } from "react";
import { Button, Checkbox, FormField, Select, TextArea, TextField } from "@fleetia/lagrange";
import type { CharacterDefinition, CharacterLine, InstalledCharacter } from "../../types";
import { BALLOON_SPRITE, DEFAULT_EXPRESSION, spriteUrl } from "../characterIdentity";
import * as s from "../characters.css";

export const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
const MAX_EXPRESSIONS = 24;

type Props = {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  onChange: (definition: CharacterDefinition) => void;
  onSave: () => void;
  onCancel?: () => void;
  onSprite?: (expression: string, remove: boolean) => void;
  pending: boolean;
  dirty: boolean;
  children?: ReactNode;
};

function Lines({
  title,
  lines,
  limit,
  expressions,
  onChange,
}: {
  title: string;
  lines: CharacterLine[];
  limit: number;
  expressions: string[];
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
    <section className={s.section} aria-label="모습과 표정">
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
        </div>
      </div>
    </section>
  );
}

export function CharacterEditor({
  definition,
  character,
  onChange,
  onSave,
  onCancel,
  onSprite,
  pending,
  dirty,
  children,
}: Props): JSX.Element {
  function change<K extends keyof CharacterDefinition>(
    key: K,
    value: CharacterDefinition[K],
  ): void {
    onChange({ ...definition, [key]: value });
  }
  const expressionKeys = Object.keys(definition.expressions);
  const portrait = spriteUrl(character, DEFAULT_EXPRESSION);
  const valid =
    Boolean(definition.name.trim()) &&
    DEFAULT_EXPRESSION in definition.expressions &&
    Number.isInteger(definition.spriteSize) &&
    definition.spriteSize >= 32 &&
    definition.spriteSize <= 512 &&
    expressionKeys.every((key) => definition.expressions[key]?.trim()) &&
    [...definition.greeting, ...definition.idleLines].every((line) => line.text.trim());
  return (
    <div className={s.editor}>
      <fieldset className={s.fieldset} disabled={pending}>
        <section aria-label="기본 정보">
          <div className={s.sectionHeader}>
            <h3 className={s.subheading}>기본 정보</h3>
            <span className={s.characterFace} aria-hidden="true">
              {portrait ? (
                <img className={s.characterPortrait} src={portrait} alt="" />
              ) : (
                definition.expressions[DEFAULT_EXPRESSION]
              )}
            </span>
          </div>
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
          </div>
        </section>
        <Expressions
          definition={definition}
          character={character}
          onSprite={onSprite}
          onChange={(patch) => onChange({ ...definition, ...patch })}
        />
      </fieldset>
      <section className={s.section} aria-label="등록 대사">
        <h3 className={s.subheading}>등록 대사</h3>
        <fieldset className={s.fieldset} disabled={pending}>
          <Lines
            title="인사"
            lines={definition.greeting}
            limit={8}
            expressions={expressionKeys}
            onChange={(lines) => change("greeting", lines)}
          />
          <Lines
            title="자동 수다"
            lines={definition.idleLines}
            limit={32}
            expressions={expressionKeys}
            onChange={(lines) => change("idleLines", lines)}
          />
        </fieldset>
        {children}
      </section>
      <footer className={s.saveBar}>
        <span className={s.small}>
          {dirty
            ? "● 캐릭터 변경 · 키워드와 조합 대사는 별도 저장"
            : `저장된 버전 ${definition.version} · 키워드와 조합 대사는 별도 저장`}
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
    </div>
  );
}
