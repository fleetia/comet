import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Checkbox, Dialog, Select, TextField } from "../../ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { CharacterCollection, MotionOverride } from "../../types";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import type { StateRule } from "./types";
import { useWindowCloseGuard } from "../useWindowCloseGuard";
import * as s from "./generatedWidgets.css";
import * as common from "../../lagrange.css";

export type RuleDraft = Omit<StateRule, "value"> & { valueJson: string };
type Editor = { rules: RuleDraft[]; stateJson: string; baseline: string; characters: CharacterCollection };
type SavedRules = Pick<Editor, "rules" | "baseline">;
type Trial = { valid: boolean; fieldPresent: boolean | null; matched: boolean | null; error: string | null };
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
  const [loaded, setLoaded] = useState<{ id: string; editor: Editor } | null>(null);
  const editor = loaded?.id === id ? loaded.editor : null;
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [stateJson, setStateJson] = useState("{}");
  const [trial, setTrial] = useState<{ ruleId: string; result: Trial } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const trialGeneration = useRef(0);
  const scope = useRef({ id, version: 0 });
  if (scope.current.id !== id) scope.current = { id, version: scope.current.version + 1 };
  const dirty = Boolean(editor && JSON.stringify(rules) !== JSON.stringify(editor.rules));
  function invalidateTrial(): void {
    trialGeneration.current += 1;
    setTrial(null);
    setTesting(null);
  }
  function current(version: number, request: number): boolean {
    return mounted.current && scope.current.version === version && generation.current === request;
  }
  async function load(): Promise<void> {
    const version = scope.current.version;
    const request = ++generation.current;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    invalidateTrial();
    try {
      const value = await command<Editor>("get_widget_rule_editor", { id });
      if (!current(version, request)) return;
      setLoaded({ id, editor: value });
      setRules(value.rules);
      setStateJson(value.stateJson);
    } catch (cause) {
      if (current(version, request)) setError(errorText(cause));
    } finally {
      if (current(version, request)) { lock.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    mounted.current = true;
    setLoaded(null);
    setRules([]);
    if (isDesktop()) void load();
    return () => {
      mounted.current = false;
      generation.current += 1;
      trialGeneration.current += 1;
    };
  }, [id]);
  function update(ruleId: string, changes: Partial<RuleDraft>): void {
    if (lock.current || !editor) return;
    setRules((before) => before.map((rule) => rule.id === ruleId ? { ...rule, ...changes } : rule));
    setSaved(false);
    invalidateTrial();
  }
  function add(): void {
    if (lock.current || !editor || rules.length >= 64) return;
    setRules((before) => [...before, {
      id: crypto.randomUUID(), widgetId: id,
      characterId: editor.characters.active[0] ?? editor.characters.installed[0]?.id ?? "",
      field: "", operator: "gte", valueJson: "1", text: "", expression: null,
      motion: null, cooldownMs: 30000, enabled: true,
    }]);
    setSaved(false);
    invalidateTrial();
  }
  function cancel(): void {
    if (lock.current || !editor) return;
    setRules(editor.rules);
    setError(null);
    setSaved(false);
    invalidateTrial();
  }
  async function save(): Promise<void> {
    if (lock.current || !editor) return;
    const version = scope.current.version;
    const request = generation.current;
    lock.current = true;
    setBusy(true);
    setError(null);
    invalidateTrial();
    try {
      const value = await command<SavedRules>("save_widget_state_rules", {
        id, rules, expectedBaseline: editor.baseline,
      });
      if (!current(version, request)) return;
      setRules(value.rules);
      setLoaded({ id, editor: { ...editor, ...value } });
      setSaved(true);
    } catch (cause) {
      if (current(version, request)) setError(errorText(cause));
    } finally {
      if (current(version, request)) { lock.current = false; setBusy(false); }
    }
  }
  async function test(rule: RuleDraft): Promise<void> {
    if (lock.current || !editor) return;
    const version = scope.current.version;
    const request = generation.current;
    const sequence = ++trialGeneration.current;
    setTrial(null);
    setTesting(rule.id);
    try {
      const result = await command<Trial>("test_widget_state_rule", { id, rule, stateJson });
      if (current(version, request) && sequence === trialGeneration.current)
        setTrial({ ruleId: rule.id, result });
    } catch (cause) {
      if (current(version, request) && sequence === trialGeneration.current)
        setTrial({ ruleId: rule.id, result: { valid: false, fieldPresent: null, matched: null, error: errorText(cause) } });
    } finally {
      if (current(version, request) && sequence === trialGeneration.current) setTesting(null);
    }
  }
  const closeGuard = useWindowCloseGuard(dirty, busy, () => command("close_widget_state_rules", { id }));
  return (
    <WidgetFrame
      title="위젯 상태별 대사"
      closeLabel="상태별 대사 닫기"
      onClose={closeGuard.requestClose}
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
          <Button variant="secondary" disabled={busy || !dirty} onClick={cancel}>수정 취소</Button>
          <Button variant="secondary" disabled={busy} onClick={() => {
            if (dirty) setConfirmReload(true); else void load();
          }}>최신 내용 확인</Button>
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
          <pre>{editor?.stateJson ?? "{}"}</pre>
          <p className={s.status}>
            예: count 또는 timer.remainingMs. 비교값은 JSON으로 입력해요. 텍스트는 "완료"처럼 따옴표로 감싸 주세요.
          </p>
        </details>
        <label className={s.field}>시험할 전체 상태 JSON
          <textarea aria-label="시험할 전체 상태 JSON" value={stateJson} disabled={busy || !editor}
            onChange={(event) => { setStateJson(event.target.value); invalidateTrial(); }} />
        </label>
        <p className={s.status}>시험은 이 상태의 조건 일치만 확인해요. 실제 발화·쿨다운·대화 기록은 변경하지 않아요.</p>
        <fieldset disabled={busy || !editor} style={{ border: 0, padding: 0, margin: 0 }}>
        {rules.length === 0 && <p>연결된 대사가 없어요. ‘조건 추가’로 시작해 보세요.</p>}
        {(editor ? rules : []).map((rule, index) => {
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
                    if (lock.current) return;
                    setRules((before) => before.filter((item) => item.id !== rule.id));
                    setSaved(false);
                    invalidateTrial();
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
                    value={rule.valueJson}
                    onChange={(event) => update(rule.id, { valueJson: event.target.value })}
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
              <Button variant="secondary" disabled={testing !== null}
                onClick={() => void test(rule)}>조건 {index + 1} 시험</Button>
              {trial?.ruleId === rule.id && <p role={trial.result.valid ? "status" : "alert"}>
                {!trial.result.valid ? trial.result.error : !trial.result.fieldPresent
                  ? "필드가 없어요. 조건은 일치하지 않아요."
                  : trial.result.matched ? "이 상태에서 조건이 일치해요." : "이 상태에서 조건이 일치하지 않아요."}
              </p>}
            </section>
          );
        })}
        </fieldset>
        {closeGuard.closeError && <p role="alert">{closeGuard.closeError}</p>}
        <Dialog isOpen={closeGuard.confirmClose} title="저장하지 않은 조건이 있어요" size="small"
          onOpenChange={(open) => { if (!open) closeGuard.keepEditing(); }}>
          <p>수정한 조건을 버리고 닫을까요?</p>
          <Button variant="secondary" onClick={closeGuard.keepEditing}>계속 편집</Button>
          <Button variant="critical" onClick={() => void closeGuard.discardAndClose()}>저장하지 않고 닫기</Button>
        </Dialog>
        <Dialog isOpen={confirmReload} title="최신 조건을 확인할까요?" size="small"
          onOpenChange={setConfirmReload}>
          <p>지금의 초안을 버리고 다른 창에서 저장한 내용을 불러와요.</p>
          <Button variant="secondary" onClick={() => setConfirmReload(false)}>계속 편집</Button>
          <Button variant="critical" onClick={() => { setConfirmReload(false); void load(); }}>초안 버리고 불러오기</Button>
        </Dialog>
      </div>
    </WidgetFrame>
  );
}
