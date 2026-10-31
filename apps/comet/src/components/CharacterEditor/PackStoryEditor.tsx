import { useEffect, useRef, useState, type JSX } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  FormField,
  Textarea,
  TextInput,
} from "@comet/ui";
import { ActionBar } from "../../primitives";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  AnimationAsset,
  InstalledCharacter,
  PackStoryDefinition,
  PackStorySnapshot,
} from "../../types";
import * as s from "../characters.css";

export type PackStoryDraft = { saved: PackStorySnapshot; definition: PackStoryDefinition };
const entries = (text: string): string[] => (text === "" ? [] : text.split("\n"));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function PackStoryEditor({
  packId,
  installed,
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
  const definitions = members.map((member) => member.definition);
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
    onDraftsChange(
      Object.fromEntries(
        Object.entries(currentDrafts.current).map(([id, value]) => [
          id,
          { ...value, definition: value.saved.definition },
        ]),
      ),
    );
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
  if (!packId)
    return (
      <>
        <Button disabled>장면 편집기에서 이야기 만들기 →</Button>
        <p className={s.small}>캐릭터를 저장한 뒤 팩 이야기를 작성할 수 있어요.</p>
      </>
    );
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
          <Textarea
            layout="flexible"
            fill
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
              <TextInput
                fill
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
                label="생성 대화에 공개"
              />
              <Button
                variant="ghost"
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
                <TextInput
                  fill
                  aria-label={`지식 ${index + 1} 이름`}
                  value={item.id}
                  onChange={(event) => patch({ id: event.target.value })}
                />
                <Textarea
                  layout="flexible"
                  fill
                  aria-label={`지식 ${index + 1} 키워드`}
                  rows={2}
                  value={item.keywords.join("\n")}
                  onChange={(event) => patch({ keywords: entries(event.target.value) })}
                />
                <Textarea
                  layout="flexible"
                  fill
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
                    label={definition.name}
                  />
                ))}
                <Textarea
                  layout="flexible"
                  fill
                  aria-label={`지식 ${index + 1} 공개 조건`}
                  rows={2}
                  value={item.requiredFlags.join("\n")}
                  onChange={(event) => patch({ requiredFlags: entries(event.target.value) })}
                />
                <Button
                  variant="ghost"
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
        <section aria-label="이야기">
          <h4>이야기</h4>
          <Button
            disabled={!isDesktop() || characterDirty}
            onClick={() => {
              void command("open_story_editor", { packId, scenarioId: "" }).catch(
                (cause: unknown) => setError(errorText(cause)),
              );
            }}
          >
            장면 편집기에서 이야기 만들기 →
          </Button>
          <p className={s.small}>장을 잇고 대사를 써요 · 별도 창에서 열려요</p>
          {characterDirty && <p className={s.small}>캐릭터를 저장한 뒤 열 수 있어요.</p>}
          <p className={s.small}>이야기 {editor.definition.scenarios.length}개</p>
        </section>
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
        variant="confirm"
        onOpenChange={setConfirmReload}
        footer={
          <>
            <Button onClick={() => setConfirmReload(false)}>계속 편집</Button>
            <Button
              onClick={() => {
                setConfirmReload(false);
                void load();
              }}
            >
              초안을 버리고 최신 내용 확인
            </Button>
          </>
        }
      >
        <p>작성 중인 이 팩의 이야기와 지식을 버리고 저장된 내용을 불러와요.</p>
      </Dialog>
    </section>
  );
}
