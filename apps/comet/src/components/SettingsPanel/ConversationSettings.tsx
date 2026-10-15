import { useState, type JSX, type ReactNode } from "react";
import { ChatIcon, PauseIcon, PetIcon, ResumeIcon, StoryIcon, TextIcon } from "@comet/icon";
import {
  Button,
  SegmentedControl,
  SettingControlRow,
  SettingsSummary,
  Stepper,
  Switch,
  TextInput,
} from "@comet/ui";
import type { Snapshot } from "../../types";
import type { SettingsDraft } from "../../hooks/useSettingsDraft";
import { spriteSource } from "../characterIdentity";
import { PROVIDER_LABELS } from "../ModelSettings/ModelSettings";
import { quietHoursError } from "./QuietHoursSettings";
import * as styles from "./figmaSettings.css";
import * as local from "./conversationSettings.css";

type Props = {
  snapshot: Snapshot;
  draft: SettingsDraft;
  footer: ReactNode;
  onOpenModel: () => void;
  onOpenDialogue: (kind: "wordbook" | "talk") => void;
};
export function ConversationSettings({
  snapshot,
  draft,
  footer,
  onOpenModel,
  onOpenDialogue,
}: Props): JSX.Element {
  const [pauseDuration, setPauseDuration] = useState("60");
  const settings = draft.settings;
  const quiet = settings.quietHours;
  const paused = snapshot.runtime.paused;
  const character = snapshot.characters.installed.find((item) =>
    snapshot.characters.active.includes(item.id),
  );
  const sprite = spriteSource(character, "기쁨");
  const line = character?.definition.idleLines[0]?.text || character?.definition.greeting[0]?.text;
  const generationKey =
    settings.mode === "local"
      ? "localIdleEnabled"
      : settings.mode === "chatgpt"
        ? "chatgptIdleEnabled"
        : "apiIdleEnabled";
  const error = quietHoursError(quiet);
  return (
    <div className={styles.split}>
      <aside className={styles.inspector}>
        <h1 className={styles.inspectorTitle}>
          <span className={styles.icon}>
            <ChatIcon size={18} />
          </span>
          자동 잡담
        </h1>
        <div className={styles.preview}>
          {line && (
            <div className={styles.balloon}>
              <p className={styles.speaker}>{character?.definition.name}</p>
              <p className={styles.copy}>{line}</p>
            </div>
          )}
          {sprite ? (
            <img className={styles.previewSprite} src={sprite} alt={character?.definition.name} />
          ) : (
            <PetIcon size={104} />
          )}
        </div>
        <div className={styles.note}>
          <span className={styles.statusDot} />
          <div className={styles.noteCopy}>
            <strong>
              {paused
                ? "자동 잡담 쉬는 중"
                : settings.autonomousEnabled
                  ? "자동 잡담 중"
                  : "자동 잡담 꺼짐"}
            </strong>
            <span className={styles.caption}>
              {paused
                ? snapshot.runtime.pausedUntil
                  ? `${new Date(snapshot.runtime.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}까지 자동 잡담 쉬는 중`
                  : "다시 시작할 때까지 조용히 쉬어요"
                : `${settings.idleMinutes}분 안팎으로 먼저 말을 걸어요`}
            </span>
          </div>
        </div>
        <div className={styles.controls}>
          <span className={styles.caption}>쉬는 기간</span>
          <SegmentedControl
            label="쉬는 기간"
            value={pauseDuration}
            onValueChange={setPauseDuration}
            appearance="contained"
            options={[
              { value: "60", label: "1시간" },
              { value: "restart", label: "다시 시작할 때까지" },
            ]}
          />
        </div>
        <Button
          className={styles.fullButton}
          disabled={!!draft.pending}
          onClick={() =>
            void draft.run("set_paused", {
              paused: !paused,
              ...(!paused && pauseDuration === "60" ? { minutes: 60 } : {}),
            })
          }
        >
          {paused ? <ResumeIcon size={15} /> : <PauseIcon size={15} />}
          {paused ? "자동 잡담 다시 시작" : "자동 잡담 쉬기"}
        </Button>
        <p className={styles.caption}>
          쉬는 동안에도 직접 말을 걸면 답해요. 앱을 다시 열면 쉬기가 풀려요.
        </p>
      </aside>
      <div className={styles.right}>
        <fieldset className={styles.form} disabled={!!draft.pending}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>먼저 말 걸기</h2>
            <div className={styles.group}>
              <SettingControlRow
                className={styles.row}
                title="바탕화면에서 먼저 이야기하기"
                description="꺼도 간격과 자리 비우기 설정은 그대로예요"
                control={
                  <Switch
                    aria-label="바탕화면에서 먼저 이야기하기"
                    checked={settings.autonomousEnabled}
                    onChange={(event) => draft.change("autonomousEnabled", event.target.checked)}
                  />
                }
              />
              <SettingControlRow
                className={styles.row}
                title="이야기 간격"
                description="1~60분 · 실제 간격은 조금씩 달라져요"
                control={
                  <Stepper
                    aria-label="이야기 간격"
                    min={1}
                    max={60}
                    value={settings.idleMinutes}
                    unit="분"
                    onValueChange={(value) => draft.change("idleMinutes", value)}
                  />
                }
              />
              <SettingControlRow
                className={styles.row}
                title="가끔 자리 비우기"
                description="잠시 떠났다가 인사하며 돌아와요"
                control={
                  <Switch
                    aria-label="가끔 자리 비우기"
                    checked={settings.randomPresenceEnabled}
                    disabled={!settings.autonomousEnabled}
                    onChange={(event) =>
                      draft.change("randomPresenceEnabled", event.target.checked)
                    }
                  />
                }
              />
              <SettingControlRow
                className={styles.row}
                title="AI로 새 잡담 만들기"
                description={`지금 연결: ${PROVIDER_LABELS[settings.mode]}`}
                control={
                  <div className={local.generation}>
                    <Button size="small" variant="ghost" onClick={onOpenModel}>
                      AI 연결
                    </Button>
                    <Switch
                      aria-label="AI로 새 잡담 만들기"
                      checked={settings[generationKey]}
                      disabled={!settings.autonomousEnabled}
                      onChange={(event) => draft.change(generationKey, event.target.checked)}
                    />
                  </div>
                }
              />
            </div>
          </section>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>조용한 시간</h2>
            <div className={styles.group}>
              <SettingControlRow
                className={styles.row}
                title="정해진 시간에 자동 잡담 쉬기"
                description="자동 잡담과 장난, AI 위젯 자동 제작이 함께 쉬어요"
                control={
                  <Switch
                    aria-label="정해진 시간에 자동 잡담 쉬기"
                    checked={quiet.enabled}
                    onChange={(event) =>
                      draft.change("quietHours", { ...quiet, enabled: event.target.checked })
                    }
                  />
                }
              />
              <fieldset
                className={local.quietControls}
                disabled={!quiet.enabled}
                aria-label="조용한 시간과 시작 요일"
              >
                <div className={local.timeControls}>
                  <span className={styles.caption}>시간</span>
                  <TextInput
                    aria-label="조용한 시간 시작"
                    type="time"
                    value={quiet.start}
                    onChange={(event) =>
                      draft.change("quietHours", { ...quiet, start: event.target.value })
                    }
                  />
                  <span>–</span>
                  <TextInput
                    aria-label="조용한 시간 종료"
                    type="time"
                    value={quiet.end}
                    onChange={(event) =>
                      draft.change("quietHours", { ...quiet, end: event.target.value })
                    }
                  />
                </div>
                <div className={local.weekdays}>
                  <span className={styles.caption}>요일</span>
                  {["월", "화", "수", "목", "금", "토", "일"].map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      aria-label={`${label}요일`}
                      aria-pressed={quiet.weekdays.includes(day)}
                      className={local.weekday}
                      onClick={() =>
                        draft.change("quietHours", {
                          ...quiet,
                          weekdays: quiet.weekdays.includes(day)
                            ? quiet.weekdays.filter((item) => item !== day)
                            : [...quiet.weekdays, day].sort((a, b) => a - b),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <p className={styles.caption}>
              직접 대화와 타이머·일정·기한 알림은 그대로 와요. 자정을 넘기면 시작한 요일을 따라요.
            </p>
            {error && <p role="alert">{error}</p>}
          </section>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>대사</h2>
            <div className={styles.summaryGrid}>
              <SettingsSummary
                className={styles.summary}
                title="단어장"
                description="이 말을 하면 정해 둔 대사로 답해요"
                leading={
                  <span className={styles.icon}>
                    <TextIcon size={20} />
                  </span>
                }
                count={`${snapshot.wordbook.length}개`}
                onClick={() => onOpenDialogue("wordbook")}
              />
              <SettingsSummary
                className={styles.summary}
                title="대화팩"
                description="시간·날씨·위젯에 맞춰 이야기해요"
                leading={
                  <span className={styles.icon}>
                    <StoryIcon size={20} />
                  </span>
                }
                onClick={() => onOpenDialogue("talk")}
              />
            </div>
          </section>
        </fieldset>
        {(draft.hasChanges || draft.pending || draft.error || draft.notice) && (
          <div className={styles.save}>{footer}</div>
        )}
      </div>
    </div>
  );
}
