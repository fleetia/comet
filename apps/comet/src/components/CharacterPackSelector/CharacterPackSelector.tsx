import { useEffect, useRef, useState, type JSX } from "react";
import { Button, ChoiceButton, ChoiceTile, Dialog } from "@comet/ui";
import { HabitIcon, PlusIcon } from "@comet/icon";
import { FriendArtwork } from "../CharacterManager/FriendsLibrary";
import * as styles from "./characterPacks.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { CharacterCollection, InstalledCharacterPack } from "../../types";
import * as ui from "../../common.css";

export function packOrigin(pack: InstalledCharacterPack): string {
  if (pack.official) return "공식 · 앱에 포함";
  if (pack.installedAt === null) return "직접 추가한 팩";
  const date = new Date(pack.installedAt * 1000);
  return `직접 추가한 팩 · ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

type Props = {
  characters: CharacterCollection;
  disabled: boolean;
  hasUnsavedChanges: boolean;
  onPendingChange: (pending: boolean) => void;
  onApplied: (characterId: string) => void;
  selectedCharacterId: string | null;
  onSelectCharacter: (characterId: string) => void;
  onCreate: () => void;
  onImport: () => void;
};

export function CharacterPackSelector({
  characters,
  disabled,
  hasUnsavedChanges,
  onPendingChange,
  onApplied,
  selectedCharacterId,
  onSelectCharacter,
  onCreate,
  onImport,
}: Props): JSX.Element {
  const [packs, setPacks] = useState<InstalledCharacterPack[] | null>(isDesktop() ? null : []);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const lock = useRef(false);
  // Only the latest list request may replace the shown packs.
  const listRequest = useRef(0);
  const membership = JSON.stringify(characters.installed.map(({ id, packId }) => [id, packId]));

  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    const request = ++listRequest.current;
    setPacks(null);
    setError(null);
    void command<InstalledCharacterPack[]>("get_character_packs")
      .then((value) => {
        if (request === listRequest.current) {
          setPacks(value);
        }
      })
      .catch((cause: unknown) => {
        if (request === listRequest.current) {
          setError(errorText(cause));
        }
      });
    return () => {
      listRequest.current += 1;
    };
  }, [membership, revision]);

  const currentPack = packs?.find(
    (pack) =>
      pack.characterIds.length === characters.active.length &&
      pack.characterIds.every((id, index) => id === characters.active[index]),
  );
  const busy = disabled || pending || hasUnsavedChanges;
  const nameOf = (id: string): string | undefined =>
    characters.installed.find((character) => character.id === id)?.definition.name;

  const info = packs?.find((pack) => pack.id === infoId);
  // Attribution can change on the friend detail page while this page stays mounted.
  function openInfo(id: string): void {
    setInfoId(id);
    const request = ++listRequest.current;
    void command<InstalledCharacterPack[]>("get_character_packs")
      .then((value) => {
        if (request === listRequest.current) setPacks(value);
      })
      .catch(() => {});
  }

  async function apply(pack: InstalledCharacterPack): Promise<void> {
    if (busy || lock.current || pack.id === currentPack?.id) {
      return;
    }
    lock.current = true;
    setPending(true);
    onPendingChange(true);
    setError(null);
    setNotice(null);
    try {
      await command("apply_character_pack", { packId: pack.id });
      onApplied(pack.characterIds[0]);
      setNotice(`${pack.name} 팩으로 바꿨어요.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <section className={styles.selector} aria-label="캐릭터 팩 선택">
      <div className={styles.sources} role="group" aria-label="친구를 데려올 곳">
        <ChoiceButton selected>캐릭터 팩에서</ChoiceButton>
        <ChoiceButton disabled={disabled || pending} onClick={onCreate}>
          새로 만들기
        </ChoiceButton>
        <ChoiceButton disabled={disabled || pending} onClick={onImport}>
          파일에서
        </ChoiceButton>
      </div>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={ui.success} role="status">
          {notice}
        </p>
      )}
      {packs === null &&
        (error ? (
          <Button variant="ghost" disabled={busy} onClick={() => setRevision((value) => value + 1)}>
            팩 목록 다시 불러오기
          </Button>
        ) : (
          <p className={ui.quiet} role="status">
            설치한 팩을 불러오고 있어요.
          </p>
        ))}
      {packs?.length === 0 && (
        <p className={ui.quiet}>
          설치한 캐릭터 팩이 없어요. 파일에서 팩을 설치하면 여기서 고를 수 있어요.
        </p>
      )}
      {packs?.map((pack, index) => {
        const applied = pack.id === currentPack?.id;
        return (
          <section
            className={styles.pack}
            key={pack.id}
            aria-label={`${index + 1}. ${pack.name} · ${pack.characterIds.length}명`}
          >
            <header className={styles.packHeading}>
              <h3 className={styles.packName}>{pack.name}</h3>
              <span className={styles.badge}>{packOrigin(pack)}</span>
              {applied ? (
                <Button
                  variant="ghost"
                  size="small"
                  className={styles.packAction}
                  leadingIcon={<HabitIcon size={14} />}
                  onClick={() => openInfo(pack.id)}
                >
                  팩 정보
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="small"
                  className={styles.packAction}
                  leadingIcon={<HabitIcon size={14} />}
                  disabled={busy}
                  onClick={() => void apply(pack)}
                >
                  {pending ? "전환 중…" : "이 팩으로 함께 지내기"}
                </Button>
              )}
            </header>
            <p className={styles.caption}>
              함께 지낼 순서: {pack.characterIds.map(nameOf).join(" → ")} · 기록과 친밀도는 그대로
              남아요.
            </p>
            <div className={styles.characters}>
              {pack.characterIds.map((id) => {
                const character = characters.installed.find((friend) => friend.id === id);
                if (!character) return null;
                return (
                  <ChoiceTile
                    key={id}
                    kind="character"
                    label={character.definition.name}
                    graphic={<FriendArtwork character={character} compact />}
                    description={
                      characters.active.includes(id)
                        ? "함께 지내는 중"
                        : character.definition.presenceRole === "npc"
                          ? "찾아오는 친구로 등록됨"
                          : "쉬는 중"
                    }
                    selected={selectedCharacterId === id}
                    className={styles.character}
                    disabled={disabled || pending}
                    onClick={() => onSelectCharacter(id)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
      {hasUnsavedChanges && (
        <p className={ui.quiet}>수정 중인 캐릭터와 대사를 저장하거나 취소한 뒤 팩을 바꿔 주세요.</p>
      )}
      <div className={styles.footer}>
        <p className={styles.caption}>새로 만들기는 이름과 기본 표정 하나로 시작해요.</p>
        <Button
          variant="ghost"
          size="small"
          leadingIcon={<PlusIcon size={14} />}
          disabled={disabled || pending}
          onClick={onImport}
        >
          팩 추가…
        </Button>
      </div>
      <Dialog
        isOpen={Boolean(info)}
        title="팩 정보"
        size="small"
        closeLabel="팩 정보 닫기"
        onOpenChange={(open) => {
          if (!open) setInfoId(null);
        }}
      >
        {info && (
          <dl className={styles.info}>
            <div className={styles.infoRow}>
              <dt>팩</dt>
              <dd>
                {info.name} · {packOrigin(info)}
              </dd>
            </div>
            <div className={styles.infoRow}>
              <dt>들어 있는 친구</dt>
              <dd>{info.characterIds.map(nameOf).join(", ")}</dd>
            </div>
            <div className={styles.infoRow}>
              <dt>만든 사람</dt>
              <dd>{info.author || "등록된 제작자 없음"}</dd>
            </div>
            <div className={styles.infoRow}>
              <dt>출처 주소</dt>
              <dd>{info.sourceUrl || "등록된 출처 없음"}</dd>
            </div>
            <div className={styles.infoRow}>
              <dt>쓰는 조건</dt>
              <dd>{info.license || "등록된 조건 없음"}</dd>
            </div>
            <p className={styles.caption}>
              만든 사람과 출처 주소는 친구 정보의 출처 편집에서 고칠 수 있어요.
            </p>
          </dl>
        )}
      </Dialog>
    </section>
  );
}
