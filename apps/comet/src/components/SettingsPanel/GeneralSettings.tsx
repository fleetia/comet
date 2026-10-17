import { useRef, useState, type JSX } from "react";
import { ExitIcon, HideIcon, MemoryIcon } from "@comet/icon";
import { Button, SettingControlRow, SettingsSummary } from "@comet/ui";
import type { Snapshot } from "../../types";
import { Checkbox } from "../../ui";
import { command, errorText } from "../../hooks/useSnapshot";
import { error as errorStyle } from "../../lagrange.css";
import { AutostartSettings } from "../AutostartSettings/AutostartSettings";
import { LauncherSettings } from "../Launcher/LauncherSettings";
import { UpdatePanel } from "../UpdatePanel/UpdatePanel";
import * as styles from "./figmaSettings.css";

type Props = {
  snapshot: Snapshot;
  active: boolean;
  onOpenUser: () => void;
  onOpenOrganizer: () => void;
  onBusyChange: (busy: boolean) => void;
  hasChanges: boolean;
  onShortcutDirtyChange: (dirty: boolean) => void;
  onQuit: () => void;
  quitDisabled?: boolean;
  onToggleCharacters: () => void;
};
export function GeneralSettings({
  snapshot,
  active,
  onOpenUser,
  onOpenOrganizer,
  onBusyChange,
  hasChanges,
  onShortcutDirtyChange,
  onQuit,
  quitDisabled = false,
  onToggleCharacters,
}: Props): JSX.Element {
  const name = snapshot.user?.name || "여행자";
  const [consentPending, setConsentPending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentSaving = useRef(false);

  async function saveConsent(enabled: boolean): Promise<void> {
    if (consentSaving.current) {
      return;
    }
    consentSaving.current = true;
    setConsentPending(true);
    setConsentError(null);
    try {
      await command("set_analytics_consent", { enabled });
    } catch (cause: unknown) {
      setConsentError(errorText(cause));
    } finally {
      consentSaving.current = false;
      setConsentPending(false);
    }
  }

  return (
    <div className={styles.split}>
      <UpdatePanel onBusyChange={onBusyChange} hasUnsavedChanges={hasChanges} />
      <div className={styles.right}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>시작과 종료</h2>
          <div className={styles.group}>
            <div className={styles.nested}>
              <AutostartSettings active={active} compact />
            </div>
            <div className={styles.nested}>
              <LauncherSettings compact onDirtyChange={onShortcutDirtyChange} />
            </div>
            <SettingControlRow
              className={styles.row}
              title="comet 종료"
              description="저장하지 않은 변경이 있으면 먼저 물어봐요"
              control={
                <Button variant="ghost" size="small" disabled={quitDisabled} onClick={onQuit}>
                  <ExitIcon size={15} />
                  종료
                </Button>
              }
            />
          </div>
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>사용자</h2>
          <div className={styles.summaryGrid}>
            <SettingsSummary
              title={name}
              description="친구들이 부르는 이름"
              leading={<span className={styles.avatar}>{Array.from(name)[0]}</span>}
              className={styles.summary}
              onClick={onOpenUser}
            />
            {!!snapshot.legacyMemoryCount && (
              <SettingsSummary
                title="주인을 정하지 않은 기억"
                description="나눠 주거나 다른 사람 기억으로 둬요"
                count={`${snapshot.legacyMemoryCount}개`}
                leading={
                  <span className={styles.avatar}>
                    <MemoryIcon size={20} />
                  </span>
                }
                className={styles.summary}
                onClick={onOpenUser}
              />
            )}
          </div>
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>화면</h2>
          <div className={styles.group}>
            <SettingControlRow
              className={styles.row}
              title="바탕화면 친구"
              description="함께 지내는 친구와 말풍선"
              control={
                <Button variant="ghost" size="small" onClick={onToggleCharacters}>
                  <HideIcon size={15} />
                  {snapshot.runtime.hidden ? "친구 표시" : "친구 숨기기"}
                </Button>
              }
            />
          </div>
        </section>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>데이터</h2>
          <SettingsSummary
            className={styles.summary}
            title="Ex-brain"
            description="기록과 검색을 부탁하고, 쉬는 동안 자료를 정리해요"
            leading={
              <span className={styles.icon}>
                <MemoryIcon size={20} />
              </span>
            }
            onClick={onOpenOrganizer}
          />
          <Checkbox
            checked={snapshot.settings.analyticsConsent}
            disabled={consentPending}
            aria-busy={consentPending}
            description="선택한 AI 종류, 기능 사용, 오류·비정상 종료와 AI 요청의 성공 여부·응답 시간을 Google Analytics로 보내요. 대화 내용·이름·파일 경로는 보내지 않아요."
            onChange={(event) => void saveConsent(event.target.checked)}
          >
            (선택) 익명 사용 통계 수집에 동의해요
          </Checkbox>
          {consentError && (
            <p role="alert" className={errorStyle}>
              {consentError}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
