import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Select, TextArea } from "@fleetia/lagrange";
import { command, errorText } from "../../hooks/useSnapshot";
import type { CharacterDialogue, SceneLine, WordbookEntry } from "../../types";
import { WordbookPanel } from "../WordbookPanel/WordbookPanel";
import { EXPRESSIONS } from "../CharacterEditor/CharacterEditor";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";

type Props = {
  ids: string[];
  expressions?: string[];
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
};
export function CharacterDialogueEditor({
  ids,
  expressions = EXPRESSIONS,
  onDirtyChange,
  onPendingChange,
}: Props): JSX.Element {
  const [dialogue, setDialogue] = useState<CharacterDialogue | null>(null);
  const [scenes, setScenes] = useState<SceneLine[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [wordbookDirty, setWordbookDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const key = ids.join(":");
  useEffect(() => {
    let active = true;
    setError(null);
    void command<CharacterDialogue>("get_character_dialogue", { ids })
      .then((value) => {
        if (active) {
          setDialogue(value);
          setScenes(value.pairScenes);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [key, revision]);
  useEffect(() => {
    onDirtyChange(dirty || wordbookDirty || pending);
  }, [dirty, wordbookDirty, pending, onDirtyChange]);
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
  function changeScene(index: number, lines: SceneLine[]): void {
    setScenes((values) => values.map((value, i) => (i === index ? lines : value)));
    setDirty(true);
  }
  if (!dialogue)
    return (
      <section className={s.section}>
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
  return (
    <div>
      <WordbookPanel
        title={ids.length === 1 ? "이 캐릭터의 키워드 대사" : "현재 친구들의 키워드 대사"}
        description="개인 단어장과 별도로 저장해요. 개인 단어장을 먼저 찾은 뒤 이 대사를 사용해요. 수정 중에는 대상을 바꿀 수 없어요."
        entries={dialogue.wordbook}
        singleCharacter={ids.length === 1}
        speakerCount={ids.length}
        saveEntry={saveEntry}
        deleteEntry={deleteEntry}
        onDirtyChange={setWordbookDirty}
      />
      {ids.length > 1 && (
        <section className={s.section}>
          <h3 className={s.subheading}>조합의 자동 수다</h3>
          <fieldset disabled={pending} className={s.fieldset}>
            {scenes.map((lines, sceneIndex) => (
              <div className={s.line} key={sceneIndex}>
                <div className={ui.row}>
                  <strong>장면 {sceneIndex + 1}</strong>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setScenes(scenes.filter((_, i) => i !== sceneIndex));
                      setDirty(true);
                    }}
                  >
                    장면 {sceneIndex + 1} 삭제
                  </Button>
                </div>
                {lines.map((line, index) => (
                  <div className={s.line} key={index}>
                    <div className={ui.row}>
                      <Select
                        style={{ width: 70 }}
                        aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 화자`}
                        value={line.persona}
                        onChange={(event) =>
                          changeScene(
                            sceneIndex,
                            lines.map((value, i) =>
                              i === index ? { ...value, persona: event.target.value } : value,
                            ),
                          )
                        }
                      >
                        {ids.map((_, index) => (
                          <option key={index} value={String.fromCharCode(97 + index)}>
                            {String.fromCharCode(65 + index)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        style={{ width: 100 }}
                        aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 표정`}
                        value={line.expression}
                        onChange={(event) =>
                          changeScene(
                            sceneIndex,
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
                        disabled={index === 0}
                        aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 위로`}
                        onClick={() => {
                          const next = [...lines];
                          [next[index - 1], next[index]] = [next[index], next[index - 1]];
                          changeScene(sceneIndex, next);
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={lines.length === 1}
                        aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1} 삭제`}
                        onClick={() =>
                          changeScene(
                            sceneIndex,
                            lines.filter((_, i) => i !== index),
                          )
                        }
                      >
                        삭제
                      </Button>
                    </div>
                    <TextArea
                      className={s.textarea}
                      aria-label={`장면 ${sceneIndex + 1} 대사 ${index + 1}`}
                      maxLength={500}
                      value={line.text}
                      onChange={(event) =>
                        changeScene(
                          sceneIndex,
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
                  disabled={lines.length >= 8}
                  onClick={() =>
                    changeScene(sceneIndex, [
                      ...lines,
                      {
                        persona: lines.at(-1)?.persona === "a" ? "b" : "a",
                        expression: "평온",
                        text: "",
                      },
                    ])
                  }
                >
                  장면 {sceneIndex + 1} 대사 추가
                </Button>
              </div>
            ))}
            <div className={ui.row}>
              <Button
                variant="secondary"
                disabled={scenes.length >= 64}
                onClick={() => {
                  setScenes([...scenes, [{ persona: "a", expression: "평온", text: "" }]]);
                  setDirty(true);
                }}
              >
                장면 추가
              </Button>
              <Button
                variant="primary"
                disabled={!dirty || scenes.some((lines) => lines.some((line) => !line.text.trim()))}
                onClick={() => {
                  setError(null);
                  void save({ ...dialogue, pairScenes: scenes })
                    .then(() => setDirty(false))
                    .catch((cause: unknown) => setError(errorText(cause)));
                }}
              >
                둘의 수다 저장
              </Button>
              {dirty && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setScenes(dialogue.pairScenes);
                    setDirty(false);
                  }}
                >
                  수다 수정 취소
                </Button>
              )}
            </div>
          </fieldset>
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
