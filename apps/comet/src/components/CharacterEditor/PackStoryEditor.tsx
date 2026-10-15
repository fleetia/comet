import { useEffect, useRef, useState, type JSX } from "react";
import {
  ActionBar,
  Button,
  Checkbox,
  Dialog,
  FormField,
  Select,
  TextArea,
  TextField,
} from "../../ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  AnimationAsset,
  CharacterDefinition,
  InstalledCharacter,
  PackStoryDefinition,
  PackStorySnapshot,
  ScenarioDefinition,
  SceneLine,
} from "../../types";
import { MotionSelect } from "../MotionSelect/MotionSelect";
import { AuthoringTrial } from "./AuthoringTrial";
import * as s from "../characters.css";

export type PackStoryDraft = { saved: PackStorySnapshot; definition: PackStoryDefinition };
const entries = (text: string): string[] => (text === "" ? [] : text.split("\n"));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function StageLines({
  label,
  lines,
  definitions,
  onChange,
}: {
  label: string;
  lines: SceneLine[];
  definitions: CharacterDefinition[];
  onChange: (lines: SceneLine[]) => void;
}): JSX.Element {
  const first = definitions[0];
  return (
    <details>
      <summary>
        {label} · {lines.length} / 32줄
      </summary>
      {lines.map((line, index) => {
        const actor = definitions.find((definition) => definition.sourceId === line.persona);
        const update = (patch: Partial<SceneLine>): void =>
          onChange(lines.map((value, i) => (i === index ? { ...value, ...patch } : value)));
        return (
          <div className={s.relationshipRow} key={index}>
            <Select
              aria-label={`${label} ${index + 1} 화자`}
              value={line.persona}
              onChange={(event) => update({ persona: event.target.value })}
            >
              {!actor && <option value={line.persona}>확인할 화자</option>}
              {definitions.map((definition) => (
                <option key={definition.sourceId} value={definition.sourceId}>
                  {definition.name}
                </option>
              ))}
            </Select>
            <TextArea
              aria-label={`${label} ${index + 1} 본문`}
              value={line.text}
              rows={2}
              maxLength={500}
              onChange={(event) => update({ text: event.target.value })}
            />
            <Select
              aria-label={`${label} ${index + 1} 표정`}
              value={line.expression}
              onChange={(event) => update({ expression: event.target.value })}
            >
              {[...new Set([line.expression, ...Object.keys(actor?.expressions ?? {})])].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </Select>
            <MotionSelect
              label={`${label} ${index + 1}`}
              clips={actor?.animation?.clips ?? []}
              value={line.motion}
              onChange={(motion) => update({ motion })}
            />
            <div className={s.compactActions}>
              <Button
                variant="quiet"
                disabled={index === 0}
                onClick={() => {
                  const next = [...lines];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange(next);
                }}
              >
                {label} {index + 1} 위로
              </Button>
              <Button variant="quiet" onClick={() => onChange(lines.filter((_, i) => i !== index))}>
                {label} {index + 1} 삭제
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        variant="secondary"
        disabled={!first || lines.length >= 32}
        onClick={() =>
          onChange([...lines, { persona: first.sourceId, expression: "평온", text: "" }])
        }
      >
        {label} 대사 추가
      </Button>
    </details>
  );
}

export function PackStoryEditor({
  packId,
  installed,
  presentIds,
  trialAssets,
  visible,
  drafts,
  onDraftsChange,
  onPendingChange,
  characterDirty,
}: {
  packId: string | null;
  installed: InstalledCharacter[];
  presentIds?: string[];
  trialAssets?: Record<string, AnimationAsset[]>;
  visible: boolean;
  drafts: Record<string, PackStoryDraft>;
  onDraftsChange: (drafts: Record<string, PackStoryDraft>) => void;
  onPendingChange: (pending: boolean) => void;
  characterDirty: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [confirmReload, setConfirmReload] = useState(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const lock = useRef(false);
  const scope = useRef({ packId, version: 0 });
  const currentDrafts = useRef(drafts);
  currentDrafts.current = drafts;
  if (scope.current.packId !== packId)
    scope.current = { packId, version: scope.current.version + 1 };
  const editor = packId ? drafts[packId] : undefined;
  const dirty = Boolean(editor && !same(editor.definition, editor.saved.definition));
  const members = installed.filter((member) => member.packId === packId);
  const center = installed.find(
    (member) => member.definition.presenceRole !== "npc" && presentIds?.includes(member.id),
  );
  const actors =
    members.some((member) => member.definition.presenceRole !== "npc") || !center
      ? members
      : [...members, center];
  const definitions = members.map((member) => member.definition);
  const selectedScenario =
    editor?.definition.scenarios.find((value) => value.id === selected) ??
    editor?.definition.scenarios[0];
  function current(version: number, generation: number): boolean {
    return mounted.current && scope.current.version === version && request.current === generation;
  }
  function setEditor(value: PackStoryDraft): void {
    if (packId) onDraftsChange({ ...currentDrafts.current, [packId]: value });
  }
  async function load(): Promise<void> {
    if (!packId || !isDesktop()) return;
    const version = scope.current.version;
    const generation = ++request.current;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await command<PackStorySnapshot>("get_pack_story_definition", { packId });
      if (current(version, generation)) setEditor({ saved, definition: saved.definition });
    } catch (cause) {
      if (current(version, generation)) setError(errorText(cause));
    } finally {
      if (current(version, generation)) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      onPendingChange(false);
    };
  }, [onPendingChange]);
  useEffect(() => {
    request.current += 1;
    lock.current = false;
    setBusy(false);
    setError(null);
    setNotice(null);
    setConfirmReload(false);
    setSelected("");
  }, [packId]);
  useEffect(() => {
    if (visible && packId && !currentDrafts.current[packId] && !lock.current) void load();
  }, [visible, packId, Boolean(editor)]);
  useEffect(() => {
    onPendingChange(busy);
  }, [busy, onPendingChange]);
  function update(definition: PackStoryDefinition): void {
    if (lock.current || !editor) return;
    setEditor({ ...editor, definition });
    setNotice(null);
  }
  function updateScenario(patch: Partial<ScenarioDefinition>): void {
    if (editor && selectedScenario)
      update({
        ...editor.definition,
        scenarios: editor.definition.scenarios.map((value) =>
          value.id === selectedScenario.id ? { ...value, ...patch } : value,
        ),
      });
  }
  async function save(): Promise<void> {
    if (lock.current || !packId || !editor || characterDirty) return;
    const version = scope.current.version;
    const generation = ++request.current;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await command<PackStorySnapshot>("save_pack_story_definition", {
        packId,
        definition: editor.definition,
        expectedBaseline: editor.saved.baseline,
      });
      if (current(version, generation)) {
        setEditor({ saved, definition: saved.definition });
        setNotice("팩의 이야기와 지식을 저장했어요.");
      }
    } catch (cause) {
      if (current(version, generation)) setError(errorText(cause));
    } finally {
      if (current(version, generation)) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  if (!packId) return <p className={s.small}>캐릭터를 저장한 뒤 팩 이야기를 작성할 수 있어요.</p>;
  if (!editor)
    return (
      <section aria-label="팩 이야기">
        <p role="status">{error ?? "팩 이야기를 불러오고 있어요."}</p>
        <Button disabled={busy} onClick={() => void load()}>
          다시 불러오기
        </Button>
      </section>
    );
  return (
    <section aria-label="팩 이야기">
      <h3 className={s.subheading}>팩의 이야기와 지식</h3>
      <p className={s.small}>
        같은 팩의 친구들이 공유해요. 인물 설정과는 따로 저장하며, 등록 이야기는 모델 없이 진행돼요.
      </p>
      <fieldset className={s.fieldset} disabled={busy}>
        <FormField label="세계와 공통 규칙">
          <TextArea
            rows={3}
            maxLength={2000}
            value={editor.definition.worldRules}
            onChange={(event) => update({ ...editor.definition, worldRules: event.target.value })}
          />
        </FormField>
        <details>
          <summary>이야기 조건과 공개 여부</summary>
          {editor.definition.storyFlags.map((flag, index) => (
            <div className={s.relationshipRow} key={index}>
              <TextField
                aria-label={`조건 ${index + 1} 이름`}
                value={flag.id}
                onChange={(event) =>
                  update({
                    ...editor.definition,
                    storyFlags: editor.definition.storyFlags.map((value, i) =>
                      i === index ? { ...value, id: event.target.value } : value,
                    ),
                  })
                }
              />
              <Checkbox
                checked={flag.public}
                onChange={(event) =>
                  update({
                    ...editor.definition,
                    storyFlags: editor.definition.storyFlags.map((value, i) =>
                      i === index ? { ...value, public: event.target.checked } : value,
                    ),
                  })
                }
              >
                생성 대화에 공개
              </Checkbox>
              <Button
                variant="quiet"
                onClick={() =>
                  update({
                    ...editor.definition,
                    storyFlags: editor.definition.storyFlags.filter((_, i) => i !== index),
                  })
                }
              >
                조건 {index + 1} 삭제
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              update({
                ...editor.definition,
                storyFlags: [...editor.definition.storyFlags, { id: "", public: false }],
              })
            }
          >
            이야기 조건 추가
          </Button>
        </details>
        <details>
          <summary>조건부 지식 · {editor.definition.knowledge.length}개</summary>
          {editor.definition.knowledge.map((item, index) => {
            const patch = (changes: Partial<typeof item>): void =>
              update({
                ...editor.definition,
                knowledge: editor.definition.knowledge.map((value, i) =>
                  i === index ? { ...value, ...changes } : value,
                ),
              });
            return (
              <div className={s.relationshipRow} key={index}>
                <TextField
                  aria-label={`지식 ${index + 1} 이름`}
                  value={item.id}
                  onChange={(event) => patch({ id: event.target.value })}
                />
                <TextArea
                  aria-label={`지식 ${index + 1} 키워드`}
                  rows={2}
                  value={item.keywords.join("\n")}
                  onChange={(event) => patch({ keywords: entries(event.target.value) })}
                />
                <TextArea
                  aria-label={`지식 ${index + 1} 본문`}
                  rows={3}
                  maxLength={2000}
                  value={item.text}
                  onChange={(event) => patch({ text: event.target.value })}
                />
                <p className={s.small}>이 사실을 아는 인물</p>
                {definitions.map((definition) => (
                  <Checkbox
                    key={definition.sourceId}
                    checked={item.knownBy.includes(definition.sourceId)}
                    onChange={(event) =>
                      patch({
                        knownBy: event.target.checked
                          ? [...item.knownBy, definition.sourceId]
                          : item.knownBy.filter((value) => value !== definition.sourceId),
                      })
                    }
                  >
                    {definition.name}
                  </Checkbox>
                ))}
                <TextArea
                  aria-label={`지식 ${index + 1} 공개 조건`}
                  rows={2}
                  value={item.requiredFlags.join("\n")}
                  onChange={(event) => patch({ requiredFlags: entries(event.target.value) })}
                />
                <Button
                  variant="quiet"
                  onClick={() =>
                    update({
                      ...editor.definition,
                      knowledge: editor.definition.knowledge.filter((_, i) => i !== index),
                    })
                  }
                >
                  지식 {index + 1} 삭제
                </Button>
              </div>
            );
          })}
          <Button
            onClick={() =>
              update({
                ...editor.definition,
                knowledge: [
                  ...editor.definition.knowledge,
                  { id: "", keywords: [], text: "", knownBy: [], requiredFlags: [] },
                ],
              })
            }
          >
            조건부 지식 추가
          </Button>
        </details>
        <FormField label="등록 이야기">
          <Select
            aria-label="편집할 이야기"
            value={selectedScenario?.id ?? ""}
            onChange={(event) => setSelected(event.target.value)}
          >
            {editor.definition.scenarios.map((value) => (
              <option key={value.id} value={value.id}>
                {value.title || "새 이야기"}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          disabled={!definitions[0]}
          onClick={() => {
            const first = definitions[0];
            if (!first) return;
            const id = crypto.randomUUID();
            const line = { persona: first.sourceId, expression: "평온", text: "" };
            update({
              ...editor.definition,
              scenarios: [
                ...editor.definition.scenarios,
                {
                  id,
                  title: "",
                  centerId: first.sourceId,
                  participants: [first.sourceId],
                  keywords: [],
                  requiredFlags: [],
                  minAffinity: 0,
                  intro: [{ ...line }],
                  accept: [{ ...line }],
                  decline: [{ ...line }],
                  ending: [{ ...line }],
                  acceptKeywords: ["좋아"],
                  declineKeywords: ["다음에"],
                  proceedKeywords: ["계속하자"],
                  cancelKeywords: ["그만하자"],
                  acceptNextId: null,
                  declineNextId: null,
                  allowIncompleteRepeat: true,
                  allowRepeat: false,
                  completion: { setFlags: [], memoryTemplate: null },
                },
              ],
            });
            setSelected(id);
          }}
        >
          등록 이야기 추가
        </Button>
        {selectedScenario && (
          <section aria-label="선택한 이야기">
            <FormField label="이야기 제목">
              <TextField
                value={selectedScenario.title}
                onChange={(event) => updateScenario({ title: event.target.value })}
              />
            </FormField>
            <FormField label="중심 인물">
              <Select
                value={selectedScenario.centerId}
                onChange={(event) =>
                  updateScenario({
                    centerId: event.target.value,
                    participants: [
                      ...new Set([...selectedScenario.participants, event.target.value]),
                    ],
                  })
                }
              >
                {definitions
                  .filter((value) => value.presenceRole !== "npc")
                  .map((value) => (
                    <option key={value.sourceId} value={value.sourceId}>
                      {value.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <p className={s.small}>참가할 인물</p>
            {definitions.map((value) => (
              <Checkbox
                key={value.sourceId}
                checked={selectedScenario.participants.includes(value.sourceId)}
                disabled={value.sourceId === selectedScenario.centerId}
                onChange={(event) =>
                  updateScenario({
                    participants: event.target.checked
                      ? [...selectedScenario.participants, value.sourceId]
                      : selectedScenario.participants.filter((source) => source !== value.sourceId),
                  })
                }
              >
                {value.name}
              </Checkbox>
            ))}
            <FormField label="제안 키워드 · 한 줄에 하나">
              <TextArea
                rows={2}
                value={selectedScenario.keywords.join("\n")}
                onChange={(event) => updateScenario({ keywords: entries(event.target.value) })}
              />
            </FormField>
            {(
              [
                ["intro", "제안"],
                ["accept", "수락"],
                ["decline", "거절"],
                ["ending", "마무리"],
              ] as const
            ).map(([key, label]) => (
              <StageLines
                key={key}
                label={label}
                lines={selectedScenario[key]}
                definitions={definitions.filter((value) =>
                  selectedScenario.participants.includes(value.sourceId),
                )}
                onChange={(lines) => updateScenario({ [key]: lines })}
              />
            ))}
            <details>
              <summary>선택 표현·조건·분기·완료 효과</summary>
              {(
                [
                  ["acceptKeywords", "수락 표현"],
                  ["declineKeywords", "거절 표현"],
                  ["proceedKeywords", "계속할 표현"],
                  ["cancelKeywords", "중단 표현"],
                  ["requiredFlags", "제안에 필요한 조건"],
                ] as const
              ).map(([key, label]) => (
                <FormField key={key} label={`${label} · 한 줄에 하나`}>
                  <TextArea
                    rows={2}
                    value={selectedScenario[key].join("\n")}
                    onChange={(event) => updateScenario({ [key]: entries(event.target.value) })}
                  />
                </FormField>
              ))}
              <FormField label="최소 친밀도">
                <TextField
                  type="number"
                  min={0}
                  max={100}
                  value={selectedScenario.minAffinity}
                  onChange={(event) => updateScenario({ minAffinity: Number(event.target.value) })}
                />
              </FormField>
              {(
                [
                  ["acceptNextId", "마친 뒤 다음 이야기"],
                  ["declineNextId", "거절한 뒤 다음 이야기"],
                ] as const
              ).map(([key, label]) => (
                <FormField key={key} label={label}>
                  <Select
                    value={selectedScenario[key] ?? ""}
                    onChange={(event) => updateScenario({ [key]: event.target.value || null })}
                  >
                    <option value="">일상으로 돌아가기</option>
                    {editor.definition.scenarios.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.title || "새 이야기"}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ))}
              <Checkbox
                checked={selectedScenario.allowIncompleteRepeat}
                onChange={(event) =>
                  updateScenario({ allowIncompleteRepeat: event.target.checked })
                }
              >
                중단한 이야기는 나중에 다시 제안
              </Checkbox>
              <Checkbox
                checked={selectedScenario.allowRepeat}
                onChange={(event) => updateScenario({ allowRepeat: event.target.checked })}
              >
                완료한 이야기도 다시 제안
              </Checkbox>
              <FormField label="마무리 뒤 남길 조건">
                <TextArea
                  rows={2}
                  value={selectedScenario.completion.setFlags.join("\n")}
                  onChange={(event) =>
                    updateScenario({
                      completion: {
                        ...selectedScenario.completion,
                        setFlags: entries(event.target.value),
                      },
                    })
                  }
                />
              </FormField>
              <FormField label="함께한 경험으로 남길 문장 · 선택 사항">
                <TextArea
                  rows={2}
                  maxLength={500}
                  value={selectedScenario.completion.memoryTemplate ?? ""}
                  onChange={(event) =>
                    updateScenario({
                      completion: {
                        ...selectedScenario.completion,
                        memoryTemplate: event.target.value || null,
                      },
                    })
                  }
                />
              </FormField>
            </details>
            <Button
              variant="quiet"
              onClick={() =>
                update({
                  ...editor.definition,
                  scenarios: editor.definition.scenarios.filter(
                    (value) => value.id !== selectedScenario.id,
                  ),
                })
              }
            >
              선택한 이야기 삭제
            </Button>
            <AuthoringTrial
              title="등록 이야기 시험"
              actors={actors}
              subject={{ kind: "scenario", scenarioId: selectedScenario.id }}
              packId={packId}
              definition={editor.definition}
              baseline={editor.saved.baseline}
              presentIds={presentIds}
              assets={trialAssets}
              visible={visible && !busy}
            />
          </section>
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {characterDirty && (
        <p className={s.small}>
          캐릭터 변경을 먼저 저장하거나 취소한 뒤 팩 이야기를 저장해 주세요.
        </p>
      )}
      <ActionBar
        status={dirty ? "● 팩 이야기 변경 · 캐릭터 설정과 별도 저장" : "캐릭터 설정과 별도 저장"}
      >
        <Button
          disabled={busy || !dirty}
          onClick={() => {
            setEditor({ ...editor, definition: editor.saved.definition });
            setError(null);
          }}
        >
          팩 이야기 수정 취소
        </Button>
        <Button disabled={busy} onClick={() => (dirty ? setConfirmReload(true) : void load())}>
          최신 팩 내용 확인
        </Button>
        <Button
          variant="primary"
          disabled={busy || !dirty || characterDirty}
          onClick={() => void save()}
        >
          팩 이야기 저장
        </Button>
      </ActionBar>
      <Dialog
        isOpen={confirmReload}
        title="팩 이야기 초안을 버릴까요?"
        size="small"
        onOpenChange={setConfirmReload}
      >
        <p>작성 중인 이 팩의 이야기와 지식을 버리고 저장된 내용을 불러와요.</p>
        <Button onClick={() => setConfirmReload(false)}>계속 편집</Button>
        <Button
          onClick={() => {
            setConfirmReload(false);
            void load();
          }}
        >
          초안을 버리고 최신 내용 확인
        </Button>
      </Dialog>
    </section>
  );
}
