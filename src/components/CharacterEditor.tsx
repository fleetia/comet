import type { JSX } from "react";
import type { CharacterDefinition, CharacterLine } from "../types";
import * as ui from "../styles.css";
import * as s from "./characters.css";

export const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];

type Props = {
  definition: CharacterDefinition;
  onChange: (definition: CharacterDefinition) => void;
  onSave: () => void;
  pending: boolean;
  dirty: boolean;
};
function Lines({
  title,
  lines,
  limit,
  onChange,
}: {
  title: string;
  lines: CharacterLine[];
  limit: number;
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
              <select
                className={ui.input}
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
                {EXPRESSIONS.map((expression) => (
                  <option key={expression}>{expression}</option>
                ))}
              </select>
            </label>
            <button
              className={ui.button}
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
            </button>
            <button
              className={ui.button}
              type="button"
              disabled={lines.length <= 1}
              aria-label={`${title} ${index + 1} 삭제`}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              삭제
            </button>
          </div>
          <textarea
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
      <button
        className={ui.button}
        type="button"
        disabled={lines.length >= limit}
        onClick={() => onChange([...lines, { expression: "평온", text: "" }])}
      >
        {title} 대사 추가
      </button>
    </section>
  );
}
export function CharacterEditor({
  definition,
  onChange,
  onSave,
  pending,
  dirty,
}: Props): JSX.Element {
  function change<K extends keyof CharacterDefinition>(
    key: K,
    value: CharacterDefinition[K],
  ): void {
    onChange({ ...definition, [key]: value });
  }
  const valid =
    definition.name.trim() &&
    EXPRESSIONS.every((key) => definition.expressions[key]?.trim()) &&
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
          <input
            className={ui.input}
            required
            maxLength={40}
            value={definition.name}
            onChange={(event) => change("name", event.target.value)}
          />
        </label>
        <label className={ui.field}>
          소개
          <textarea
            className={s.textarea}
            rows={2}
            maxLength={500}
            value={definition.description}
            onChange={(event) => change("description", event.target.value)}
          />
        </label>
        <label className={ui.field}>
          성격과 말투
          <textarea
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
        <section className={s.section}>
          <h3 className={s.subheading}>텍스트 표정</h3>
          <div className={s.expressions}>
            {EXPRESSIONS.map((key) => (
              <label className={ui.field} key={key}>
                {key}
                <input
                  className={ui.input}
                  required
                  maxLength={40}
                  value={definition.expressions[key] ?? ""}
                  onChange={(event) =>
                    change("expressions", { ...definition.expressions, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </section>
        <Lines
          title="인사"
          lines={definition.greeting}
          limit={8}
          onChange={(lines) => change("greeting", lines)}
        />
        <Lines
          title="자동 수다"
          lines={definition.idleLines}
          limit={32}
          onChange={(lines) => change("idleLines", lines)}
        />
        <p className={ui.quiet}>대사의 공백과 줄바꿈을 그대로 저장해요.</p>
        <div className={s.saveBar}>
          <button className={ui.primary} type="submit" disabled={!valid || !dirty}>
            {pending ? "저장 중…" : "캐릭터 저장"}
          </button>
          <span className={ui.quiet}>
            {dirty ? "저장하지 않은 수정이 있어요." : `저장된 버전 ${definition.version}`}
          </span>
        </div>
      </fieldset>
    </form>
  );
}
