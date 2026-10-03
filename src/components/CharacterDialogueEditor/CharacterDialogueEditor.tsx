import { useEffect, useRef, useState, type JSX } from "react";
import { ActionBar, Button, Select, SelectableListRow, Surface, TextArea } from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type { CharacterDialogue, InstalledCharacter, SceneLine, WordbookEntry } from "../../types";
import { MotionSelect, motionError, motionOwner } from "../MotionSelect/MotionSelect";
import { WordbookPanel } from "../WordbookPanel/WordbookPanel";
import { EXPRESSIONS } from "../CharacterEditor/CharacterEditor";
import { CharacterWorkPanel } from "../CharacterEditor/CharacterWorkPanel";
import * as ui from "../../lagrange.css";
import * as common from "../characters.css";
import * as s from "./CharacterDialogueEditor.css";

type Props = {
  ids: string[];
  expressions?: string[];
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  compact?: boolean;
  mode?: "keyword" | "scenes";
  owners?: (InstalledCharacter | undefined)[];
};
type SceneDraft = { id: string; lines: SceneLine[] };

export function CharacterDialogueEditor({
  ids,
  expressions = EXPRESSIONS,
  onDirtyChange,
  onPendingChange,
  mode,
  owners = [],
}: Props): JSX.Element {
  const [dialogue, setDialogue] = useState<CharacterDialogue | null>(null);
  const [scenes, setScenes] = useState<SceneDraft[]>([]);
  const [baselineOrder, setBaselineOrder] = useState<string[]>([]);
  const [removedDrafts, setRemovedDrafts] = useState<Record<string, SceneDraft>>({});
  const [baselineLines, setBaselineLines] = useState<Record<string, SceneLine[]>>({});
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wordbookDirty, setWordbookDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const key = ids.join(":");
  useEffect(() => {
    let active = true;
    setError(null);
    void command<CharacterDialogue>("get_character_dialogue", { ids })
      .then((value) => {
        if (!active) return;
        const initial = value.pairScenes.map((lines) => ({ id: crypto.randomUUID(), lines }));
        setDialogue(value);
        setRemovedDrafts({});
        setScenes(initial);
        setBaselineOrder(initial.map((scene) => scene.id));
        setBaselineLines(Object.fromEntries(initial.map((scene) => [scene.id, scene.lines])));
        setSelectedId(initial[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [key, revision]);
  const hasStructureChanges = scenes.map((scene) => scene.id).join(":") !== baselineOrder.join(":");
  const hasSceneChanges = scenes.some(
    (scene) => JSON.stringify(scene.lines) !== JSON.stringify(baselineLines[scene.id]),
  );
  useEffect(() => {
    onDirtyChange(hasStructureChanges || hasSceneChanges || wordbookDirty || pending);
  }, [hasStructureChanges, hasSceneChanges, wordbookDirty, pending, onDirtyChange]);
  async function save(next: CharacterDialogue): Promise<void> {
    if (lock.current) throw new Error("다른 대사를 저장하고 있어요. 잠시 후 다시 시도해 주세요.");
    lock.current = true;
    setPending(true);
    onPendingChange?.(true);
    try {
      await command("save_character_dialogue", { ids, dialogue: next });
      setDialogue(next);
    } finally {
      lock.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }
  async function saveEntry(entry: WordbookEntry): Promise<void> {
    if (!dialogue) return;
    const exists = dialogue.wordbook.some((value) => value.id === entry.id);
    await save({
      ...dialogue,
      wordbook: exists
        ? dialogue.wordbook.map((value) => (value.id === entry.id ? entry : value))
        : [...dialogue.wordbook, entry],
    });
  }
  async function deleteEntry(id: string): Promise<void> {
    if (dialogue)
      await save({ ...dialogue, wordbook: dialogue.wordbook.filter((entry) => entry.id !== id) });
  }
  const selected = scenes.find((scene) => scene.id === selectedId) ?? scenes[0];
  const sceneIndex = scenes.findIndex((scene) => scene.id === selected?.id);
  const selectedDirty =
    selected && JSON.stringify(selected.lines) !== JSON.stringify(baselineLines[selected.id]);
  function validLines(lines: SceneLine[]): boolean {
    return (
      lines.length > 0 &&
      lines.every(
        (line) =>
          Boolean(line.text.trim()) &&
          !motionError(
            line.motion,
            motionOwner(line.persona, owners)?.definition.animation?.clips ?? [],
          ),
      )
    );
  }
  function changeScene(lines: SceneLine[]): void {
    if (!selected) return;
    setScenes((values) =>
      values.map((scene) => (scene.id === selected.id ? { ...scene, lines } : scene)),
    );
  }
  function addScene(): void {
    const scene = {
      id: crypto.randomUUID(),
      lines: [{ persona: "a", expression: "평온", text: "" }],
    };
    setScenes((values) => [...values, scene]);
    setSelectedId(scene.id);
  }
  function cancelSelected(): void {
    if (!selected) return;
    const baseline = baselineLines[selected.id];
    if (baseline) {
      setScenes((values) =>
        values.map((scene) => (scene.id === selected.id ? { ...scene, lines: baseline } : scene)),
      );
      return;
    }
    setScenes((values) => values.filter((scene) => scene.id !== selected.id));
    setSelectedId(scenes.find((scene) => scene.id !== selected.id)?.id ?? "");
  }
  async function saveSelected(): Promise<void> {
    if (!dialogue || !selected || !validLines(selected.lines)) return;
    setError(null);
    const nextOrder = baselineOrder.includes(selected.id)
      ? baselineOrder
      : [...baselineOrder, selected.id];
    const nextLines = { ...baselineLines, [selected.id]: selected.lines };
    try {
      await save({ ...dialogue, pairScenes: nextOrder.map((id) => nextLines[id]) });
      setBaselineOrder(nextOrder);
      setBaselineLines(nextLines);
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  async function saveAll(): Promise<void> {
    if (!dialogue || !scenes.every((scene) => validLines(scene.lines))) return;
    setError(null);
    try {
      await save({ ...dialogue, pairScenes: scenes.map((scene) => scene.lines) });
      setRemovedDrafts({});
      setBaselineOrder(scenes.map((scene) => scene.id));
      setBaselineLines(Object.fromEntries(scenes.map((scene) => [scene.id, scene.lines])));
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  function cancelStructure(): void {
    setScenes(
      baselineOrder.map(
        (id) =>
          scenes.find((scene) => scene.id === id) ??
          removedDrafts[id] ?? { id, lines: baselineLines[id] },
      ),
    );
    setRemovedDrafts({});
    setSelectedId(baselineOrder.includes(selectedId) ? selectedId : (baselineOrder[0] ?? ""));
  }
  function moveScene(offset: number): void {
    if (sceneIndex < 0 || sceneIndex + offset < 0 || sceneIndex + offset >= scenes.length) return;
    const next = [...scenes];
    [next[sceneIndex], next[sceneIndex + offset]] = [next[sceneIndex + offset], next[sceneIndex]];
    setScenes(next);
  }
  if (!dialogue)
    return (
      <section>
        <p role="status">{error ? "등록 대사를 불러오지 못했어요." : "등록 대사 불러오는 중…"}</p>
        {error && (
          <>
            <p role="alert" className={ui.error}>
              {error}
            </p>
            <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>
              다시 불러오기
            </Button>
          </>
        )}
      </section>
    );
  const sceneActions = (
    <>
      {selected && (
        <ActionBar status={selectedDirty ? "선택한 장면 변경사항 있음" : "저장된 장면"}>
          <Button variant="quiet" disabled={pending || !selectedDirty} onClick={cancelSelected}>
            장면 수정 취소
          </Button>
          <Button
            variant="primary"
            disabled={pending || !selectedDirty || !validLines(selected.lines)}
            onClick={() => void saveSelected()}
          >
            이 장면 저장
          </Button>
        </ActionBar>
      )}
      {hasStructureChanges && (
        <ActionBar status="추가·삭제·순서 변경과 모든 장면 초안을 함께 저장해요.">
          <Button variant="quiet" disabled={pending} onClick={cancelStructure}>
            구성 수정 취소
          </Button>
          <Button
            variant="primary"
            disabled={pending || !scenes.every((scene) => validLines(scene.lines))}
            onClick={() => void saveAll()}
          >
            조합 전체 저장
          </Button>
        </ActionBar>
      )}
    </>
  );
  return (
    <div className={s.editor}>
      <div hidden={mode === "scenes"} className={s.ownerPanel}>
        <WordbookPanel
          title={ids.length === 1 ? "이 캐릭터의 키워드 대사" : "현재 친구들의 키워드 대사"}
          description="개인 단어장 다음에 찾는 등록 대사예요. 항목마다 따로 저장해요."
          entries={dialogue.wordbook}
          owners={owners}
          singleCharacter={ids.length === 1}
          speakerCount={ids.length}
          saveEntry={saveEntry}
          deleteEntry={deleteEntry}
          onDirtyChange={setWordbookDirty}
          highlight={false}
        />
      </div>
      {ids.length > 1 && (
        <section hidden={mode === "keyword"} className={s.ownerPanel} aria-label="조합의 자동 수다">
          <div className={s.sceneLayout}>
            <CharacterWorkPanel
              role="complementary"
              aria-label="조합 장면 목록"
              className={s.sceneList}
            >
              <h3 className={common.subheading}>장면 · {scenes.length}개</h3>
              {scenes.map((scene, index) => (
                <SelectableListRow
                  key={scene.id}
                  selected={scene.id === selected?.id}
                  className={s.sceneRow}
                  aria-label={`장면 ${index + 1} 선택`}
                  disabled={pending}
                  onClick={() => setSelectedId(scene.id)}
                >
                  <strong>
                    장면 {index + 1}
                    {JSON.stringify(scene.lines) !== JSON.stringify(baselineLines[scene.id])
                      ? " · 미저장"
                      : ""}
                  </strong>
                  <span>{scene.lines[0]?.text || "새 장면"}</span>
                </SelectableListRow>
              ))}
              <Button
                variant="secondary"
                disabled={pending || scenes.length >= 64}
                onClick={addScene}
              >
                장면 추가
              </Button>
            </CharacterWorkPanel>
            <CharacterWorkPanel footer={sceneActions}>
              {selected ? (
                <fieldset disabled={pending} className={common.fieldset}>
                  <div className={s.sceneHeading}>
                    <h3 className={common.subheading}>장면 {sceneIndex + 1}</h3>
                    <span className={common.small}>현재 함께 지내는 조합</span>
                  </div>
                  <Surface tone="accent" className={s.preview} aria-label="장면 미리보기">
                    {selected.lines.map((line, index) => (
                      <p key={index}>
                        <strong>
                          {motionOwner(line.persona, owners)?.definition.name ??
                            line.persona.toUpperCase()}
                        </strong>{" "}
                        · {line.text || "대사를 입력해 주세요."}
                      </p>
                    ))}
                  </Surface>
                  {selected.lines.map((line, index) => (
                    <div className={s.line} key={index}>
                      <div className={ui.row}>
                        <Select
                          aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 화자`}
                          value={line.persona}
                          onChange={(event) =>
                            changeScene(
                              selected.lines.map((value, i) =>
                                i === index
                                  ? {
                                      ...value,
                                      persona: event.target.value,
                                      motion:
                                        value.motion?.mode === "clip" ? undefined : value.motion,
                                    }
                                  : value,
                              ),
                            )
                          }
                        >
                          {ids.map((_, ownerIndex) => (
                            <option key={ownerIndex} value={String.fromCharCode(97 + ownerIndex)}>
                              {owners[ownerIndex]?.definition.name ??
                                String.fromCharCode(65 + ownerIndex)}
                            </option>
                          ))}
                        </Select>
                        <Select
                          aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 표정`}
                          value={line.expression}
                          onChange={(event) =>
                            changeScene(
                              selected.lines.map((value, i) =>
                                i === index ? { ...value, expression: event.target.value } : value,
                              ),
                            )
                          }
                        >
                          {[
                            ...new Set([
                              ...Object.keys(
                                motionOwner(line.persona, owners)?.definition.expressions ?? {},
                              ),
                              ...expressions,
                              line.expression,
                            ]),
                          ].map((expression) => (
                            <option key={expression}>{expression}</option>
                          ))}
                        </Select>
                        <Button
                          variant="secondary"
                          disabled={index === 0}
                          aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 위로`}
                          onClick={() => {
                            const next = [...selected.lines];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            changeScene(next);
                          }}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={selected.lines.length === 1}
                          aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 삭제`}
                          onClick={() => changeScene(selected.lines.filter((_, i) => i !== index))}
                        >
                          삭제
                        </Button>
                      </div>
                      <TextArea
                        className={common.textarea}
                        aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1}`}
                        maxLength={500}
                        value={line.text}
                        onChange={(event) =>
                          changeScene(
                            selected.lines.map((value, i) =>
                              i === index ? { ...value, text: event.target.value } : value,
                            ),
                          )
                        }
                      />
                      <MotionSelect
                        label={`장면 ${sceneIndex + 1} 대사 ${index + 1}`}
                        value={line.motion}
                        clips={motionOwner(line.persona, owners)?.definition.animation?.clips ?? []}
                        onChange={(motion) =>
                          changeScene(
                            selected.lines.map((value, i) =>
                              i === index ? { ...value, motion } : value,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={selected.lines.length >= 8}
                    onClick={() =>
                      changeScene([
                        ...selected.lines,
                        {
                          persona: selected.lines.at(-1)?.persona === "a" ? "b" : "a",
                          expression: "평온",
                          text: "",
                        },
                      ])
                    }
                  >
                    장면 {sceneIndex + 1} 대사 추가
                  </Button>

                  <div className={s.structureActions}>
                    <Button
                      variant="secondary"
                      disabled={sceneIndex === 0}
                      onClick={() => moveScene(-1)}
                    >
                      장면 위로
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={sceneIndex === scenes.length - 1}
                      onClick={() => moveScene(1)}
                    >
                      장면 아래로
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setRemovedDrafts((previous) => ({ ...previous, [selected.id]: selected }));
                        setScenes((values) => values.filter((scene) => scene.id !== selected.id));
                        setSelectedId(scenes.find((scene) => scene.id !== selected.id)?.id ?? "");
                      }}
                    >
                      장면 {sceneIndex + 1} 삭제
                    </Button>
                  </div>
                </fieldset>
              ) : (
                <p className={common.small}>장면을 추가해 조합의 수다를 만들어 보세요.</p>
              )}
            </CharacterWorkPanel>
          </div>
        </section>
      )}
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
