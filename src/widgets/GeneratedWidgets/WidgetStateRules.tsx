import { useEffect, useState, type ReactElement } from "react";
import { Button, Checkbox, Select, TextField } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { CharacterCollection, MotionOverride } from "../../types";
import type { WidgetValue } from "../types";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import type { StateRule } from "./types";
import * as s from "./generatedWidgets.css";
import * as common from "../../lagrange.css";

type Editor = { rules: StateRule[]; state: WidgetValue; characters: CharacterCollection };
const OPERATORS = [
  ["eq", "같음"],
  ["ne", "다름"],
  ["gte", "이상"],
  ["gt", "초과"],
  ["lte", "이하"],
  ["lt", "미만"],
  ["contains", "포함"],
];

export function WidgetStateRules({ id }: { id: string }): ReactElement {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [rules, setRules] = useState<StateRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    if (isDesktop()) {
      void command<Editor>("get_widget_rule_editor", { id })
        .then((value) => {
          if (active) {
            setEditor(value);
            setRules(value.rules);
          }
        })
        .catch((cause) => {
          if (active) {
            setError(errorText(cause));
          }
        });
    }
    return () => {
      active = false;
    };
  }, [id]);
  function update(ruleId: string, changes: Partial<StateRule>): void {
    setRules((before) =>
      before.map((rule) => (rule.id === ruleId ? { ...rule, ...changes } : rule)),
    );
    setSaved(false);
  }
  function add(): void {
    setRules((before) => [
      ...before,
      {
        id: crypto.randomUUID(),
        widgetId: id,
        characterId: editor?.characters.active[0] ?? editor?.characters.installed[0]?.id ?? "",
        field: "",
        operator: "gte",
        value: 1,
        text: "",
        expression: null,
        motion: null,
        cooldownMs: 30000,
        enabled: true,
      },
    ]);
    setSaved(false);
  }
  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setRules(await command<StateRule[]>("save_widget_state_rules", { id, rules }));
      setSaved(true);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WidgetFrame
      title="위젯 상태별 대사"
      closeLabel="상태별 대사 닫기"
      onClose={() => command("close_widget_state_rules", { id })}
      footer={
        <div className={s.actions}>
          <Button
            variant="secondary"
            disabled={busy || !editor || rules.length >= 64}
            onClick={add}
          >
            조건 추가
          </Button>
          <Button variant="primary" disabled={busy || !editor} onClick={() => void save()}>
            저장
          </Button>
          {saved && <span role="status">저장했어요.</span>}
        </div>
      }
    >
      <div className={s.body}>
        <p>
          상태가 조건을 충족하는 순간 캐릭터가 반응해요. 대사·표정·동작은 AI 없이 그대로 재생됩니다.
        </p>
        <p className={s.status}>
          저장할 때 이미 충족된 조건은 말하지 않아요. 조건이 해제됐다 다시 충족되면 반응해요.
          숨김·일시정지·자동 대화 끄기 동안 발생한 반응은 나중에 재생하지 않아요.
        </p>
        {error && (
          <p className={common.error} role="alert">
            {error}
          </p>
        )}
        <details>
          <summary>현재 위젯 상태와 필드 보기</summary>
          <pre>{JSON.stringify(editor?.state ?? {}, null, 2)}</pre>
          <p className={s.status}>
            예: count 또는 timer.remainingMs. 값은 숫자·true/false 또는 텍스트로 입력해요.
          </p>
        </details>
        {rules.length === 0 && <p>연결된 대사가 없어요. ‘조건 추가’로 시작해 보세요.</p>}
        {rules.map((rule, index) => {
          const character = editor?.characters.installed.find(
            (item) => item.id === rule.characterId,
          );
          return (
            <section className={s.item} key={rule.id} aria-label={`조건 ${index + 1}`}>
              <div className={s.actions}>
                <Checkbox
                  checked={rule.enabled}
                  onChange={() => update(rule.id, { enabled: !rule.enabled })}
                >
                  조건 {index + 1} 사용
                </Checkbox>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRules((before) => before.filter((item) => item.id !== rule.id));
                    setSaved(false);
                  }}
                >
                  조건 삭제
                </Button>
              </div>
              <div className={s.row}>
                <label className={s.field}>
                  상태 필드
                  <TextField
                    aria-label={`조건 ${index + 1} 상태 필드`}
                    value={rule.field}
                    placeholder="count"
                    onChange={(event) => update(rule.id, { field: event.target.value })}
                  />
                </label>
                <label className={s.field}>
                  비교
                  <Select
                    aria-label={`조건 ${index + 1} 비교`}
                    value={rule.operator}
                    onChange={(event) => update(rule.id, { operator: event.target.value })}
                  >
                    {OPERATORS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className={s.field}>
                  값
                  <TextField
                    aria-label={`조건 ${index + 1} 값`}
                    value={typeof rule.value === "string" ? rule.value : JSON.stringify(rule.value)}
                    onChange={(event) => {
                      let value: WidgetValue = event.target.value;
                      try {
                        value = JSON.parse(event.target.value) as WidgetValue;
                      } catch {
                        /* Unquoted text is a string condition. */
                      }
                      update(rule.id, { value });
                    }}
                  />
                </label>
              </div>
              <label className={s.field}>
                캐릭터
                <Select
                  value={rule.characterId}
                  aria-label={`조건 ${index + 1} 캐릭터`}
                  onChange={(event) =>
                    update(rule.id, {
                      characterId: event.target.value,
                      expression: null,
                      motion: null,
                    })
                  }
                >
                  {editor?.characters.installed.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.definition.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={s.field}>
                대사
                <textarea
                  value={rule.text}
                  aria-label={`조건 ${index + 1} 대사`}
                  maxLength={500}
                  onChange={(event) => update(rule.id, { text: event.target.value })}
                />
              </label>
              <div className={s.row}>
                <label className={s.field}>
                  표정
                  <Select
                    value={rule.expression ?? ""}
                    onChange={(event) =>
                      update(rule.id, { expression: event.target.value || null })
                    }
                  >
                    <option value="">기본 표정</option>
                    {Object.keys(character?.definition.expressions ?? {}).map((expression) => (
                      <option key={expression}>{expression}</option>
                    ))}
                  </Select>
                </label>
                <label className={s.field}>
                  다시 말하기 간격(초)
                  <TextField
                    type="number"
                    min={0}
                    max={86400}
                    value={rule.cooldownMs / 1000}
                    onChange={(event) =>
                      update(rule.id, {
                        cooldownMs: Math.max(0, Number(event.target.value)) * 1000,
                      })
                    }
                  />
                </label>
                <label className={s.field}>
                  동작
                  <Select
                    value={
                      rule.motion?.mode === "clip"
                        ? rule.motion.clipId
                        : (rule.motion?.mode ?? "inherit")
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      const motion: MotionOverride =
                        value === "inherit"
                          ? { mode: "inherit" }
                          : value === "static"
                            ? { mode: "static" }
                            : { mode: "clip", clipId: value, repeat: false, intervalMs: 0 };
                      update(rule.id, { motion });
                    }}
                  >
                    <option value="inherit">표정 기본 동작</option>
                    <option value="static">정지</option>
                    {character?.definition.animation?.clips.map((clip) => (
                      <option key={clip.id} value={clip.id}>
                        {clip.id}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            </section>
          );
        })}
      </div>
    </WidgetFrame>
  );
}
