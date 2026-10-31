import { useEffect, useRef, useState, type JSX } from "react";
import { ExitIcon, HideIcon, MemoryIcon } from "@comet/icon";
import { Button, Dialog, SettingControlRow, SettingsSummary, Switch } from "@comet/ui";
import type { Snapshot } from "../../types";
import { command, errorText } from "../../hooks/useSnapshot";
import { error as errorStyle } from "../../common.css";
import { AutostartSettings } from "../AutostartSettings/AutostartSettings";
import { LauncherSettings } from "../Launcher/LauncherSettings";
import { UpdatePanel } from "../UpdatePanel/UpdatePanel";
import { appearanceSummary } from "../ThemeSettings/ThemeSettings";
import { useAppearance } from "../../hooks/useAppearance";
import * as styles from "./figmaSettings.css";

type Props = {
  snapshot: Snapshot;
  active: boolean;
  onOpenUser: () => void;
  onOpenOrganizer: () => void;
  onOpenTheme: () => void;
  onBusyChange: (busy: boolean) => void;
  hasChanges: boolean;
  onShortcutDirtyChange: (dirty: boolean) => void;
  onQuit: () => void;
  quitDisabled?: boolean;
  onToggleCharacters: () => void;
};
function fileManagerLabel(): string {
  const agent = navigator.userAgent;
  if (agent.includes("Mac")) return "Finder에서 보기";
  if (agent.includes("Windows")) return "탐색기에서 보기";
  return "폴더 열기";
}

function clearStoredDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("comet.")) localStorage.removeItem(key);
    }
  } catch {
    // 저장소를 쓸 수 없으면 지울 초안도 없다.
  }
}

export function GeneralSettings({
  snapshot,
  active,
  onOpenUser,
  onOpenOrganizer,
  onOpenTheme,
  onBusyChange,
  hasChanges,
  onShortcutDirtyChange,
  onQuit,
  quitDisabled = false,
  onToggleCharacters,
}: Props): JSX.Element {
  const name = snapshot.user?.name || "여행자";
  const { appearance } = useAppearance();
  const [consentPending, setConsentPending] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const consentSaving = useRef(false);
  async function saveConsent(enabled: boolean): Promise<void> {
    if (consentSaving.current) return;
    consentSaving.current = true;
    setConsentPending(true);
    setConsentError(null);
    try {
      await command("set_analytics_consent", { enabled });
    } catch (cause) {
      setConsentError(errorText(cause));
    } finally {
      consentSaving.current = false;
      setConsentPending(false);
    }
  }
  const [folderError, setFolderError] = useState<string | null>(null);
  async function revealDataFolder(): Promise<void> {
    setFolderError(null);
    try {
      await command("reveal_data_folder");
    } catch (cause) {
      setFolderError(errorText(cause));
    }
  }
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetting = useRef(false);
  useEffect(() => {
    if (!active && !resetting.current) {
      setResetOpen(false);
      setResetError(null);
      setFolderError(null);
    }
  }, [active]);
  const resetDisabled = quitDisabled || hasChanges;
  async function resetApp(): Promise<void> {
    if (resetting.current || resetDisabled) return;
    resetting.current = true;
    setResetPending(true);
    setResetError(null);
    try {
      await command("reset_app");
      clearStoredDrafts();
    } catch (cause) {
      setResetError(errorText(cause));
      resetting.current = false;
      setResetPending(false);
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
              {active && <LauncherSettings compact onDirtyChange={onShortcutDirtyChange} />}
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
            <SettingsSummary
              className={styles.groupLink}
              title="테마"
              description={appearanceSummary(appearance)}
              onClick={onOpenTheme}
            />
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
          <div className={styles.group}>
            <SettingControlRow
              className={styles.row}
              title="데이터 폴더"
              description="대화·기억·설정이 저장된 곳이에요. 열기만 하고 바꾸지 않아요"
              control={
                <Button variant="ghost" size="small" onClick={() => void revealDataFolder()}>
                  {fileManagerLabel()}
                </Button>
              }
            />
          </div>
          {folderError && (
            <p role="alert" className={errorStyle}>
              {folderError}
            </p>
          )}
          <div className={styles.group}>
            <SettingControlRow
              className={styles.row}
              title="사용 통계 보내기"
              description="기능 사용·오류·AI 요청 성공 여부를 Google Analytics로 보내요"
              control={
                <Switch
                  aria-label="사용 통계 보내기"
                  aria-busy={consentPending}
                  checked={snapshot.settings.analyticsConsent}
                  disabled={consentPending}
                  onChange={(event) => void saveConsent(event.target.checked)}
                />
              }
            />
          </div>
          {consentError && (
            <p role="alert" className={errorStyle}>
              {consentError}
            </p>
          )}
          <div className={styles.group}>
            <SettingControlRow
              className={styles.row}
              title="초기화"
              description="모든 설정·대화·기억·내려받은 모델을 지우고 별꼬리만 남겨요"
              control={
                <Button
                  variant="ghost"
                  size="small"
                  disabled={resetDisabled}
                  onClick={() => setResetOpen(true)}
                >
                  초기화
                </Button>
              }
            />
          </div>
        </section>
      </div>
      <Dialog
        isOpen={resetOpen}
        title="comet을 초기화할까요?"
        variant="confirm"
        onOpenChange={(open) => {
          if (!resetPending) setResetOpen(open);
        }}
        onCancel={(event) => {
          if (resetPending) event.preventDefault();
        }}
        footer={
          <>
            <Button variant="ghost" disabled={resetPending} onClick={() => setResetOpen(false)}>
              취소
            </Button>
            <Button
              variant="primary"
              disabled={resetPending || resetDisabled}
              onClick={() => void resetApp()}
            >
              모두 지우고 초기화
            </Button>
          </>
        }
      >
        <p>
          설정, 대화, 기억, 단어장, 위젯, API 키와 ChatGPT 연결, 내려받은 모델이 모두 지워지고
          별꼬리만 남아요. 끝나면 comet이 다시 시작돼요. 이 작업은 되돌릴 수 없어요.
        </p>
        {resetError && (
          <p role="alert" className={errorStyle}>
            {resetError}
          </p>
        )}
      </Dialog>
    </div>
  );
}
