import { useRef, useState, type JSX } from "react";
import { Button, Select, Tabs, TabList, Tab, TabPanel } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import type { CharacterDefinition, InstalledCharacter, Snapshot } from "../types";
import { CharacterEditor, EXPRESSIONS } from "./CharacterEditor";
import { CharacterDialogueEditor } from "./CharacterDialogueEditor";
import { CharacterSharing } from "./CharacterSharing";
import { WindowHeader } from "./WindowHeader";
import * as ui from "../lagrange.css";
import * as s from "./characters.css";

type Props = { snapshot: Snapshot };
const NEW_ID = "new-character";
function newDefinition(): CharacterDefinition {
  return {
    sourceId: crypto.randomUUID(),
    version: 1,
    name: "",
    description: "",
    personality: "",
    expressions: Object.fromEntries(EXPRESSIONS.map((value) => [value, value])),
    greeting: [{ expression: "평온", text: "안녕. 만나서 반가워." }],
    idleLines: [{ expression: "평온", text: "잠깐 쉬어 갈까?" }],
  };
}
export function CharacterManager({ snapshot }: Props): JSX.Element {
  const { installed, active } = snapshot.characters;
  const [selectedId, setSelectedId] = useState(installed[0]?.id ?? NEW_ID);
  const [drafts, setDrafts] = useState<Record<string, CharacterDefinition>>({});
  const [pending, setPending] = useState(false);
  const [dialoguePending, setDialoguePending] = useState(false);
  const [sharingPending, setSharingPending] = useState(false);
  const [dialogueDirty, setDialogueDirty] = useState(false);
  const [dialogueVersion, setDialogueVersion] = useState(0);
  const [tab, setTab] = useState("basics");
  const [scope, setScope] = useState<"single" | "pair">("single");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const selected = installed.find((character) => character.id === selectedId);
  const definition = drafts[selectedId] ?? selected?.definition;
  const dirty = Boolean(drafts[selectedId]);
  const operationPending = pending || dialoguePending || sharingPending;
  const busy = operationPending || dialogueDirty;
  async function run(action: () => Promise<void>): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function select(id: string): void {
    setSelectedId(id);
    setTab("basics");
    setError(null);
    setNotice(null);
    setRemoveId(null);
  }
  async function save(): Promise<void> {
    if (!definition) return;
    await run(async () => {
      if (selectedId === NEW_ID) {
        const created = await command<InstalledCharacter>("create_character", { definition });
        setSelectedId(created.id);
      } else await command("save_character", { id: selectedId, definition });
      setDrafts((values) => {
        const next = { ...values };
        delete next[selectedId];
        return next;
      });
      setNotice("캐릭터를 저장했어요.");
    });
  }
  const dialogueIds = scope === "pair" ? active : [selectedId];
  return (
    <main className={s.page}>
      <WindowHeader
        className={s.header}
        label="캐릭터 관리 닫기"
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              if (!isDesktop()) {
                window.location.assign("?view=settings");
                return;
              }
              void run(() => command("open_settings"));
            }}
            disabled={busy}
          >
            설정
          </Button>
        }
      >
        <div>
          <p className={ui.eyebrow}>COMET / CHARACTERS</p>
          <h1 className={ui.settingsTitle}>캐릭터 관리</h1>
          <p className={ui.quiet}>바탕화면의 작은 두 자리에 함께 지낼 친구를 골라요.</p>
        </div>
      </WindowHeader>
      {(error || notice) && (
        <p className={error ? ui.error : ui.success} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      <div className={ui.row}>
        <span className={ui.quiet}>
          A: {installed.find((character) => character.id === active[0])?.definition.name} · B:{" "}
          {installed.find((character) => character.id === active[1])?.definition.name}
        </span>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await command("apply_character_pair", { ids: [active[1], active[0]] });
              setNotice("둘의 자리를 바꿨어요.");
            })
          }
        >
          둘의 자리 바꾸기
        </Button>
      </div>
      <div className={s.layout}>
        <aside className={s.list} aria-label="설치된 캐릭터">
          {installed.map((character) => (
            <Button
              variant="quiet"
              className={s.item}
              key={character.id}
              aria-pressed={selectedId === character.id}
              disabled={busy}
              onClick={() => select(character.id)}
            >
              {drafts[character.id]?.name || character.definition.name}
              {drafts[character.id] ? " · 미저장" : ""}
              <span className={s.small}>
                {active[0] === character.id
                  ? "A에서 함께 지내는 중"
                  : active[1] === character.id
                    ? "B에서 함께 지내는 중"
                    : `버전 ${character.definition.version}`}
              </span>
            </Button>
          ))}
          {drafts[NEW_ID] && (
            <Button
              variant="quiet"
              className={s.item}
              aria-pressed={selectedId === NEW_ID}
              disabled={busy}
              onClick={() => select(NEW_ID)}
            >
              새 캐릭터 · 미저장
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDrafts((values) => ({ ...values, [NEW_ID]: values[NEW_ID] ?? newDefinition() }));
              select(NEW_ID);
            }}
          >
            새 캐릭터 만들기
          </Button>
          {dialogueDirty && (
            <p className={ui.quiet}>대사 수정을 저장하거나 취소한 뒤 대상을 바꿔 주세요.</p>
          )}
        </aside>
        <div>
          {definition ? (
            <>
              {selected && (
                <section aria-label="선택 캐릭터 적용">
                  <h2 className={s.subheading}>{selected.definition.name}</h2>
                  <div className={ui.row}>
                    {(["a", "b"] as const).map((persona, index) => (
                      <Button
                        variant="secondary"
                        key={persona}
                        disabled={busy || dirty || active.includes(selectedId)}
                        onClick={() =>
                          void run(async () => {
                            await command("assign_character", { persona, id: selectedId });
                            setNotice(
                              `${persona.toUpperCase()}에 적용했어요. 이전 친구의 기록과 친밀도는 보관해요.`,
                            );
                          })
                        }
                      >
                        {active[index] === selectedId
                          ? `${persona.toUpperCase()}에 적용 중`
                          : `${persona.toUpperCase()}에 적용`}
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      disabled={busy || dirty}
                      onClick={() =>
                        void run(async () => {
                          const created = await command<InstalledCharacter>("clone_character", {
                            id: selectedId,
                          });
                          select(created.id);
                          setNotice("별도의 관계를 가진 복사본을 만들었어요.");
                        })
                      }
                    >
                      복사본 만들기
                    </Button>
                  </div>
                  {active.includes(selectedId) && (
                    <p className={ui.quiet}>
                      자리를 옮기려면 위의 ‘둘의 자리 바꾸기’를 사용해 주세요. 같은 친구를 두 자리에
                      함께 두려면 복사본을 만들어 주세요.
                    </p>
                  )}
                  {dirty && (
                    <p className={ui.quiet}>바뀐 내용을 저장한 뒤 적용하거나 공유해 주세요.</p>
                  )}
                </section>
              )}
              <Tabs value={tab} onValueChange={setTab} className={s.workspace}>
                <TabList aria-label="캐릭터 작업">
                  <Tab value="basics">기본 정보</Tab>
                  <Tab value="dialogue" disabled={!selected}>
                    등록 대사
                  </Tab>
                  <Tab value="sharing" disabled={!selected}>
                    공유
                  </Tab>
                </TabList>
                {!selected && (
                  <p className={ui.quiet}>캐릭터를 저장하면 등록 대사와 공유를 사용할 수 있어요.</p>
                )}
                <TabPanel value="basics">
                  <p className={s.tabIntro}>이름·성격·표정과 인사·개별 자동 수다를 편집해요.</p>
                  <CharacterEditor
                    definition={definition}
                    onChange={(value) =>
                      setDrafts((values) => ({ ...values, [selectedId]: value }))
                    }
                    onSave={() => void save()}
                    onCancel={() => {
                      setDrafts((values) => {
                        const next = { ...values };
                        delete next[selectedId];
                        return next;
                      });
                      if (selectedId === NEW_ID) select(installed[0]?.id ?? NEW_ID);
                    }}
                    pending={operationPending}
                    dirty={dirty}
                  />

                  {selected && !selectedId.startsWith("builtin-") && (
                    <section className={s.section}>
                      {removeId === selectedId ? (
                        <>
                          <p className={ui.quiet}>
                            이 캐릭터를 목록에서 제거해요. 사용 중인 자리는 기본 친구로 돌아가며
                            대화 기록과 관계는 보존해요.
                          </p>
                          <div className={ui.row}>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await command("remove_character", { id: selectedId });
                                  select(
                                    installed.find((character) => character.id !== selectedId)
                                      ?.id ?? NEW_ID,
                                  );
                                  setNotice("목록에서 제거했어요.");
                                })
                              }
                            >
                              목록에서 제거 확인
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setRemoveId(null)}
                            >
                              취소
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          disabled={busy || dirty}
                          onClick={() => setRemoveId(selectedId)}
                        >
                          목록에서 제거
                        </Button>
                      )}
                    </section>
                  )}
                </TabPanel>
                {selected && (
                  <>
                    <TabPanel value="dialogue">
                      <p className={s.tabIntro}>
                        키워드에 반응하는 대사를 등록해요. 대상을 현재 둘로 바꾸면 둘의 장면도
                        편집할 수 있어요. 인사와 개별 자동 수다는 기본 정보에서 바꿔요.
                      </p>
                      <div className={ui.row}>
                        <label>
                          등록 대사 대상{" "}
                          <Select
                            value={scope}
                            disabled={busy}
                            onChange={(event) =>
                              setScope(event.target.value === "pair" ? "pair" : "single")
                            }
                          >
                            <option value="single">선택한 캐릭터 하나</option>
                            <option value="pair">현재 A/B 둘의 조합</option>
                          </Select>
                        </label>
                        {dialogueDirty && (
                          <Button
                            variant="secondary"
                            disabled={operationPending}
                            onClick={() => {
                              setDialogueVersion((value) => value + 1);
                              setDialogueDirty(false);
                            }}
                          >
                            대사 수정 취소
                          </Button>
                        )}
                      </div>
                      <CharacterDialogueEditor
                        key={`${dialogueIds.join(":")}:${dialogueVersion}`}
                        ids={dialogueIds}
                        onDirtyChange={setDialogueDirty}
                        onPendingChange={setDialoguePending}
                      />
                    </TabPanel>
                    <TabPanel value="sharing">
                      <CharacterSharing
                        snapshot={snapshot}
                        selectedId={selectedId}
                        onPendingChange={setSharingPending}
                        disabled={busy || dirty}
                      />
                    </TabPanel>
                  </>
                )}
              </Tabs>
            </>
          ) : (
            <p className={ui.quiet} role="status">
              캐릭터 목록을 준비하고 있어요.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
