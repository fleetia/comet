import { useRef, useState, type JSX } from "react";
import { Button, Select, Tabs, TabList, Tab, TabPanel } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import type { CharacterDefinition, InstalledCharacter, Snapshot } from "../types";
import { CharacterEditor, EXPRESSIONS } from "./CharacterEditor";
import { CharacterDialogueEditor } from "./CharacterDialogueEditor";
import { CharacterSharing } from "./CharacterSharing";
import { WindowHeader } from "./WindowHeader";
import { TalkEditor } from "./TalkEditor";
import * as ui from "../lagrange.css";
import * as s from "./characters.css";

type Props = { snapshot: Snapshot };
const NEW_ID = "new-character";
const MAX_ROSTER = 8;
function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
function newDefinition(): CharacterDefinition {
  return {
    sourceId: crypto.randomUUID(),
    version: 1,
    name: "",
    description: "",
    personality: "",
    expressions: Object.fromEntries(EXPRESSIONS.map((value) => [value, value])),
    faceIcon: false,
    spriteSize: 64,
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
  const [talkPending, setTalkPending] = useState(false);
  const [talkDirty, setTalkDirty] = useState(false);
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
  const operationPending = pending || dialoguePending || sharingPending || talkPending;
  const busy = operationPending || dialogueDirty || talkDirty;
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
  const position = active.indexOf(selectedId);
  const together = position >= 0;
  async function applyRoster(ids: string[], message: string): Promise<void> {
    await command("apply_character_roster", { ids });
    setNotice(message);
  }
  const dialogueIds = scope === "pair" && active.length > 1 ? active : [selectedId];
  const dialogueExpressions = [
    ...new Set(
      dialogueIds.flatMap((id) =>
        Object.keys(
          installed.find((character) => character.id === id)?.definition.expressions ?? {},
        ),
      ),
    ),
  ];
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
          <p className={ui.eyebrow}>comet / CHARACTERS</p>
          <h1 className={ui.settingsTitle}>캐릭터 관리</h1>
          <p className={ui.quiet}>바탕화면에서 함께 지낼 친구를 고르고 순서를 정해요.</p>
        </div>
      </WindowHeader>
      {(error || notice) && (
        <p className={error ? ui.error : ui.success} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      <p className={ui.quiet}>
        함께 지내는 친구 {active.length}명:{" "}
        {active
          .map((id) => installed.find((character) => character.id === id)?.definition.name ?? id)
          .join(" · ")}
      </p>
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
                {active.includes(character.id)
                  ? `${active.indexOf(character.id) + 1}번째로 함께 지내는 중`
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
                    {together ? (
                      <>
                        <Button
                          variant="secondary"
                          disabled={busy || position === 0}
                          onClick={() =>
                            void run(() =>
                              applyRoster(
                                moved(active, position, position - 1),
                                "앞으로 옮겼어요.",
                              ),
                            )
                          }
                        >
                          앞으로
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || position === active.length - 1}
                          onClick={() =>
                            void run(() =>
                              applyRoster(moved(active, position, position + 1), "뒤로 옮겼어요."),
                            )
                          }
                        >
                          뒤로
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || active.length === 1}
                          onClick={() =>
                            void run(() =>
                              applyRoster(
                                active.filter((id) => id !== selectedId),
                                "바탕화면에서 쉬어요. 기록과 친밀도는 보관해요.",
                              ),
                            )
                          }
                        >
                          내보내기
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={busy || dirty || active.length >= MAX_ROSTER}
                        onClick={() =>
                          void run(() =>
                            applyRoster(
                              [...active, selectedId],
                              "함께 지내기 시작했어요. 이전 기록과 친밀도는 보관해요.",
                            ),
                          )
                        }
                      >
                        함께 지내기
                      </Button>
                    )}
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
                  {together && active.length === 1 && (
                    <p className={ui.quiet}>
                      마지막 친구는 내보낼 수 없어요. 다른 친구를 먼저 함께 지내게 해 주세요.
                    </p>
                  )}
                  {!together && active.length >= MAX_ROSTER && (
                    <p className={ui.quiet}>함께 지낼 수 있는 친구는 최대 {MAX_ROSTER}명이에요.</p>
                  )}
                  {together && (
                    <p className={ui.quiet}>같은 친구를 두 번 두려면 복사본을 만들어 주세요.</p>
                  )}
                  {dirty && (
                    <p className={ui.quiet}>바뀐 내용을 저장한 뒤 적용하거나 공유해 주세요.</p>
                  )}
                </section>
              )}
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  if (!talkDirty && !talkPending) setTab(value);
                }}
                className={s.workspace}
              >
                <TabList aria-label="캐릭터 작업">
                  <Tab value="basics">기본 정보</Tab>
                  <Tab value="dialogue" disabled={!selected}>
                    등록 대사
                  </Tab>
                  <Tab value="sharing" disabled={!selected}>
                    공유
                  </Tab>
                  <Tab value="talk">대본 에디터</Tab>
                </TabList>
                {!selected && (
                  <p className={ui.quiet}>캐릭터를 저장하면 등록 대사와 공유를 사용할 수 있어요.</p>
                )}
                <TabPanel value="talk">
                  {tab === "talk" && (
                    <TalkEditor onDirtyChange={setTalkDirty} onPendingChange={setTalkPending} />
                  )}
                </TabPanel>
                <TabPanel value="basics">
                  <p className={s.tabIntro}>이름·성격·표정과 인사·개별 자동 수다를 편집해요.</p>
                  <CharacterEditor
                    definition={definition}
                    character={selected}
                    onChange={(value) =>
                      setDrafts((values) => ({ ...values, [selectedId]: value }))
                    }
                    onSprite={(expression, remove) =>
                      void run(async () => {
                        if (remove) {
                          await command("remove_character_sprite", { id: selectedId, expression });
                          setNotice(`${expression} 표정 이미지를 제거했어요.`);
                          return;
                        }
                        const chosen = await command<boolean>("choose_character_sprite", {
                          id: selectedId,
                          expression,
                        });
                        if (chosen) setNotice(`${expression} 표정 이미지를 저장했어요.`);
                      })
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

                  {selected && (
                    <section className={s.section}>
                      {removeId === selectedId ? (
                        <>
                          <p className={ui.quiet}>
                            이 캐릭터를 목록에서 제거해요. 함께 지내던 친구면 바탕화면에서도 빠지고,
                            대화 기록과 관계는 보존해요. 마지막 친구는 다른 친구를 먼저 함께 지내게
                            한 뒤 제거할 수 있어요.
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
                          disabled={
                            busy || dirty || (active.length === 1 && active[0] === selectedId)
                          }
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
                            <option value="pair" disabled={active.length < 2}>
                              함께 지내는 친구들의 조합
                            </option>
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
                        expressions={dialogueExpressions}
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
