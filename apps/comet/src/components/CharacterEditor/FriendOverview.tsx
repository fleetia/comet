import { useEffect, useState, type JSX, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Balloon, Button, CharacterArtwork, SettingsSummary, Switch } from "@comet/ui";
import { ChatIcon, ChevLeftIcon, Icon, ShareIcon, RemoveIcon, type IconName } from "@comet/icon";
import type { CharacterDefinition, InstalledCharacter } from "../../types";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { FriendArtwork } from "../CharacterManager/FriendsLibrary";
import * as styles from "./friendDetail.css";

type Props = {
  character?: InstalledCharacter;
  definition: CharacterDefinition;
  installed: InstalledCharacter[];
  isTogether: boolean;
  statusDescription?: string;
  togetherDisabled?: boolean;
  removeDisabled?: boolean;
  onTogetherChange?: (together: boolean) => void;
  onBack?: () => void;
  onTalk?: () => void;
  onExport?: () => void;
  onRemove?: () => void;
  onOpen: (page: string) => void;
  headerActions?: ReactNode;
  /** Friends living together; a visiting friend lists how each reacts to its name. */
  presentIds?: string[];
  onOpenReaction?: (residentId: string) => void;
};

/** Picks 을/를 from whether the last Hangul syllable has a final consonant. */
function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 0 ? "를" : "을";
}

function NameReactions({
  character,
  definition,
  residents,
  onOpenReaction,
}: {
  character: InstalledCharacter;
  definition: CharacterDefinition;
  residents: InstalledCharacter[];
  onOpenReaction?: (residentId: string) => void;
}): JSX.Element {
  const name = definition.name;
  return (
    <section className={styles.reactions} aria-label="이름을 들었을 때">
      <h2 className={styles.sectionTitle}>이름을 들었을 때</h2>
      {residents.length === 0 ? (
        <p className={styles.caption}>함께 지내는 친구가 생기면 친구마다 반응을 정할 수 있어요.</p>
      ) : (
        <ul className={styles.reactionList}>
          {residents.map((resident) => {
            const line = resident.definition.relationships.find(
              (relation) => relation.targetId === character.id,
            )?.replyLines?.[0]?.text;
            return (
              <li key={resident.id} className={styles.reactionRow}>
                <span className={styles.reactionArtwork} aria-hidden="true">
                  <FriendArtwork character={resident} compact />
                </span>
                <span className={styles.reactionText}>
                  <strong>
                    {resident.definition.name}에게 ‘{name}’{objectParticle(name)} 말하면
                  </strong>
                  <span className={styles.caption}>{line ? `“${line}”` : "정하지 않음"}</span>
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  leadingIcon={<Icon name="repeat" size={14} />}
                  aria-label={`${resident.definition.name}의 반응 ${line ? "바꾸기" : "정하기"}`}
                  onClick={() => onOpenReaction?.(resident.id)}
                >
                  {line ? "바꾸기" : "정하기"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.caption}>
        친구마다 따로 정해요. 이 반응은 이름을 들었을 때만 하고, {name}
        {objectParticle(name)} 부르지는 않아요.
      </p>
    </section>
  );
}

export function FriendOverview({
  character,
  definition,
  installed,
  isTogether,
  statusDescription,
  togetherDisabled,
  removeDisabled,
  onTogetherChange,
  onBack,
  onTalk,
  onExport,
  onRemove,
  onOpen,
  headerActions,
  presentIds = [],
  onOpenReaction,
}: Props): JSX.Element {
  const [touches, setTouches] = useState<{
    characterId: string;
    stroke: number;
    poke: number;
    snack: number;
  } | null>(null);
  const [touchesError, setTouchesError] = useState(false);
  const [moments, setMoments] = useState<{
    characterId: string;
    daysTogether: number | null;
    momentCount: number;
  } | null>(null);
  const [momentsError, setMomentsError] = useState(false);
  const characterId = character?.id;
  useEffect(() => {
    if (!characterId || !isDesktop()) return;
    let active = true;
    let revision = 0;
    const unlisten: (() => void)[] = [];
    setTouches(null);
    setTouchesError(false);
    setMoments(null);
    setMomentsError(false);
    const refresh = () => {
      const current = ++revision;
      void command<{ stroke: number; poke: number; snack: number }>("get_character_touches", {
        characterId,
      })
        .then((result) => {
          if (active && current === revision) {
            setTouches({ characterId, ...result });
            setTouchesError(false);
          }
        })
        .catch(() => {
          if (active && current === revision) {
            setTouches(null);
            setTouchesError(true);
          }
        });
      void command<{ daysTogether: number | null; momentCount: number }>(
        "get_shared_moment_stats",
        { characterId },
      )
        .then((result) => {
          if (active && current === revision) {
            setMoments({ characterId, ...result });
            setMomentsError(false);
          }
        })
        .catch(() => {
          if (active && current === revision) {
            setMoments(null);
            setMomentsError(true);
          }
        });
    };
    for (const event of ["widgets-state", "app-state"]) {
      void listen(event, refresh)
        .then((cleanup) => {
          if (active) unlisten.push(cleanup);
          else cleanup();
        })
        .catch(() => {
          if (active) setTouchesError(true);
        });
    }
    refresh();
    return () => {
      active = false;
      unlisten.forEach((cleanup) => cleanup());
    };
  }, [characterId]);
  const residents = installed.filter(
    (friend) =>
      friend.id !== character?.id &&
      friend.definition.presenceRole !== "npc" &&
      presentIds.includes(friend.id),
  );
  const categories: { page: string; title: string; description: string; icon: IconName }[] = [
    { page: "profile", title: "프로필", description: "이름, 소개, 성격과 말투", icon: "sparkle" },
    {
      page: "appearance",
      title: "모습·표정",
      description: `표정 ${Object.keys(definition.expressions).length}개 · 동작 ${definition.animation?.clips.length ?? 0}개`,
      icon: "look",
    },
    {
      page: "balloon",
      title: "말풍선",
      description: `${definition.balloonStyle?.fontSize ?? 16}px · ${definition.balloonStyle?.fontFamily || "기본 글꼴"}`,
      icon: "chat",
    },
    {
      page: "dialogue",
      title: "대사·반응",
      description: "인사, 자동 수다, 키워드, 조합",
      icon: "quote",
    },
    {
      page: "life",
      title: "등장·이야기",
      description: definition.presenceRole === "npc" ? "잠깐 찾아오는 친구" : "함께 지내는 친구",
      icon: "story",
    },
    {
      page: "relationships",
      title: "다른 친구와의 관계",
      description:
        definition.relationships
          .map(
            (relation) =>
              installed.find((friend) => friend.id === relation.targetId)?.definition.name,
          )
          .filter(Boolean)
          .join(", ") || "친구와의 관계를 적어요",
      icon: "link",
    },
  ];
  return (
    <div className={styles.overview}>
      <aside className={styles.hero}>
        <Button
          variant="link"
          size="small"
          leadingIcon={<ChevLeftIcon size={15} />}
          className={styles.back}
          onClick={onBack}
        >
          친구들
        </Button>
        <span className={styles.heroArtwork}>
          {character ? (
            <FriendArtwork character={{ ...character, definition }} />
          ) : (
            <CharacterArtwork face={definition.expressions["평온"]} />
          )}
        </span>
        <h1 className={styles.heroTitle}>{definition.name}</h1>
        <p className={styles.description}>{statusDescription}</p>
        <Button
          leadingIcon={<ChatIcon size={15} />}
          className={styles.talk}
          disabled={!character}
          onClick={onTalk}
        >
          말 걸기
        </Button>
        <div className={styles.together}>
          <span>
            <strong>함께 지내기</strong>
            <span className={styles.caption}>
              끄면 바탕화면에서 쉬어요. 기록과 친밀도는 그대로예요.
            </span>
          </span>
          <Switch
            aria-label="함께 지내기"
            checked={isTogether}
            disabled={togetherDisabled}
            onChange={(event) => onTogetherChange?.(event.target.checked)}
          />
        </div>
        {character && definition.presenceRole === "npc" && (
          <NameReactions
            character={character}
            definition={definition}
            residents={residents}
            onOpenReaction={onOpenReaction}
          />
        )}
      </aside>
      <div className={styles.overviewBody}>
        <section className={styles.section} aria-label="캐릭터">
          <h2 className={styles.sectionTitle}>캐릭터</h2>
          <div className={styles.categoryGrid}>
            {categories.map(({ page, title, description, icon }) => (
              <SettingsSummary
                key={page}
                aria-label={title}
                title={title}
                description={description}
                leading={
                  <span className={styles.iconTile}>
                    <Icon name={icon} size={20} />
                  </span>
                }
                onClick={() => onOpen(page)}
                className={styles.summary}
              />
            ))}
          </div>
        </section>
        <section className={styles.section} aria-label="함께한 기록">
          <h2 className={styles.sectionTitle}>함께한 기록</h2>
          {moments && moments.characterId === characterId && moments.daysTogether !== null && (
            <p className={styles.caption}>
              함께한 지 {moments.daysTogether}일 · 추억 {moments.momentCount}개
            </p>
          )}
          {momentsError && (
            <p className={styles.caption} role="alert">
              함께한 추억을 불러오지 못했어요.
            </p>
          )}
          {touches && touches.characterId === characterId && (
            <p className={styles.caption}>
              쓰다듬기 {touches.stroke} · 찌르기 {touches.poke} · 간식 {touches.snack}
            </p>
          )}
          {touchesError && (
            <p className={styles.caption} role="alert">
              교감 횟수를 불러오지 못했어요.
            </p>
          )}
          <div className={styles.categoryGrid}>
            <SettingsSummary
              aria-label="기억"
              title="기억"
              description="함께 나눈 기억"
              leading={
                <span className={styles.iconTile}>
                  <Icon name="sparkle" size={20} />
                </span>
              }
              onClick={() => onOpen("memory")}
              className={styles.summary}
            />
            <SettingsSummary
              aria-label="지난 대화"
              title="지난 대화"
              description="이 친구와 나눈 대화"
              leading={
                <span className={styles.iconTile}>
                  <Icon name="history" size={20} />
                </span>
              }
              onClick={() => onOpen("history")}
              className={styles.summary}
            />
          </div>
        </section>
        <section className={styles.section} aria-label="공유와 관리">
          <h2 className={styles.sectionTitle}>공유와 관리</h2>
          <div className={styles.management}>
            <Button
              variant="ghost"
              size="small"
              leadingIcon={<ShareIcon size={14} />}
              onClick={onExport}
            >
              파일로 공유…
            </Button>
            {headerActions}
            <Button
              variant="danger"
              size="small"
              leadingIcon={<RemoveIcon size={14} />}
              onClick={onRemove}
              disabled={removeDisabled}
            >
              보유 목록에서 빼기…
            </Button>
            <Button variant="link" size="small" onClick={() => onOpen("settings")}>
              기억 관리
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function FriendProfilePreview({
  character,
  definition,
}: {
  character?: InstalledCharacter;
  definition: CharacterDefinition;
}): JSX.Element {
  return (
    <aside className={styles.profilePreview} aria-label="프로필 미리 보기">
      <h2 className={styles.sectionTitle}>미리 보기</h2>
      <div className={styles.profileIdentity}>
        {character ? (
          <span className={styles.profileArtwork}>
            <FriendArtwork character={{ ...character, definition }} />
          </span>
        ) : (
          <span className={styles.emptyPortrait}>{definition.expressions["평온"]}</span>
        )}
        <h2 className={styles.profileTitle}>{definition.name || "새 친구"}</h2>
        <p className={styles.description}>{definition.description}</p>
      </div>
      <span className={styles.caption}>처음 만나면</span>
      <div className={styles.greetingStage}>
        <Balloon
          speakerName={definition.name || "새 친구"}
          tail="center"
          className={styles.greeting}
        >
          {definition.greeting[0]?.text}
        </Balloon>
      </div>
      <p className={styles.caption}>
        등록한 인사와 수다는 원문 그대로 말하고, 새로 만드는 말은 성격과 말투, 지침을 따라요.
      </p>
    </aside>
  );
}
