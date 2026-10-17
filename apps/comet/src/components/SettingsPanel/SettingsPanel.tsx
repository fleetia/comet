import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { ProfileLink, Tabs as CometTabs, Dialog } from "@comet/ui";
import { Button, ActionBar, Inline, SaveStatus } from "../../ui";
import { OrganizerSettings } from "../OrganizerSettings/OrganizerSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ConversationSettings } from "./ConversationSettings";
import { quietHoursError } from "./QuietHoursSettings";
import type { Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { DesktopPreferences } from "../DesktopPreferences/DesktopPreferences";
import { useSettingsDraft, type SettingsDraft } from "../../hooks/useSettingsDraft";
import { UserSettings } from "../UserSettings/UserSettings";
import { ModelSettings } from "../ModelSettings/ModelSettings";
import { getAiProviderLabel } from "../../aiProviders";
import { TalkPackPanel } from "../TalkPackPanel/TalkPackPanel";
import { WordbookPanel } from "../WordbookPanel/WordbookPanel";
import { CharacterManager } from "../CharacterManager/CharacterManager";
import { WidgetManager } from "../../widgets/WidgetManager/WidgetManager";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import { useSettingsNavigation } from "./useSettingsNavigation";
import * as s from "../../lagrange.css";
import * as styles from "./settings.css";

type Props = { snapshot: Snapshot; preview?: boolean; initialSection?: string };
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
    <footer className={styles.saveBar} role="group" aria-label={`${label} 저장 영역`}>
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
              {label === "AI 연결" ? `${getAiProviderLabel(draft.settings)} 설정` : label}
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
      {!valid && !draft.validInterval && (
        <p className={s.error} role="alert">
          이야기 간격을 1~60분으로 입력해 주세요.
        </p>
      )}
    </footer>
  );
}
export function SettingsPanel({ snapshot, preview = false, initialSection }: Props): JSX.Element {
  const { section, visited, navigate, navigationError, memoryTabRequest } =
    useSettingsNavigation(initialSection);
  const automatic = useSettingsDraft(snapshot.settings, "automatic");
  const model = useSettingsDraft(snapshot.settings, "model");
  const [organizerDirty, setOrganizerDirty] = useState(false);
  const [widgetsDirty, setWidgetsDirty] = useState(false);
  const [widgetsBusy, setWidgetsBusy] = useState(false);
  const [charactersDirty, setCharactersDirty] = useState(false);
  const [wordbookDirty, setWordbookDirty] = useState(false);
  const [userDirty, setUserDirty] = useState(false);
  const [generalDirty, setGeneralDirty] = useState(false);
  const [shortcutDirty, setShortcutDirty] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [talkVisited, setTalkVisited] = useState(initialSection === "talk");
  const [wordbookVisited, setWordbookVisited] = useState(initialSection !== "talk");
  const [dialogueView, setDialogueView] = useState<"wordbook" | "talk">(
    initialSection === "talk" ? "talk" : "wordbook",
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const dirty = {
    characters: charactersDirty,
    widgets: widgetsDirty,
    automatic: automatic.hasChanges,
    dialogue: wordbookDirty,
    model: model.hasChanges || organizerDirty,
    desktop: generalDirty,
    user: userDirty,
    general: userDirty || shortcutDirty,
  };
  const hasChanges = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (isDesktop())
      void command("set_settings_dirty", { dirty: hasChanges || widgetsBusy }).catch(
        (cause: unknown) => setActionError(errorText(cause)),
      );
  }, [hasChanges, widgetsBusy]);
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
    if (name === "quit_app" && (widgetsBusy || updateBusy)) return;
    setActionError(null);
    try {
      await command(name, args);
    } catch (cause) {
      setActionError(errorText(cause));
    }
  }
  const Container = preview ? "section" : "main";
  const topSection =
    section === "dialogue"
      ? "automatic"
      : section === "user" || section === "organizer"
        ? "general"
        : section;
  const topSections = [
    { value: "characters", label: "친구들", icon: "look" as const, content: null },
    { value: "automatic", label: "대화", icon: "chat" as const, content: null },
    { value: "desktop", label: "바탕화면", icon: "calendar" as const, content: null },
    { value: "widgets", label: "위젯", icon: "grid" as const, content: null },
    { value: "model", label: "AI 연결", icon: "memory" as const, content: null },
    { value: "general", label: "일반", icon: "gear" as const, content: null },
  ];
  const externalPanels = Object.fromEntries(
    topSections.map((item) => [
      item.value,
      {
        tabId: `settings-${item.value}-tab`,
        panelId: `settings-${item.value === "automatic" && section === "dialogue" ? "dialogue" : item.value === "general" && (section === "user" || section === "organizer") ? section : item.value}-panel`,
      },
    ]),
  );
  return (
    <Container
      className={`${styles.window} ${preview ? styles.preview : ""}`}
      data-section={section}
    >
      <WindowHeader
        nativeControls
        className={styles.settingsHeader}
        label="설정 닫기"
        preview={preview}
        actions={
          <ProfileLink
            className={styles.profileLink}
            href="#user"
            avatar={
              <span className={styles.profileAvatar} aria-hidden="true">
                {Array.from(snapshot.user?.name || "여행자")[0]}
              </span>
            }
            onClick={(event) => {
              event.preventDefault();
              navigate("user");
            }}
          >
            {snapshot.user?.name || "여행자"}
          </ProfileLink>
        }
      >
        <CometTabs
          externalPanels={externalPanels}
          items={topSections}
          value={topSection}
          onValueChange={navigate}
          onReselect={navigate}
          label="설정 항목"
          className={styles.topTabs}
        />
      </WindowHeader>
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
      <fieldset
        className={styles.settingsWorkspace}
        data-section={section}
        disabled={updateBusy}
        aria-label="설정 내용"
      >
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-characters-panel"
          aria-labelledby="settings-characters-tab"
          hidden={section !== "characters"}
          className={styles.settingsPage}
        >
          {visited.has("characters") && (
            <CharacterManager
              snapshot={snapshot}
              embedded
              onDirtyChange={setCharactersDirty}
              memoryTabRequest={memoryTabRequest}
            />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-widgets-panel"
          aria-labelledby="settings-widgets-tab"
          hidden={section !== "widgets"}
          className={styles.settingsPage}
        >
          {visited.has("widgets") && (
            <WidgetManager
              embedded
              active={section === "widgets"}
              onDirtyChange={setWidgetsDirty}
              onBusyChange={setWidgetsBusy}
            />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-automatic-panel"
          aria-labelledby="settings-automatic-tab"
          hidden={section !== "automatic"}
          className={styles.settingsPage}
        >
          {visited.has("automatic") && (
            <ConversationSettings
              snapshot={snapshot}
              draft={automatic}
              onOpenModel={() => navigate("model")}
              onOpenDialogue={(kind) => {
                setDialogueView(kind);
                if (kind === "talk") setTalkVisited(true);
                else setWordbookVisited(true);
                navigate("dialogue");
              }}
              footer={
                <DraftActions
                  draft={automatic}
                  label="자동 대화"
                  valid={automatic.validInterval && !quietHoursError(automatic.settings.quietHours)}
                  blocked={updateBusy}
                />
              }
            />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-desktop-panel"
          aria-labelledby="settings-desktop-tab"
          hidden={section !== "desktop"}
          className={styles.settingsPage}
        >
          {visited.has("desktop") && (
            <DesktopPreferences hidden={snapshot.runtime.hidden} onDirtyChange={setGeneralDirty} />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-model-panel"
          aria-labelledby="settings-model-tab"
          hidden={section !== "model"}
          className={styles.settingsPage}
        >
          {visited.has("model") && (
            <ModelSettings
              snapshot={snapshot}
              draft={model}
              automaticDraft={automatic}
              automaticFooter={
                <DraftActions draft={automatic} label="자동 대화" blocked={updateBusy} />
              }
              onOrganizerDirtyChange={setOrganizerDirty}
              onOpenOrganizer={() => navigate("organizer")}
              footer={<DraftActions draft={model} label="AI 연결" blocked={updateBusy} />}
            />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-dialogue-panel"
          aria-labelledby="settings-automatic-tab"
          hidden={section !== "dialogue"}
          className={styles.settingsPage}
        >
          {visited.has("dialogue") && (
            <div className={styles.subpage}>
              <div className={styles.breadcrumb}>
                <Button variant="quiet" size="compact" onClick={() => navigate("automatic")}>
                  ‹ 대화
                </Button>
                <span>{dialogueView === "wordbook" ? "단어장" : "대화팩"}</span>
              </div>
              <div hidden={dialogueView !== "wordbook"} className={styles.dialogueSubview}>
                {(wordbookVisited || dialogueView === "wordbook") && (
                  <WordbookPanel
                    entries={snapshot.wordbook}
                    owners={snapshot.characters.active.map((id) =>
                      snapshot.characters.installed.find((character) => character.id === id),
                    )}
                    title="개인 단어장"
                    description="키워드가 포함되면 등록한 대사를 모델 없이 그대로 재생해요."
                    onDirtyChange={setWordbookDirty}
                  />
                )}
              </div>
              <div hidden={dialogueView !== "talk"} className={styles.dialogueSubview}>
                {(talkVisited || dialogueView === "talk") && <TalkPackPanel />}
              </div>
            </div>
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-general-panel"
          aria-labelledby="settings-general-tab"
          hidden={section !== "general"}
          className={styles.settingsPage}
        >
          {visited.has("general") && (
            <GeneralSettings
              snapshot={snapshot}
              active={section === "general"}
              onOpenUser={() => navigate("user")}
              onOpenOrganizer={() => navigate("organizer")}
              onBusyChange={setUpdateBusy}
              quitDisabled={widgetsBusy || updateBusy}
              hasChanges={hasChanges}
              onShortcutDirtyChange={setShortcutDirty}
              onQuit={() => (hasChanges ? setConfirmExit(true) : void act("quit_app"))}
              onToggleCharacters={() =>
                void act(snapshot.runtime.hidden ? "show_characters" : "hide_boxes")
              }
            />
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-user-panel"
          aria-labelledby="settings-general-tab"
          hidden={section !== "user"}
          className={styles.settingsPage}
        >
          {visited.has("user") && (
            <div className={styles.subpage}>
              <div className={styles.breadcrumb}>
                <Button variant="quiet" size="compact" onClick={() => navigate("general")}>
                  ‹ 일반
                </Button>
                <span>사용자</span>
              </div>
              <UserSettings snapshot={snapshot} onDirtyChange={setUserDirty} />
            </div>
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="settings-organizer-panel"
          aria-labelledby="settings-general-tab"
          hidden={section !== "organizer"}
          className={styles.settingsPage}
        >
          {visited.has("organizer") && (
            <div className={styles.subpage}>
              <div className={styles.breadcrumb}>
                <Button variant="quiet" size="compact" onClick={() => navigate("general")}>
                  ‹ 일반
                </Button>
                <span>Ex-brain</span>
              </div>
              <OrganizerSettings onDirtyChange={setOrganizerDirty} />
            </div>
          )}
        </section>
      </fieldset>
      <Dialog
        isOpen={confirmExit}
        onOpenChange={setConfirmExit}
        title="저장하지 않고 종료할까요?"
        variant="confirm"
        footer={
          <Inline gap="sm">
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              계속 편집
            </Button>
            <Button
              variant="primary"
              disabled={widgetsBusy || updateBusy}
              onClick={() => void act("quit_app", { force: true })}
            >
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
