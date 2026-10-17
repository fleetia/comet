import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { Dialog } from "@comet/ui";
import { Button, Select } from "../../ui";
import { FriendsLibrary } from "./FriendsLibrary";
import * as friends from "./friends.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  AnimationAsset,
  CharacterAnimation,
  CharacterDefinition,
  InstalledCharacter,
  InstalledCharacterPack,
  Snapshot,
} from "../../types";
import {
  CharacterEditor,
  EXPRESSIONS,
  type DialogueType,
} from "../CharacterEditor/CharacterEditor";
import { CharacterDialogueEditor } from "../CharacterDialogueEditor/CharacterDialogueEditor";
import { PackStoryEditor, type PackStoryDraft } from "../CharacterEditor/PackStoryEditor";
import { CharacterSharing, type SharingAction } from "../CharacterSharing/CharacterSharing";
import { CharacterPackSelector } from "../CharacterPackSelector/CharacterPackSelector";
import { MemorySettings } from "../MemorySettings/MemorySettings";
import { CharacterMemorySettings } from "../CharacterMemorySettings/CharacterMemorySettings";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import * as ui from "../../lagrange.css";
import * as s from "../characters.css";

type Props = {
  snapshot: Snapshot;
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  memoryTabRequest?: number;
};
type DialogueOwner = { key: string; ids: string[] };
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
    name: "",
    description: "",
    personality: "",
    instructions: "",
    relationships: [],
    expressions: Object.fromEntries(EXPRESSIONS.map((value) => [value, value])),
    faceIcon: false,
    spriteSize: 64,
    greeting: [{ expression: "평온", text: "안녕. 만나서 반가워." }],
    idleLines: [{ expression: "평온", text: "잠깐 쉬어 갈까?" }],
    departureLines: [{ expression: "평온", text: "잠깐 다녀올게." }],
    returnLines: [{ expression: "기쁨", text: "다녀왔어!" }],
  };
}

export function CharacterManager({
  snapshot,
  embedded = false,
  onDirtyChange,
  memoryTabRequest = 0,
}: Props): JSX.Element {
  const { installed: snapshotInstalled, active } = snapshot.characters;
  const [createdCharacters, setCreatedCharacters] = useState<InstalledCharacter[]>([]);
  const installed = [
    ...snapshotInstalled,
    ...createdCharacters.filter(
      (character) => !snapshotInstalled.some((saved) => saved.id === character.id),
    ),
  ];
  useEffect(() => {
    setCreatedCharacters((previous) => {
      const remaining = previous.filter(
        (character) => !snapshotInstalled.some((saved) => saved.id === character.id),
      );
      return remaining.length === previous.length ? previous : remaining;
    });
  }, [snapshotInstalled]);
  const packIds = [
    ...new Set(installed.flatMap((character) => (character.packId ? [character.packId] : []))),
  ]
    .sort()
    .join(":");
  const [packs, setPacks] = useState<InstalledCharacterPack[]>([]);
  useEffect(() => {
    if (!isDesktop() || !packIds) return;
    let live = true;
    void command<InstalledCharacterPack[]>("get_character_packs")
      .then((result) => {
        if (live && Array.isArray(result)) setPacks(result);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [packIds]);
  const [selectedId, setSelectedId] = useState(installed[0]?.id ?? NEW_ID);
  const [libraryOpen, setLibraryOpen] = useState(memoryTabRequest === 0);
  useEffect(() => {
    if (memoryTabRequest > 0) setLibraryOpen(false);
  }, [memoryTabRequest]);
  const [memoryOwners, setMemoryOwners] = useState<string[]>([]);
  const [memoryDirty, setMemoryDirty] = useState<Record<string, boolean>>({});
  const [memoryVersions, setMemoryVersions] = useState<Record<string, number>>({});
  const [exportScope, setExportScope] = useState<"selected" | "pair" | "pack">("selected");
  const [drafts, setDrafts] = useState<Record<string, CharacterDefinition>>({});
  const [storyDrafts, setStoryDrafts] = useState<Record<string, PackStoryDraft>>({});
  const [storyPending, setStoryPending] = useState(false);
  const [animationAssets, setAnimationAssets] = useState<
    Record<string, Record<string, AnimationAsset>>
  >({});
  const trialAssets = Object.fromEntries(
    Object.entries(animationAssets).map(([id, assets]) => [id, Object.values(assets)]),
  );
  const [animationVersions, setAnimationVersions] = useState<Record<string, number>>({});
  const animationPickerGeneration = useRef(0);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  useEffect(
    () => () => {
      animationPickerGeneration.current += 1;
    },
    [],
  );
  const [pendingTargets, setPendingTargets] = useState<Record<string, boolean>>({});
  const [dialoguePending, setDialoguePending] = useState<Record<string, boolean>>({});
  const [dialogueDirty, setDialogueDirty] = useState<Record<string, boolean>>({});
  const [dialogueVersions, setDialogueVersions] = useState<Record<string, number>>({});
  const [owners, setOwners] = useState<DialogueOwner[]>([]);
  const [dialogueType, setDialogueType] = useState<DialogueType>("lines");
  const [scope, setScope] = useState<"single" | "pair">("single");
  const [packOpen, setPackOpen] = useState(false);
  const [packPending, setPackPending] = useState(false);
  const [sharingPending, setSharingPending] = useState(false);
  const [sharingDirty, setSharingDirty] = useState(false);
  const [sharingAction, setSharingAction] = useState<SharingAction | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locks = useRef(new Set<string>());
  const selected = installed.find((character) => character.id === selectedId);
  const definition = drafts[selectedId] ?? selected?.definition;
  const dirty = Boolean(drafts[selectedId]);
  const hasStoryDrafts = Object.values(storyDrafts).some(
    (value) => JSON.stringify(value.definition) !== JSON.stringify(value.saved.definition),
  );
  const hasDialogueDrafts = Object.values(dialogueDirty).some(Boolean) || hasStoryDrafts;
  const hasMemoryDrafts = Object.values(memoryDirty).some(Boolean);
  const hasUnsavedChanges =
    Object.keys(drafts).length > 0 || hasDialogueDrafts || sharingDirty || hasMemoryDrafts;
  const anyPending =
    Object.values(pendingTargets).some(Boolean) ||
    Object.values(dialoguePending).some(Boolean) ||
    sharingPending ||
    storyPending ||
    packPending;
  const selectedPending =
    Boolean(pendingTargets[selectedId]) ||
    packPending ||
    storyPending ||
    Boolean(pendingTargets.roster);
  const rosterBlocked = anyPending || Object.keys(drafts).length > 0 || hasDialogueDrafts;
  const together = active.includes(selectedId);
  const dialogueIds = scope === "pair" && active.length > 1 ? active : [selectedId];
  const dialogueKey = dialogueIds.join(":");

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);
  useEffect(() => {
    if (selected) {
      setMemoryOwners((previous) =>
        previous.includes(selected.id) ? previous : [...previous, selected.id],
      );
      setOwners((previous) =>
        previous.some((owner) => owner.key === dialogueKey)
          ? previous
          : [...previous, { key: dialogueKey, ids: dialogueIds }],
      );
    }
  }, [dialogueKey, selected?.id]);
  const updateDialogueDirty = useCallback((key: string, value: boolean): void => {
    setDialogueDirty((previous) =>
      Boolean(previous[key]) === value ? previous : { ...previous, [key]: value },
    );
  }, []);
  const updateDialoguePending = useCallback((key: string, value: boolean): void => {
    setDialoguePending((previous) =>
      Boolean(previous[key]) === value ? previous : { ...previous, [key]: value },
    );
  }, []);
  async function run(action: () => Promise<void>, target = selectedId): Promise<void> {
    if (locks.current.has(target)) {
      return;
    }
    locks.current.add(target);
    setPendingTargets((previous) => ({ ...previous, [target]: true }));
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      locks.current.delete(target);
      setPendingTargets((previous) => ({ ...previous, [target]: false }));
    }
  }
  function select(id: string): void {
    animationPickerGeneration.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id);
    setLibraryOpen(false);
    setError(null);
    setNotice(null);
    setRemoveId(null);
  }
  function discardDefinition(): void {
    animationPickerGeneration.current += 1;
    setAnimationVersions((values) => ({ ...values, [selectedId]: (values[selectedId] ?? 0) + 1 }));
    setAnimationAssets((values) => {
      const next = { ...values };
      delete next[selectedId];
      return next;
    });
    setDrafts((values) => {
      const next = { ...values };
      delete next[selectedId];
      return next;
    });
    if (selectedId === NEW_ID) {
      select(installed[0]?.id ?? NEW_ID);
    }
  }
  async function save(): Promise<void> {
    if (!definition) {
      return;
    }
    await run(async () => {
      animationPickerGeneration.current += 1;
      const referenced = new Set(
        definition.animation?.clips.flatMap((clip) => clip.frames.map((frame) => frame.assetId)) ??
          [],
      );
      const assets = Object.values(animationAssets[selectedId] ?? {}).filter((asset) =>
        referenced.has(asset.assetId),
      );
      const animationArgs = assets.length > 0 ? { animationAssets: assets } : {};
      if (selectedId === NEW_ID) {
        const created = await command<InstalledCharacter>("create_character", {
          definition,
          ...animationArgs,
        });
        setCreatedCharacters((values) => [...values, created]);
        select(created.id);
      } else {
        await command("save_character", { id: selectedId, definition, ...animationArgs });
      }
      setAnimationAssets((values) => {
        const next = { ...values };
        delete next[selectedId];
        return next;
      });
      setDrafts((values) => {
        const next = { ...values };
        delete next[selectedId];
        return next;
      });
      setNotice(`${definition.name} 캐릭터를 저장했어요.`);
    });
  }
  async function chooseAnimationAssets(): Promise<AnimationAsset[]> {
    const generation = ++animationPickerGeneration.current;
    const target = selectedId;
    const assets = await command<AnimationAsset[]>("choose_animation_assets");
    return generation === animationPickerGeneration.current && selectedIdRef.current === target
      ? assets
      : [];
  }
  function changeAnimation(animation: CharacterAnimation, assets: AnimationAsset[] = []): void {
    if (!definition) {
      return;
    }
    setDrafts((values) => ({
      ...values,
      [selectedId]: {
        ...(values[selectedId] ?? definition),
        animation: animation.clips.length > 0 ? animation : null,
      },
    }));
    if (assets.length > 0) {
      setAnimationAssets((values) => ({
        ...values,
        [selectedId]: {
          ...values[selectedId],
          ...Object.fromEntries(assets.map((asset) => [asset.assetId, asset])),
        },
      }));
    }
  }
  async function applyRoster(ids: string[], message: string): Promise<void> {
    await run(async () => {
      await command("apply_character_roster", { ids });
      setNotice(message);
    }, "roster");
  }

  return (
    <section className={embedded ? s.embedded : s.page} aria-label="캐릭터 관리">
      {!embedded && <WindowHeader className={s.header} label="캐릭터 관리 닫기" title="캐릭터" />}
      {(error || notice) && (
        <p className={error ? ui.error : ui.success} role={error ? "alert" : "status"}>
          {error || notice}
        </p>
      )}
      <div className={s.layout}>
        {libraryOpen && (
          <FriendsLibrary
            snapshot={snapshot}
            installed={installed.map((character) => ({
              ...character,
              definition: drafts[character.id] ?? character.definition,
            }))}
            packs={packs}
            changedIds={installed
              .filter(
                (character) =>
                  Boolean(drafts[character.id]) ||
                  Boolean(memoryDirty[character.id]) ||
                  owners.some(
                    (owner) => owner.ids.includes(character.id) && dialogueDirty[owner.key],
                  ),
              )
              .map((character) => character.id)}
            pending={anyPending}
            rosterBlocked={rosterBlocked}
            exportDisabled={dirty || hasDialogueDrafts}
            onSelect={select}
            onAdd={() => setPackOpen(true)}
            onImport={() => setSharingAction("import")}
            onExport={() => {
              if (active.length === 1) setSelectedId(active[0]);
              setExportScope(active.length > 1 ? "pair" : "selected");
              setSharingAction("export");
            }}
            onTogether={(id) => void applyRoster([...active, id], "함께 지내기 시작했어요.")}
            onMove={(from, to) =>
              void applyRoster(moved(active, from, to), "친구 순서를 바꿨어요.")
            }
            onTalk={(id) =>
              void run(async () => {
                await command("open_panel", { persona: id, mode: "input" });
              }, id)
            }
          />
        )}
        <div className={s.detail}>
          {definition ? (
            <>
              <CharacterSharing
                snapshot={snapshot}
                selectedId={selected?.id ?? null}
                disabled={anyPending && !sharingPending}
                contentDirty={
                  Object.keys(drafts).length > 0 || hasDialogueDrafts || hasMemoryDrafts
                }
                onPendingChange={setSharingPending}
                onDirtyChange={setSharingDirty}
                exportScope={exportScope}
                action={sharingAction}
                onActionChange={setSharingAction}
              >
                {(packSummary) => (
                  <div className={friends.detail} hidden={libraryOpen}>
                    <CharacterEditor
                      lifeContent={(visible) => (
                        <PackStoryEditor
                          packId={selected?.packId ?? null}
                          presentIds={snapshot.characters.active}
                          installed={installed.map((member) => ({
                            ...member,
                            definition: drafts[member.id] ?? member.definition,
                          }))}
                          trialAssets={trialAssets}
                          visible={visible}
                          drafts={storyDrafts}
                          onDraftsChange={setStoryDrafts}
                          onPendingChange={setStoryPending}
                          characterDirty={Object.keys(drafts).length > 0}
                        />
                      )}
                      packContent={packSummary}
                      headerActions={
                        <>
                          <Button
                            variant="quiet"
                            disabled={!selected?.packId || anyPending}
                            onClick={() => setSharingAction("attribution")}
                          >
                            출처 편집
                          </Button>
                          <Button
                            variant="quiet"
                            disabled={!selected || selectedPending || dirty || hasDialogueDrafts}
                            onClick={() =>
                              void run(async () => {
                                const created = await command<InstalledCharacter>(
                                  "clone_character",
                                  {
                                    id: selectedId,
                                  },
                                );
                                setCreatedCharacters((values) => [...values, created]);
                                select(created.id);
                                setNotice("별도의 관계를 가진 복사본을 만들었어요.");
                              })
                            }
                          >
                            복제
                          </Button>
                        </>
                      }
                      onBack={() => setLibraryOpen(true)}
                      onHistory={() =>
                        void run(async () => {
                          await command("open_panel", { persona: selectedId, mode: "history" });
                        })
                      }
                      onTalk={() =>
                        void run(async () => {
                          await command("open_panel", { persona: selectedId, mode: "input" });
                        })
                      }
                      onTogetherChange={(checked) =>
                        void applyRoster(
                          checked
                            ? [...active, selectedId]
                            : active.filter((id) => id !== selectedId),
                          checked
                            ? "함께 지내기 시작했어요."
                            : "바탕화면에서 쉬어요. 기록과 친밀도는 보관해요.",
                        )
                      }
                      togetherDisabled={
                        !selected ||
                        rosterBlocked ||
                        (together ? active.length === 1 : active.length >= MAX_ROSTER)
                      }
                      onRemove={() => setRemoveId(selectedId)}
                      removeDisabled={
                        !selected ||
                        anyPending ||
                        dirty ||
                        hasDialogueDrafts ||
                        Boolean(memoryDirty[selectedId]) ||
                        (together && active.length === 1)
                      }
                      onExport={() => {
                        setExportScope("selected");
                        setSharingAction("export");
                      }}
                      statusDescription={
                        selected
                          ? `${selected.packId ? (packs.find((pack) => pack.id === selected.packId)?.name ?? "캐릭터 팩") : "직접 만든 친구"} · ${together ? (snapshot.runtime.presentCharacterIds.includes(selectedId) && !snapshot.runtime.hidden ? "바탕화면에 있어요" : "자리 비움") : "쉬는 중"}`
                          : "새로 만날 친구"
                      }
                      memoryTabRequest={memoryTabRequest}
                      memoryContent={(onManage) => (
                        <>
                          {!selected && (
                            <p className={s.small}>
                              캐릭터를 저장하면 함께 나눈 기억을 볼 수 있어요.
                            </p>
                          )}
                          {memoryOwners.map((id) => (
                            <div key={id} hidden={id !== selectedId} className={s.ownerContent}>
                              <MemorySettings
                                key={`${id}:${memoryVersions[id] ?? 0}`}
                                characterId={id}
                                characterName={
                                  installed.find((value) => value.id === id)?.definition.name
                                }
                                onManage={onManage}
                                active={id === selectedId}
                                memoryRevision={snapshot.memoryRevision}
                                onDirtyChange={(value) =>
                                  setMemoryDirty((previous) =>
                                    Boolean(previous[id]) === value
                                      ? previous
                                      : { ...previous, [id]: value },
                                  )
                                }
                              />
                            </div>
                          ))}
                        </>
                      )}
                      settingsContent={
                        selected ? (
                          <CharacterMemorySettings
                            key={selected.id}
                            character={selected}
                            memoryRevision={snapshot.memoryRevision}
                            disabled={anyPending}
                            exportDisabled={dirty || hasDialogueDrafts}
                            memoryDirty={Boolean(memoryDirty[selectedId])}
                            onExport={() => {
                              setExportScope("selected");
                              setSharingAction("export");
                            }}
                            onExportPack={
                              selected.packId
                                ? () => {
                                    setExportScope("pack");
                                    setSharingAction("export");
                                  }
                                : undefined
                            }
                            onForgot={() => {
                              setMemoryVersions((previous) => ({
                                ...previous,
                                [selectedId]: (previous[selectedId] ?? 0) + 1,
                              }));
                              setMemoryDirty((previous) => ({ ...previous, [selectedId]: false }));
                            }}
                          />
                        ) : undefined
                      }
                      dialogueType={dialogueType}
                      canEditCombination={active.length > 1}
                      onDialogueTypeChange={(type) => {
                        setDialogueType(type);
                        if (type === "scenes") setScope("pair");
                      }}
                      packName={
                        selected
                          ? selected.packId
                            ? (packs.find((pack) => pack.id === selected.packId)?.name ??
                              "설치된 캐릭터팩")
                            : "직접 만든 캐릭터"
                          : undefined
                      }
                      isTogether={together}
                      definition={definition}
                      character={selected}
                      installed={installed.map((member) => ({
                        ...member,
                        definition: drafts[member.id] ?? member.definition,
                      }))}
                      presentIds={snapshot.characters.active}
                      packDefinition={
                        selected?.packId ? storyDrafts[selected.packId]?.definition : undefined
                      }
                      packBaseline={
                        selected?.packId ? storyDrafts[selected.packId]?.saved.baseline : undefined
                      }
                      trialAssets={trialAssets}
                      animationAssets={Object.values(animationAssets[selectedId] ?? {})}
                      animationVersion={animationVersions[selectedId] ?? 0}
                      onAnimationChange={changeAnimation}
                      onChooseAnimationAssets={chooseAnimationAssets}
                      onChange={(value) =>
                        setDrafts((values) => ({ ...values, [selectedId]: value }))
                      }
                      onSprite={(expression, remove) =>
                        void run(async () => {
                          if (remove) {
                            await command("remove_character_sprite", {
                              id: selectedId,
                              expression,
                            });
                            setNotice(`${expression} 이미지를 제거했어요.`);
                          } else {
                            const chosen = await command<boolean>("choose_character_sprite", {
                              id: selectedId,
                              expression,
                            });
                            if (chosen) {
                              setNotice(`${expression} 이미지를 저장했어요.`);
                            }
                          }
                        })
                      }
                      onSave={() => void save()}
                      onCancel={discardDefinition}
                      pending={selectedPending}
                      dirty={dirty}
                    >
                      <div hidden={!selected} className={s.ownerContent}>
                        <div className={s.dialogueScope}>
                          <label className={s.scopeField}>
                            대사 소유{" "}
                            <Select
                              aria-label="등록 대사 대상"
                              value={scope}
                              disabled={packPending || Boolean(pendingTargets.roster)}
                              onChange={(event) =>
                                setScope(event.target.value === "pair" ? "pair" : "single")
                              }
                            >
                              <option value="single">
                                {selected?.definition.name ?? "새 캐릭터"}
                              </option>
                              <option value="pair" disabled={active.length < 2}>
                                현재 함께 지내는 조합
                              </option>
                            </Select>
                          </label>
                          {dialogueDirty[dialogueKey] && (
                            <Button
                              variant="quiet"
                              size="compact"
                              disabled={dialoguePending[dialogueKey]}
                              onClick={() => {
                                setDialogueVersions((values) => ({
                                  ...values,
                                  [dialogueKey]: (values[dialogueKey] ?? 0) + 1,
                                }));
                                updateDialogueDirty(dialogueKey, false);
                              }}
                            >
                              이 대상 대사 모두 취소
                            </Button>
                          )}
                        </div>
                        {owners.map((owner) => (
                          <div
                            key={owner.key}
                            hidden={owner.key !== dialogueKey}
                            className={s.ownerContent}
                          >
                            <fieldset
                              className={`${s.fieldset} ${s.ownerContent}`}
                              disabled={packPending || Boolean(pendingTargets.roster)}
                            >
                              <CharacterDialogueEditor
                                key={`${owner.key}:${dialogueVersions[owner.key] ?? 0}`}
                                ids={owner.ids}
                                owners={owner.ids.map((id) =>
                                  installed.find((character) => character.id === id),
                                )}
                                expressions={[
                                  ...new Set(
                                    owner.ids.flatMap((id) =>
                                      Object.keys(
                                        installed.find((character) => character.id === id)
                                          ?.definition.expressions ?? {},
                                      ),
                                    ),
                                  ),
                                ]}
                                onDirtyChange={(value) => updateDialogueDirty(owner.key, value)}
                                onPendingChange={(value) => updateDialoguePending(owner.key, value)}
                                compact
                                mode={dialogueType === "scenes" ? "scenes" : "keyword"}
                              />
                            </fieldset>
                          </div>
                        ))}
                      </div>
                      {!selected && (
                        <p className={s.small}>
                          캐릭터를 저장하면 키워드 대사와 공유를 사용할 수 있어요.
                        </p>
                      )}
                    </CharacterEditor>
                  </div>
                )}
              </CharacterSharing>
            </>
          ) : (
            <p className={s.small} role="status">
              캐릭터 목록을 준비하고 있어요.
            </p>
          )}
        </div>
      </div>
      <Dialog
        closeLabel="닫기"
        isOpen={packOpen}
        onOpenChange={(open) => {
          if (!packPending) {
            setPackOpen(open);
          }
        }}
        onCancel={(event) => {
          if (packPending) {
            event.preventDefault();
          }
        }}
        title="친구 추가"
        size="large"
      >
        <div className={friends.adding}>
          <aside className={friends.addIntro}>
            <h2 className={friends.pageTitle}>친구 추가</h2>
            <p className={friends.caption}>
              캐릭터 팩에서 친구를 데려오거나 이름과 기본 표정으로 새 친구를 만들어요.
            </p>
            <div className={friends.sourceButtons}>
              <Button
                variant="primary"
                disabled={anyPending}
                onClick={() => {
                  setDrafts((values) => ({
                    ...values,
                    [NEW_ID]: values[NEW_ID] ?? newDefinition(),
                  }));
                  select(NEW_ID);
                  setPackOpen(false);
                }}
              >
                새로 만들기
              </Button>
              <Button
                variant="secondary"
                disabled={anyPending}
                onClick={() => {
                  setPackOpen(false);
                  setSharingAction("import");
                }}
              >
                파일에서 가져오기…
              </Button>
            </div>
            <p className={friends.caption}>
              함께 지내는 친구는 8명까지예요. 지금 {active.length}명이 함께 지내요.
            </p>
          </aside>
          <CharacterPackSelector
            characters={snapshot.characters}
            disabled={anyPending && !packPending}
            hasUnsavedChanges={Object.keys(drafts).length > 0 || hasDialogueDrafts}
            onPendingChange={setPackPending}
            onApplied={(id) => {
              select(id);
              setPackOpen(false);
            }}
          />
        </div>
      </Dialog>
      <Dialog
        closeLabel="닫기"
        isOpen={removeId !== null}
        onOpenChange={(open) => {
          if (!open && !anyPending) {
            setRemoveId(null);
          }
        }}
        onCancel={(event) => {
          if (anyPending) {
            event.preventDefault();
          }
        }}
        title="보유 목록에서 제거"
        variant="confirm"
        footer={
          <>
            <Button
              variant="primary"
              disabled={anyPending}
              onClick={() => {
                if (!removeId) {
                  return;
                }
                const removed = removeId;
                void run(async () => {
                  await command("remove_character", { id: removed });
                  setCreatedCharacters((values) =>
                    values.filter((character) => character.id !== removed),
                  );
                  setOwners((values) => values.filter((owner) => !owner.ids.includes(removed)));
                  select(installed.find((character) => character.id !== removed)?.id ?? NEW_ID);
                  setNotice("목록에서 제거했어요.");
                });
              }}
            >
              목록에서 제거 확인
            </Button>
            <Button variant="secondary" disabled={anyPending} onClick={() => setRemoveId(null)}>
              취소
            </Button>
          </>
        }
      >
        <p className={s.notice}>
          선택한 캐릭터를 보유 목록과 바탕화면에서 제거해요. 대화 기록과 친밀도는 보존해요.
        </p>
      </Dialog>
    </section>
  );
}
