import { useState, type JSX } from "react";
import { Button, Checkbox, Rule, Select, TextArea, TextField } from "@fleetia/lagrange";
import type { CharacterDefinition, CharacterLine, InstalledCharacter } from "../../types";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";
import { BALLOON_SPRITE, DEFAULT_EXPRESSION, spriteUrl } from "../characterIdentity";

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
  return (
    <section className={s.section}>
      <h3 className={s.subheading}>{title}</h3>
      {lines.map((line, index) => (
        <div className={s.line} key={index}>
          <div className={ui.row}>
            <label>
              {index + 1}번 표정{" "}
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
            </label>
            <Button
              variant="secondary"
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
              variant="secondary"
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
        type="button"
        disabled={lines.length >= limit}
        onClick={() => onChange([...lines, { expression: DEFAULT_EXPRESSION, text: "" }])}
      >
        {title} 대사 추가
      </Button>
    </section>
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
    !(candidate in definition.expressions) &&
    keys.length < MAX_EXPRESSIONS;
  function add(): void {
    if (!canAdd) return;
    onChange({ expressions: { ...definition.expressions, [candidate]: candidate } });
    setNewKey("");
  }
  return (
    <section className={s.section}>
      <h3 className={s.subheading}>표정</h3>
      <p className={ui.quiet}>
        대사에 적힌 표정이 여기 없으면 기본 표정({DEFAULT_EXPRESSION})으로 보여요. 이미지는
        SVG·PNG·GIF·WebP·JPEG 파일을 2 MiB까지 쓸 수 있고, 이미지가 없는 표정은 기본 표정의 이미지를
        대신 써요. 이미지가 있으면 본체는 상자 없이 이미지만 떠 있어요.
      </p>
      <div className={s.expressions}>
        {keys.map((key) => {
          const url = character ? spriteUrl(character, key) : null;
          const saved = Boolean(character?.sprites[key]);
          return (
            <div className={s.expressionCard} key={key}>
              <div className={s.spriteFrame} aria-label={`${key} 이미지`}>
                {url ? (
                  <img className={s.spriteImage} src={url} alt={`${key} 표정 이미지`} />
                ) : (
                  <span>{saved ? "이미지" : "이미지 없음"}</span>
                )}
              </div>
              <label className={ui.field}>
                {key}
                {key === DEFAULT_EXPRESSION ? " (기본)" : ""}
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
              </label>
              <div className={s.spriteActions}>
                <Button
                  variant="secondary"
                  size="compact"
                  type="button"
                  disabled={!character || !onSprite}
                  onClick={() => onSprite?.(key, false)}
                >
                  이미지 선택
                </Button>
                {saved && (
                  <Button
                    variant="secondary"
                    size="compact"
                    type="button"
                    onClick={() => onSprite?.(key, true)}
                  >
                    이미지 제거
                  </Button>
                )}
                {key !== DEFAULT_EXPRESSION && (
                  <Button
                    variant="secondary"
                    size="compact"
                    type="button"
                    aria-label={`${key} 표정 삭제`}
                    onClick={() => {
                      const next = { ...definition.expressions };
                      delete next[key];
                      onChange({ expressions: next });
                    }}
                  >
                    표정 삭제
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!character && (
        <p className={ui.quiet}>캐릭터를 먼저 저장하면 표정마다 이미지를 넣을 수 있어요.</p>
      )}
      <div className={ui.row}>
        <TextField
          aria-label="새 표정 이름"
          placeholder="예: 슬픔"
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
        <Button variant="secondary" type="button" disabled={!canAdd} onClick={add}>
          표정 추가
        </Button>
      </div>
      <div className={s.expressionCard}>
        <h4 className={s.subheading}>말풍선 이미지</h4>
        <div className={s.spriteFrame} aria-label="말풍선 이미지">
          {character && spriteUrl(character, BALLOON_SPRITE) ? (
            <img
              className={s.spriteImage}
              src={spriteUrl(character, BALLOON_SPRITE) ?? undefined}
              alt="말풍선 이미지"
            />
          ) : (
            <span>이미지 없음</span>
          )}
        </div>
        <p className={ui.quiet}>
          말풍선이 커지면 이미지 정중앙 1px 행과 열만 늘려요. 홀수 크기 이미지가 잘 맞고, 화자의
          캐릭터 이미지를 사용해요.
        </p>
        <div className={s.spriteActions}>
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
              variant="secondary"
              size="compact"
              type="button"
              onClick={() => onSprite?.(BALLOON_SPRITE, true)}
            >
              말풍선 이미지 제거
            </Button>
          )}
        </div>
      </div>
      <label className={ui.field}>
        이미지 크기(px)
        <TextField
          type="number"
          min={32}
          max={512}
          step={8}
          aria-label="이미지 크기(px)"
          value={definition.spriteSize}
          onChange={(event) => onChange({ spriteSize: Number(event.target.value) })}
        />
        <span className={ui.quiet}>
          32~512. 본체 창도 이 크기에 맞춰져요. 64의 배수가 또렷해요.
        </span>
      </label>
      <Checkbox
        checked={definition.faceIcon}
        onChange={(event) => onChange({ faceIcon: event.target.checked })}
      >
        텍스트 표정을 따로 움직이는 창으로 표시
      </Checkbox>
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
}: Props): JSX.Element {
  function change<K extends keyof CharacterDefinition>(
    key: K,
    value: CharacterDefinition[K],
  ): void {
    onChange({ ...definition, [key]: value });
  }
  const expressionKeys = Object.keys(definition.expressions);
  const valid =
    definition.name.trim() &&
    DEFAULT_EXPRESSION in definition.expressions &&
    Number.isInteger(definition.spriteSize) &&
    definition.spriteSize >= 32 &&
    definition.spriteSize <= 512 &&
    expressionKeys.every((key) => definition.expressions[key]?.trim()) &&
    [...definition.greeting, ...definition.idleLines].every((line) => line.text.trim());
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !pending) onSave();
      }}
    >
      <fieldset className={s.fieldset} disabled={pending}>
        <label className={ui.field}>
          이름
          <TextField
            required
            maxLength={40}
            value={definition.name}
            onChange={(event) => change("name", event.target.value)}
          />
        </label>
        <label className={ui.field}>
          소개
          <TextArea
            className={s.textarea}
            rows={2}
            maxLength={500}
            value={definition.description}
            onChange={(event) => change("description", event.target.value)}
          />
        </label>
        <label className={ui.field}>
          성격과 말투
          <TextArea
            className={s.textarea}
            rows={4}
            aria-label="성격과 말투"
            maxLength={500}
            value={definition.personality}
            onChange={(event) => change("personality", event.target.value)}
          />
          <span className={ui.quiet}>
            허구의 배경과 말투예요. 사용자에 관한 실제 기억과는 따로 보관해요.
          </span>
        </label>
        <Expressions
          definition={definition}
          character={character}
          onSprite={onSprite}
          onChange={(patch) => onChange({ ...definition, ...patch })}
        />
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
        <p className={ui.quiet}>대사의 공백과 줄바꿈을 그대로 저장해요.</p>
        <div className={s.saveBar}>
          <Rule variant="structural" />
          <div className={s.saveActions}>
            <Button variant="primary" type="submit" disabled={!valid || !dirty}>
              {pending ? "저장 중…" : "캐릭터 저장"}
            </Button>
            {dirty && onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel}>
                캐릭터 수정 취소
              </Button>
            )}
            <span className={ui.quiet} role="status">
              {dirty ? "저장하지 않은 수정이 있어요." : `저장된 버전 ${definition.version}`}
            </span>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
