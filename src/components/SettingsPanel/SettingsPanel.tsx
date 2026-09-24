import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Button,
  Checkbox,
  Dialog,
  FormField,
  Inline,
  SaveStatus,
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
import { DesktopPreferences } from "../DesktopPreferences/DesktopPreferences";
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
function DraftActions({
  draft,
  label,
  valid = true,
}: {
  draft: SettingsDraft;
  label: string;
  valid?: boolean;
}): JSX.Element {
  return (
    <footer className={styles.saveBar}>
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
        action={
          <Inline gap="sm">
            <Button
              variant="quiet"
              disabled={!!draft.pending || !draft.hasChanges}
              onClick={draft.reset}
            >
              변경 취소
            </Button>
            <Button
              variant="primary"
              disabled={!!draft.pending || !draft.hasChanges || !valid}
              onClick={() => void draft.run("save_settings")}
            >
              {label} 저장
            </Button>
          </Inline>
        }
      />
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
                    <StatusMarker shape="square" tone="accent">
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
          <div className={styles.pageHeading}>
            <h1>{current.label}</h1>
            <span className={s.quiet}>
              {dirty[section]
                ? "미저장 변경 있음"
                : section === "widgets"
                  ? "설정은 여기서 · 작업은 별도 창에서"
                  : ""}
            </span>
          </div>
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
              <fieldset className={d.fieldset} disabled={!!automatic.pending}>
                <legend className={s.sectionTitle}>먼저 이야기하기</legend>
                <Checkbox
                  className={s.row}
                  checked={automatic.settings.autonomousEnabled}
                  onChange={(event) => automatic.change("autonomousEnabled", event.target.checked)}
                >
                  바탕화면에서 먼저 이야기하기
                </Checkbox>
                <p className={s.quiet}>
                  끄면 자동 대화를 멈춰요. 직접 말을 걸거나 단어장 대사를 재생할 수 있어요.
                </p>
                <FormField
                  className={s.field}
                  label="이야기 간격 (분)"
                  description="1~60분. 실제 간격은 조금씩 달라져요."
                >
                  <TextField
                    className={d.shortInput}
                    type="number"
                    min={1}
                    max={60}
                    value={automatic.settings.idleMinutes}
                    onChange={(event) =>
                      automatic.change("idleMinutes", Number(event.target.value))
                    }
                  />
                </FormField>
                <h2 className={s.sectionTitle}>새 잡담 생성</h2>
                <Checkbox
                  className={s.row}
                  disabled={!automatic.settings.autonomousEnabled}
                  checked={automatic.settings.localIdleEnabled}
                  onChange={(event) => automatic.change("localIdleEnabled", event.target.checked)}
                >
                  로컬 모델로 새 잡담 만들기
                </Checkbox>
                <Checkbox
                  className={s.row}
                  disabled={!automatic.settings.autonomousEnabled}
                  checked={automatic.settings.apiIdleEnabled}
                  onChange={(event) => automatic.change("apiIdleEnabled", event.target.checked)}
                >
                  API로 새 잡담 만들기
                </Checkbox>
                <p className={s.quiet}>
                  AI 연결에서 저장한 방식이 준비되면 사용해요. API 잡담은 자동 요청과 제공자 비용이
                  발생할 수 있어요.
                </p>
                {snapshot.runtime.paused && (
                  <div className={s.row}>
                    <span>자동 잡담 일시정지 중</span>
                    <Button
                      variant="secondary"
                      onClick={() => void automatic.run("set_paused", { paused: false })}
                    >
                      자동 잡담 다시 시작
                    </Button>
                  </div>
                )}
              </fieldset>
            </TabPanel>
            <TabPanel value="model" className={styles.panel}>
              {visited.has("model") && <ModelSettings snapshot={snapshot} draft={model} />}
            </TabPanel>
            <TabPanel value="wordbook" className={styles.panel}>
              {visited.has("wordbook") && (
                <WordbookPanel
                  entries={snapshot.wordbook}
                  owners={snapshot.characters.active.map((id) =>
                    snapshot.characters.installed.find((character) => character.id === id),
                  )}
                  title="개인 단어장"
                  description="키워드가 포함되면 등록한 대사를 모델 없이 그대로 재생해요. 캐릭터를 바꿔도 유지돼요."
                  onDirtyChange={setWordbookDirty}
                />
              )}
            </TabPanel>
            <TabPanel value="talk" className={styles.panel}>
              {visited.has("talk") && <TalkPackPanel />}
            </TabPanel>
            <TabPanel value="user" className={styles.panel}>
              {visited.has("user") && (
                <UserSettings snapshot={snapshot} onDirtyChange={setUserDirty} />
              )}
            </TabPanel>
            <TabPanel value="general" className={styles.panel}>
              {visited.has("general") && (
                <>
                  <section>
                    <h2 className={s.sectionTitle}>표시와 종료</h2>
                    <div className={s.row}>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void act(snapshot.runtime.hidden ? "show_characters" : "hide_boxes")
                        }
                      >
                        {snapshot.runtime.hidden ? "캐릭터 표시" : "캐릭터 숨기기"}
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => (hasChanges ? setConfirmExit(true) : void act("quit_app"))}
                      >
                        앱 종료
                      </Button>
                      <span className={s.quiet}>
                        창을 닫으면 작성 중인 내용을 유지한 채 숨겨요.
                      </span>
                    </div>
                  </section>
                  <DesktopPreferences
                    hidden={snapshot.runtime.hidden}
                    onDirtyChange={setGeneralDirty}
                  />
                  <UpdatePanel onBusyChange={setUpdateBusy} hasUnsavedChanges={hasChanges} />
                </>
              )}
            </TabPanel>
          </fieldset>
          {section === "automatic" && (
            <DraftActions draft={automatic} label="자동 대화" valid={automatic.validInterval} />
          )}
          {section === "model" && <DraftActions draft={model} label="AI 연결" />}
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
