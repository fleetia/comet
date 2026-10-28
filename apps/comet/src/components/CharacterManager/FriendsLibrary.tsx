import { useState, type JSX } from "react";
import {
  AddCard,
  Button,
  CharacterArtwork,
  CharacterCard,
  SearchInput,
  SettingsSummary,
} from "@comet/ui";
import { ChatIcon, CopyIcon, GripIcon, PlusIcon, ShareIcon } from "@comet/icon";
import type { InstalledCharacter, InstalledCharacterPack, Snapshot } from "../../types";
import { DEFAULT_EXPRESSION, spriteSource, spriteUrl } from "../characterIdentity";
import * as styles from "./friends.css";

type Props = {
  snapshot: Snapshot;
  installed: InstalledCharacter[];
  packs: InstalledCharacterPack[];
  changedIds: string[];
  pending: boolean;
  rosterBlocked: boolean;
  exportDisabled: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onImport: () => void;
  onExport: () => void;
  onTogether: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onTalk: (id: string) => void;
};

export function FriendArtwork({
  character,
  compact = false,
  expression = DEFAULT_EXPRESSION,
}: {
  character: InstalledCharacter;
  compact?: boolean;
  expression?: string;
}): JSX.Element {
  const sprite =
    expression === DEFAULT_EXPRESSION
      ? spriteSource(character, expression)
      : spriteUrl(character, expression);
  if (!sprite) {
    return (
      <CharacterArtwork
        face={character.definition.expressions[expression]}
        size={compact ? "compact" : "large"}
      />
    );
  }
  return (
    <span className={compact ? styles.compactArtwork : styles.artwork} aria-hidden="true">
      <img src={sprite} alt="" className={compact ? styles.compactPortrait : styles.portrait} />
    </span>
  );
}

export function FriendsLibrary({
  snapshot,
  installed,
  packs,
  changedIds,
  pending,
  rosterBlocked,
  exportDisabled,
  onSelect,
  onAdd,
  onImport,
  onExport,
  onTogether,
  onMove,
  onTalk,
}: Props): JSX.Element {
  const [query, setQuery] = useState("");
  const active = snapshot.characters.active;
  const matches = (character: InstalledCharacter): boolean =>
    `${character.definition.name} ${character.definition.description}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const residents = active
    .map((id) => installed.find((character) => character.id === id))
    .filter((character): character is InstalledCharacter => Boolean(character))
    .filter(matches);
  const guests = installed.filter(
    (character) =>
      character.definition.presenceRole === "npc" &&
      !active.includes(character.id) &&
      matches(character),
  );
  const resting = installed.filter(
    (character) =>
      character.definition.presenceRole !== "npc" &&
      !active.includes(character.id) &&
      matches(character),
  );
  function packName(character: InstalledCharacter): string {
    return (
      packs.find((pack) => pack.id === character.packId)?.name ??
      (character.packId ? "캐릭터 팩" : "직접 만든 친구")
    );
  }
  function status(character: InstalledCharacter): string {
    return snapshot.runtime.hidden
      ? "지금은 쉬고 있어요"
      : snapshot.runtime.presentCharacterIds.includes(character.id)
        ? "바탕화면에 있어요"
        : "자리 비움";
  }
  return (
    <div className={styles.library} role="region" aria-label="설치된 캐릭터">
      <header className={styles.libraryHeader}>
        <div className={styles.headingLine}>
          <h1 className={styles.pageTitle}>친구들</h1>
          <span className={styles.caption}>함께 지내는 친구 {active.length} / 8명</span>
        </div>
        <div className={styles.headerActions}>
          <SearchInput
            aria-label="친구 찾기"
            placeholder="친구 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button leadingIcon={<PlusIcon size={15} />} disabled={pending} onClick={onAdd}>
            친구 추가…
          </Button>
        </div>
      </header>
      <section className={styles.librarySection} aria-label="함께 지내는 친구">
        <div className={styles.sectionHeading}>
          <h2 className={styles.sectionTitle}>함께 지내는 친구</h2>
          <p className={styles.caption}>끌어서 순서를 바꿔요. 모두에게 말하면 이 순서로 답해요.</p>
        </div>
        <div className={styles.cards}>
          {residents.map((character) => {
            const order = active.indexOf(character.id);
            return (
              <div
                className={styles.friendCard}
                key={character.id}
                draggable={!rosterBlocked}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/comet-character", character.id)
                }
                onDragOver={(event) => {
                  if (!rosterBlocked) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = active.indexOf(event.dataTransfer.getData("text/comet-character"));
                  if (!rosterBlocked && from >= 0 && from !== order) onMove(from, order);
                }}
              >
                <CharacterCard
                  className={styles.cardIdentity}
                  title={
                    <>
                      {character.definition.name}
                      {changedIds.includes(character.id) && <span aria-label="미저장"> ·</span>}
                    </>
                  }
                  description={`${packName(character)} · ${status(character)}`}
                  artwork={<FriendArtwork character={character} />}
                  role="button"
                  tabIndex={0}
                  aria-label={`${character.definition.name} 자세히`}
                  onClick={() => onSelect(character.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(character.id);
                    }
                  }}
                />
                <div className={styles.cardActions}>
                  <span className={styles.reorder}>
                    <GripIcon size={16} />
                    <button
                      type="button"
                      className={styles.orderButton}
                      aria-label={`${character.definition.name} 앞으로`}
                      disabled={rosterBlocked || order === 0}
                      onClick={() => onMove(order, order - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.orderButton}
                      aria-label={`${character.definition.name} 뒤로`}
                      disabled={rosterBlocked || order === active.length - 1}
                      onClick={() => onMove(order, order + 1)}
                    >
                      ↓
                    </button>
                  </span>
                  <Button
                    size="small"
                    variant="ghost"
                    leadingIcon={<ChatIcon size={13} />}
                    onClick={() => onTalk(character.id)}
                    disabled={pending}
                  >
                    말 걸기
                  </Button>
                  <Button size="small" variant="link" onClick={() => onSelect(character.id)}>
                    자세히
                  </Button>
                </div>
              </div>
            );
          })}
          <AddCard
            title="친구 추가"
            description="캐릭터 파일이나 팩에서 데려와요"
            className={styles.addCard}
            onClick={onAdd}
            disabled={pending}
          />
        </div>
      </section>
      <div className={styles.secondaryColumns}>
        <div className={styles.librarySection}>
          {guests.length > 0 && (
            <section className={styles.librarySection} aria-label="찾아오는 친구">
              <h2 className={styles.sectionTitle}>찾아오는 친구</h2>
              {guests.map((character) => (
                <SettingsSummary
                  key={character.id}
                  aria-label={`${character.definition.name} 자세히`}
                  title={character.definition.name}
                  description={`${packName(character)} · 초대나 등록한 이야기로만 들어와요`}
                  leading={<FriendArtwork character={character} compact />}
                  onClick={() => onSelect(character.id)}
                  className={styles.summary}
                />
              ))}
            </section>
          )}
          {resting.length > 0 && (
            <section className={styles.librarySection} aria-label="쉬는 친구">
              <h2 className={styles.sectionTitle}>쉬는 친구</h2>
              {resting.map((character) => (
                <div className={styles.restingRow} key={character.id}>
                  <button
                    type="button"
                    className={styles.restingIdentity}
                    onClick={() => onSelect(character.id)}
                    aria-label={`${character.definition.name} 자세히`}
                  >
                    <FriendArtwork character={character} compact />
                    <span>
                      <strong>{character.definition.name}</strong>
                      <span className={styles.caption}>
                        {packName(character)} · 기록과 친밀도 보관 중
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={rosterBlocked || active.length >= 8}
                    onClick={() => onTogether(character.id)}
                  >
                    함께 지내기
                  </Button>
                </div>
              ))}
            </section>
          )}
          {query && residents.length + guests.length + resting.length === 0 && (
            <p className={styles.caption}>찾는 친구가 없어요.</p>
          )}
        </div>
        <section className={styles.librarySection} aria-label="캐릭터 파일">
          <h2 className={styles.sectionTitle}>캐릭터 파일</h2>
          <div className={styles.fileRow}>
            <span className={styles.iconTile}>
              <ShareIcon size={22} />
            </span>
            <span className={styles.fileText}>
              <strong>친구 가져오기</strong>
              <span className={styles.caption}>캐릭터 파일을 열어 내용을 확인한 뒤 데려와요</span>
            </span>
            <Button size="small" variant="ghost" disabled={pending} onClick={onImport}>
              가져오기…
            </Button>
          </div>
          <div className={styles.fileRow}>
            <span className={styles.iconTile}>
              <CopyIcon size={22} />
            </span>
            <span className={styles.fileText}>
              <strong>지금 구성 내보내기</strong>
              <span className={styles.caption}>함께 지내는 친구 {active.length}명과 조합 대사</span>
            </span>
            <Button
              size="small"
              variant="ghost"
              disabled={pending || exportDisabled}
              onClick={onExport}
            >
              내보내기…
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
