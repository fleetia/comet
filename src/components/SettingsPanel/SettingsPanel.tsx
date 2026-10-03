import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Button,
  ActionBar,
  Checkbox,
  Dialog,
  Inline,
  SaveStatus,
  SectionHeader,
  SettingsRow,
  Surface,
  StatusMarker,
  Text,
  VisuallyHidden,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "@fleetia/lagrange";
import { version } from "../../../package.json";
import type { Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { LauncherSettings } from "../Launcher/LauncherSettings";
import { DesktopPreferences } from "../DesktopPreferences/DesktopPreferences";
import { AutostartSettings } from "../AutostartSettings/AutostartSettings";
import { UpdatePanel } from "../UpdatePanel/UpdatePanel";
import { useSettingsDraft, type SettingsDraft } from "../../hooks/useSettingsDraft";
import { UserSettings } from "../UserSettings/UserSettings";
import { ModelSettings } from "../ModelSettings/ModelSettings";
import { TalkPackPanel } from "../TalkPackPanel/TalkPackPanel";
import { WordbookPanel } from "../WordbookPanel/WordbookPanel";
import { CharacterManager } from "../CharacterManager/CharacterManager";
import { WidgetManager } from "../../widgets/WidgetManager/WidgetManager";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import { SETTINGS_SECTIONS, useSettingsNavigation } from "./useSettingsNavigation";
import * as s from "../../lagrange.css";
import * as d from "../../desktop.css";
import * as styles from "./settings.css";

type Props = { snapshot: Snapshot; preview?: boolean; initialSection?: string };
const PAGE_DESCRIPTIONS: Record<string, string> = {
  characters: "함께 지낼 캐릭터를 고르고 모습과 대사를 편집해요.",
  widgets: "위젯을 선택하고 연결과 바탕화면 표시를 관리해요.",
  automatic: "먼저 이야기하는 간격과 새 잡담 생성을 설정해요.",
  wordbook: "키워드에 맞춰 등록한 대사를 그대로 재생해요.",
  talk: "설치한 대화팩의 출처와 내용을 확인해요.",
  user: "사용자 이름과 기억의 주인을 관리해요.",
  model: "대화 방식과 기억 검색을 각각 설정해요.",
  general: "앱 시작, 바탕화면 표시와 업데이트를 관리해요.",
};
function DraftActions({
  draft,
  label,
  valid = true,
  blocked = false,
}: {
  draft: SettingsDraft;
  label: string;
  valid?: boolean;
  blocked?: boolean;
}): JSX.Element {
  return (
    <footer className={styles.saveBar}>
      <ActionBar
        className={styles.footerBar}
        status={
          <div className={styles.footerStatus}>
            <SaveStatus
              state={
                draft.pending === "save_settings"
                  ? "saving"
                  : draft.error
                    ? "error"
                    : draft.notice
                      ? "saved"
                      : "idle"
              }
              message={
                draft.error ??
                draft.notice ??
                (draft.hasChanges ? "저장하지 않은 변경이 있어요." : "저장된 설정이에요.")
              }
            />
            <span className={s.quiet}>
              {label === "AI 연결"
                ? `${draft.settings.mode === "local" ? "로컬 모델" : "외부 API"} 설정`
                : label}
            </span>
          </div>
        }
      >
        <Inline className={styles.footerActions} gap="sm">
          <Button
            variant="quiet"
            className={styles.cancelButton}
            disabled={blocked || !!draft.pending || !draft.hasChanges}
            onClick={draft.reset}
          >
            변경 취소
          </Button>
          <Button
            variant="primary"
            className={styles.saveButton}
            disabled={blocked || !!draft.pending || !draft.hasChanges || !valid}
            onClick={() => void draft.run("save_settings")}
          >
            {label} 저장
          </Button>
        </Inline>
      </ActionBar>
      {!valid && (
        <p className={s.error} role="alert">
          이야기 간격을 1~60분으로 입력해 주세요.
        </p>
      )}
    </footer>
  );
}
export function SettingsPanel({ snapshot, preview = false, initialSection }: Props): JSX.Element {
  const { section, visited, navigate, navigationError, memoryTabRequest } = useSettingsNavigation(
    snapshot.user ? initialSection : "user",
  );
  const automatic = useSettingsDraft(snapshot.settings, "automatic");
  const model = useSettingsDraft(snapshot.settings, "model");
  const [widgetsDirty, setWidgetsDirty] = useState(false);
  const [charactersDirty, setCharactersDirty] = useState(false);
  const [wordbookDirty, setWordbookDirty] = useState(false);
  const [userDirty, setUserDirty] = useState(false);
  const [generalDirty, setGeneralDirty] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dirty = {
    characters: charactersDirty,
    widgets: widgetsDirty,
    automatic: automatic.hasChanges,
    wordbook: wordbookDirty,
    talk: false,
    user: userDirty,
    model: model.hasChanges,
    general: generalDirty,
  };
  const hasChanges = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (isDesktop())
      void command("set_settings_dirty", { dirty: hasChanges }).catch((cause: unknown) =>
        setActionError(errorText(cause)),
      );
  }, [hasChanges]);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("confirm-settings-exit", () => setConfirmExit(true))
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((cause: unknown) => setActionError(errorText(cause)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  async function act(name: string, args?: Record<string, unknown>): Promise<void> {
    setActionError(null);
    try {
      await command(name, args);
    } catch (cause) {
      setActionError(errorText(cause));
    }
  }
  const current = SETTINGS_SECTIONS.find((item) => item.id === section)!;
  const Container = preview ? "section" : "main";
  return (
    <Container className={`${styles.window} ${preview ? styles.preview : ""}`}>
      <WindowHeader className={styles.header} label="설정 닫기" title="설정" preview={preview} />
      <Tabs
        value={section}
        onValueChange={navigate}
        orientation="vertical"
        className={styles.layout}
      >
        <aside className={styles.sidebar}>
          <TabList aria-label="설정 항목" className={styles.navigation}>
            {SETTINGS_SECTIONS.map((item, index) => (
              <div key={item.id}>
                {(index === 0 || SETTINGS_SECTIONS[index - 1]?.group !== item.group) && (
                  <p className={styles.groupLabel}>{item.group}</p>
                )}
                <Tab value={item.id} className={styles.navigationItem}>
                  {item.label}
                  {dirty[item.id] && (
                    <StatusMarker shape="square" tone="muted">
                      <VisuallyHidden>저장하지 않은 변경</VisuallyHidden>
                    </StatusMarker>
                  )}
                </Tab>
              </div>
            ))}
          </TabList>
          <Text variant="caption" tone="muted" className={styles.sidebarNote}>
            comet · {version}
          </Text>
        </aside>
        <div className={styles.workspace}>
          {section !== "characters" && (
            <div className={styles.pageHeading}>
              <h1>{current.label}</h1>
              <span className={styles.pageDescription}>
                {PAGE_DESCRIPTIONS[section]}
                {dirty[section] && <span className={styles.pageDirty}> · 미저장 변경 있음</span>}
              </span>
            </div>
          )}
          {(navigationError || actionError) && (
            <p className={s.error} role="alert">
              {navigationError || actionError}
            </p>
          )}
          {updateBusy && (
            <p className={s.quiet} role="status">
              업데이트를 준비하는 동안 편집을 잠시 멈춰요.
            </p>
          )}
          <fieldset className={styles.scrollArea} disabled={updateBusy} aria-label="설정 내용">
            <TabPanel value="characters" className={`${styles.panel} ${styles.characterPanel}`}>
              {visited.has("characters") && (
                <CharacterManager
                  snapshot={snapshot}
                  embedded
                  onDirtyChange={setCharactersDirty}
                  memoryTabRequest={memoryTabRequest}
                />
              )}
            </TabPanel>
            <TabPanel value="widgets" className={styles.panel}>
              {visited.has("widgets") && (
                <WidgetManager
                  embedded
                  active={section === "widgets"}
                  onDirtyChange={setWidgetsDirty}
                />
              )}
            </TabPanel>
            <TabPanel value="automatic" className={styles.panel}>
              <Surface className={styles.automaticPanel}>
                <fieldset
                  className={`${d.fieldset} ${styles.panelBody}`}
                  disabled={!!automatic.pending}
                >
                  <Surface tone="accent" padding="inline" className={styles.inlineHighlight}>
                    <SectionHeader
                      title="먼저 이야기하기"
                      headingVariant="subsection"
                      rule="none"
                    />
                    <span className={s.quiet}>
                      {snapshot.runtime.paused ? "현재 · 일시정지" : "현재 · 자동 대화"}
                    </span>
                  </Surface>
                  <SettingsRow
                    className={styles.settingsRow}
                    label={<span id="automatic-enabled-label">바탕화면에서 먼저 이야기하기</span>}
                    description="꺼도 간격과 생성 허용은 유지돼요."
                  >
                    <Checkbox
                      className={styles.rowControl}
                      aria-labelledby="automatic-enabled-label"
                      checked={automatic.settings.autonomousEnabled}
                      onChange={(event) =>
                        automatic.change("autonomousEnabled", event.target.checked)
                      }
                    >
                      사용
                    </Checkbox>
                  </SettingsRow>
                  <SettingsRow
                    className={styles.settingsRow}
                    label={<span id="automatic-interval-label">이야기 간격</span>}
                    description="1~60분. 실제 간격은 조금씩 달라져요."
                  >
                    <div className={styles.automaticField}>
                      <TextField
                        style={{ width: 104 }}
                        aria-labelledby="automatic-interval-label"
                        type="number"
                        min={1}
                        max={60}
                        value={automatic.settings.idleMinutes}
                        onChange={(event) =>
                          automatic.change("idleMinutes", Number(event.target.value))
                        }
                      />
                      <span>분</span>
                    </div>
                  </SettingsRow>
                  <SettingsRow
                    className={styles.pausedRow}
                    label="일시정지"
                    description={
                      snapshot.runtime.paused
                        ? snapshot.runtime.pausedUntil
                          ? `${new Date(snapshot.runtime.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}까지 자동 잡담 일시정지 중`
                          : "현재 자동 잡담이 잠시 멈춰 있어요."
                        : "자동 대화가 실행 중이에요."
                    }
                  >
                    <Button
                      className={styles.rowControl}
                      variant="secondary"
                      disabled={!snapshot.runtime.paused}
                      onClick={() => void automatic.run("set_paused", { paused: false })}
                    >
                      다시 시작
                    </Button>
                  </SettingsRow>
                  <section className={styles.settingsSection}>
                    <div className={styles.headingRow}>
                      <h2 className={styles.sectionTitle}>새 잡담 생성</h2>
                      <span className={s.quiet}>AI</span>
                    </div>
                    <SettingsRow
                      className={styles.settingsRow}
                      label={
                        <>
                          <span>로컬 모델</span>
                          <VisuallyHidden id="automatic-local-label">
                            로컬 모델로 새 잡담 만들기
                          </VisuallyHidden>
                        </>
                      }
                      description="이 기기의 모델로 새 잡담을 만들어요."
                    >
                      <Checkbox
                        className={styles.rowControl}
                        aria-label="로컬 모델로 새 잡담 만들기"
                        aria-labelledby="automatic-local-label"
                        disabled={!automatic.settings.autonomousEnabled}
                        checked={automatic.settings.localIdleEnabled}
                        onChange={(event) =>
                          automatic.change("localIdleEnabled", event.target.checked)
                        }
                      >
                        허용
                      </Checkbox>
                    </SettingsRow>
                    <SettingsRow
                      className={styles.settingsRow}
                      label={
                        <>
                          <span>외부 API</span>
                          <VisuallyHidden id="automatic-api-label">
                            API로 새 잡담 만들기
                          </VisuallyHidden>
                        </>
                      }
                      description="자동 요청에 제공자 요금이 발생할 수 있어요."
                    >
                      <Checkbox
                        className={styles.rowControl}
                        aria-labelledby="automatic-api-label"
                        disabled={!automatic.settings.autonomousEnabled}
                        checked={automatic.settings.apiIdleEnabled}
                        onChange={(event) =>
                          automatic.change("apiIdleEnabled", event.target.checked)
                        }
                      >
                        허용
                      </Checkbox>
                    </SettingsRow>
                  </section>
                </fieldset>
                <DraftActions
                  draft={automatic}
                  label="자동 대화"
                  valid={automatic.validInterval}
                  blocked={updateBusy}
                />
              </Surface>
            </TabPanel>
            <TabPanel value="model" className={styles.panel}>
              {visited.has("model") && (
                <ModelSettings
                  snapshot={snapshot}
                  draft={model}
                  footer={<DraftActions draft={model} label="AI 연결" blocked={updateBusy} />}
                />
              )}
            </TabPanel>
            <TabPanel value="wordbook" className={styles.panel}>
              {visited.has("wordbook") && (
                <div className={styles.fullPage}>
                  <WordbookPanel
                    entries={snapshot.wordbook}
                    owners={snapshot.characters.active.map((id) =>
                      snapshot.characters.installed.find((character) => character.id === id),
                    )}
                    title="개인 단어장"
                    description="키워드가 포함되면 등록한 대사를 모델 없이 그대로 재생해요. 캐릭터를 바꿔도 유지돼요."
                    onDirtyChange={setWordbookDirty}
                  />
                </div>
              )}
            </TabPanel>
            <TabPanel value="talk" className={styles.panel}>
              {visited.has("talk") && (
                <div className={styles.widePage}>
                  <TalkPackPanel />
                </div>
              )}
            </TabPanel>
            <TabPanel value="user" className={styles.panel}>
              {visited.has("user") && (
                <UserSettings snapshot={snapshot} onDirtyChange={setUserDirty} />
              )}
            </TabPanel>
            <TabPanel value="general" className={styles.panel}>
              {visited.has("general") && (
                <div className={styles.generalLayout}>
                  <DesktopPreferences
                    hidden={snapshot.runtime.hidden}
                    onDirtyChange={setGeneralDirty}
                  >
                    <AutostartSettings active={section === "general"} />
                    <section className={styles.settingsSection}>
                      <SectionHeader title="표시와 종료" headingVariant="subsection" rule="none" />
                      <SettingsRow
                        className={styles.settingsRow}
                        label="바탕화면 캐릭터"
                        description="함께 지내는 캐릭터와 말풍선"
                      >
                        <Button
                          className={styles.rowControl}
                          variant="secondary"
                          onClick={() =>
                            void act(snapshot.runtime.hidden ? "show_characters" : "hide_boxes")
                          }
                        >
                          {snapshot.runtime.hidden ? "캐릭터 표시" : "캐릭터 숨기기"}
                        </Button>
                      </SettingsRow>
                      <SettingsRow
                        className={styles.settingsRow}
                        label="comet 종료"
                        description="미저장 변경이 있으면 먼저 확인해요."
                      >
                        <Button
                          className={styles.rowControl}
                          variant="quiet"
                          onClick={() => (hasChanges ? setConfirmExit(true) : void act("quit_app"))}
                        >
                          앱 종료
                        </Button>
                      </SettingsRow>
                    </section>
                    <LauncherSettings />
                  </DesktopPreferences>
                  <UpdatePanel onBusyChange={setUpdateBusy} hasUnsavedChanges={hasChanges} />
                </div>
              )}
            </TabPanel>
          </fieldset>
        </div>
      </Tabs>
      <Dialog
        isOpen={confirmExit}
        onOpenChange={setConfirmExit}
        title="저장하지 않고 종료할까요?"
        size="small"
        footer={
          <Inline gap="sm">
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              계속 편집
            </Button>
            <Button variant="primary" onClick={() => void act("quit_app", { force: true })}>
              변경을 버리고 종료
            </Button>
          </Inline>
        }
      >
        <p>저장하지 않은 설정과 편집 내용을 버리고 comet을 종료해요.</p>
      </Dialog>
    </Container>
  );
}
