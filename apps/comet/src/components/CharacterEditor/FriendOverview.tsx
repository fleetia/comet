import type { JSX, ReactNode } from "react";
import { Balloon, Button, CharacterArtwork, SettingsSummary, Switch } from "@comet/ui";
import { ChatIcon, ChevLeftIcon, Icon, ShareIcon, RemoveIcon, type IconName } from "@comet/icon";
import type { CharacterDefinition, InstalledCharacter } from "../../types";
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
};

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
}: Props): JSX.Element {
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
