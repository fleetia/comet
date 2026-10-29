import type { JSX } from "react";
import { Button, CharacterArtwork, Checkbox } from "@comet/ui";
import { Icon, type IconName } from "@comet/icon";
import type { CharacterPack } from "../../types";
import { CharacterPackPreview } from "../CharacterPackPreview/CharacterPackPreview";
import type { ArchiveChoice } from "./archiveChoice";
import * as styles from "./characterSharing.css";

export function CharacterImportPreview({
  pack,
  warnings,
  activeCount,
  installed,
  joinDisabled,
  pending,
  error,
  notice,
  archiveChoice,
  onArchiveChoiceChange,
  onChoose,
  onInstall,
  onJoin,
  onCancel,
}: {
  pack: CharacterPack | null;
  warnings: string[];
  activeCount: number;
  installed: boolean;
  joinDisabled: boolean;
  pending: boolean;
  error: string | null;
  notice: string | null;
  archiveChoice: ArchiveChoice;
  onArchiveChoiceChange: (choice: ArchiveChoice) => void;
  onChoose: () => void;
  onInstall: () => void;
  onJoin: () => void;
  onCancel: () => void;
}): JSX.Element {
  const first = pack?.characters[0];
  const sprite = pack?.sprites?.find(
    (asset) => asset.sourceId === first?.sourceId && asset.expression === "평온",
  );
  const lines =
    pack?.characters.reduce(
      (total, character) =>
        total +
        character.greeting.length +
        character.idleLines.length +
        character.departureLines.length +
        character.returnLines.length,
      0,
    ) ?? 0;
  const rows: {
    title: string;
    description: string;
    icon: IconName;
    choice?: keyof ArchiveChoice;
    present?: boolean;
  }[] = pack
    ? [
        {
          title: "모습",
          description: `친구 ${pack.characters.length}명 · 표정 ${pack.characters.reduce((total, character) => total + Object.keys(character.expressions).length, 0)}개 · 동작 ${pack.characters.reduce((total, character) => total + (character.animation?.clips.length ?? 0), 0)}개`,
          icon: "look",
        },
        {
          title: "대사",
          description: `${lines}줄 · 조합 대사 ${pack.pairScenes.length}개`,
          icon: "quote",
        },
        { title: "성격과 대화 지침", description: "아래에서 읽어 보세요", icon: "memory" },
        {
          title: "기억",
          description: pack.archive?.memories.length
            ? `${pack.archive.memories.length}개`
            : "들어 있지 않아요",
          icon: "sparkle",
          choice: "memories",
          present: Boolean(pack.archive?.memories.length),
        },
        {
          title: "친밀도",
          description: pack.archive?.affinity.length ? "들어 있어요" : "들어 있지 않아요",
          icon: "heart",
          choice: "affinity",
          present: Boolean(pack.archive?.affinity.length),
        },
        {
          title: "대화 기록",
          description: pack.archive?.messages.length
            ? `${pack.archive.messages.length}개`
            : "들어 있지 않아요",
          icon: "history",
          choice: "messages",
          present: Boolean(pack.archive?.messages.length),
        },
      ]
    : [];
  return (
    <div className={styles.importLayout}>
      <aside className={styles.previewCard}>
        <h2 className={styles.title}>
          <Icon name="share" size={22} />
          친구 가져오기
        </h2>
        <p className={styles.caption}>파일에 든 것을 확인하고 데려와요.</p>
        <Button variant="ghost" onClick={onChoose} disabled={pending}>
          {pack ? "다른 파일 선택…" : "공유 파일 가져오기"}
        </Button>
        {first && (
          <div className={styles.character}>
            {sprite ? (
              <img
                className={styles.portrait}
                src={`data:${sprite.mime};base64,${sprite.data}`}
                alt={`${first.name} 표정`}
              />
            ) : (
              <CharacterArtwork face={first.expressions["평온"]} />
            )}
            <h3 className={styles.characterName}>{first.name}</h3>
            <p className={styles.description}>{first.description}</p>
          </div>
        )}
        <p className={styles.caption}>
          함께 지내는 친구 {activeCount} / 8명 · 가져오기 전에는 아무것도 바뀌지 않아요.
        </p>
        <p className={styles.caption}>.comet-character.json · 최대 32 MiB</p>
      </aside>
      <div className={styles.importBody}>
        {pack ? (
          <>
            {warnings.map((warning, index) => (
              <p key={index} className={styles.caption} role="status">
                {warning}
              </p>
            ))}
            <section className={styles.section} aria-label="이 파일에 들어 있는 것">
              <h3 className={styles.sectionTitle}>이 파일에 들어 있는 것</h3>
              <div className={styles.contents}>
                {rows.map(({ title, description, icon, choice, present }) => (
                  <div
                    className={styles.contentRow}
                    key={title}
                    data-absent={choice && !present ? true : undefined}
                  >
                    <span className={styles.icon}>
                      <Icon name={icon} size={16} />
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <span className={styles.caption}>{description}</span>
                    </span>
                    {choice && present && (
                      <Checkbox
                        className={styles.includeChoice}
                        checked={archiveChoice[choice]}
                        disabled={pending || installed}
                        aria-label={`${title} 함께 가져오기`}
                        label="함께 가져오기"
                        onChange={(event) =>
                          onArchiveChoiceChange({ ...archiveChoice, [choice]: event.target.checked })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>대화 지침</h3>
              <div className={styles.instructions}>
                {pack.characters.map((character) => (
                  <div key={character.sourceId}>
                    {pack.characters.length > 1 && <strong>{character.name}</strong>}
                    <p>{character.personality}</p>
                    <p>{character.instructions}</p>
                  </div>
                ))}
              </div>
              <p className={styles.caption}>
                대화 지침은 친구의 말과 행동을 정해요. 데려오기 전에 꼭 읽어 보세요.
              </p>
            </section>
            <details>
              <summary className={styles.details}>원문과 포함된 자료 모두 확인</summary>
              <CharacterPackPreview pack={pack} />
            </details>
            <div className={styles.actions}>
              <Button variant="ghost" disabled={pending} onClick={onCancel}>
                취소
              </Button>
              {installed ? (
                <Button onClick={onJoin} disabled={pending || joinDisabled}>
                  가져온 친구와 함께 지내기
                </Button>
              ) : (
                <Button onClick={onInstall} disabled={pending}>
                  내용 확인 후 설치
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className={styles.caption}>
            캐릭터 파일을 선택하면 친구와 포함된 자료를 확인할 수 있어요.
          </p>
        )}
        {pending && (
          <p className={styles.caption} role="status">
            처리 중…
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.caption} role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
