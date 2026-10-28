import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { ActionBar, Inline, SaveStatus } from "../../primitives";
import { Icon, CalendarIcon, RemoveIcon } from "@comet/icon";
import { Button, SettingControlRow, SettingsSummary, Switch, ToggleChip } from "@comet/ui";
import { useWidgets } from "../../widgets/useWidgets";
import * as figma from "../SettingsPanel/figmaSettings.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { readUsageTarget, type FocusUsageTarget } from "../../widgets/PlanningTools/FocusTimerData";
import { rows, type DataRecord } from "../../widgets/toolData";
import type { DeviceInfo } from "../../types";
import * as layout from "../SettingsPanel/settings.css";
import * as styles from "./desktopPreferences.css";

type Preferences = {
  charactersVisible: boolean;
  pranksEnabled: boolean;
  allowedToys: string[];
  activityEnabled: boolean;
  activityExcludedApps: string[];
};
const toys = [
  { id: "ball", name: "공" },
  { id: "paper-plane", name: "종이비행기" },
  { id: "bubbles", name: "비눗방울" },
];

export function DesktopPreferences({
  hidden,
  platform,
  onDirtyChange,
  children,
}: {
  hidden: boolean;
  platform?: DeviceInfo["platform"];
  onDirtyChange?: (dirty: boolean) => void;
  children?: ReactNode;
}): JSX.Element {
  const widgets = useWidgets();
  const [preferences, setPreferences] = useState<Preferences>({
    charactersVisible: !hidden,
    pranksEnabled: false,
    allowedToys: toys.map((toy) => toy.id),
    activityEnabled: false,
    activityExcludedApps: [],
  });
  const [loaded, setLoaded] = useState(!isDesktop());
  const [dirty, setDirty] = useState(false);
  const dirtyFields = useRef(new Set<"pranksEnabled" | "allowedToys">());
  const saved = useRef(preferences);
  const refreshPreferences = useRef<() => Promise<void>>(async () => {});
  function edit(next: Preferences): void {
    if (!loaded || pending) return;
    setPreferences(next);
    for (const key of ["pranksEnabled", "allowedToys"] as const) {
      if (JSON.stringify(next[key]) === JSON.stringify(saved.current[key]))
        dirtyFields.current.delete(key);
      else dirtyFields.current.add(key);
    }
    setDirty(dirtyFields.current.size > 0);
    setNotice(null);
  }
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let request = 0;
    let latest: Promise<void> = Promise.resolve();
    let unlisten: (() => void) | undefined;
    function refresh(): Promise<void> {
      const sequence = ++request;
      latest = (async () => {
        try {
          const value = await command<Preferences>("get_desktop_preferences");
          if (!active || sequence !== request) return;
          setLoaded(true);
          saved.current = value;
          setPreferences((previous) => ({
            ...value,
            ...Object.fromEntries([...dirtyFields.current].map((key) => [key, previous[key]])),
          }));
        } catch (cause) {
          if (active && sequence === request) setError(errorText(cause));
        }
      })();
      return latest.then(async () => {
        while (active && sequence !== request) {
          const current = request;
          await latest;
          if (current === request) break;
        }
      });
    }
    refreshPreferences.current = refresh;
    void listen<Preferences>("desktop-preferences", () => void refresh())
      .then((cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        void refresh();
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      refreshPreferences.current = async () => {};
      unlisten?.();
    };
  }, []);
  async function save(): Promise<void> {
    if (!loaded || pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await command("set_desktop_preferences", {
        preferences: { ...preferences, charactersVisible: !hidden },
      });
      dirtyFields.current.clear();
      setDirty(false);
      await refreshPreferences.current();
      setNotice("장난 설정을 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={figma.split}>
      <aside className={figma.inspector}>
        <h1 className={figma.inspectorTitle}>
          <span className={figma.icon}>
            <CalendarIcon size={18} />
          </span>
          바탕화면
        </h1>
        <p className={figma.caption}>친구와 함께 놀 장난감을 고르고, 바탕화면에 꺼내요.</p>
        <div className={styles.toyPreview}>
          {toys
            .filter((toy) => preferences.allowedToys.includes(toy.id))
            .map((toy) => (
              <span className={figma.icon} key={toy.id}>
                <Icon
                  name={toy.id === "ball" ? "ball2" : toy.id === "paper-plane" ? "plane" : "bubble"}
                  size={24}
                />
              </span>
            ))}
        </div>
        <Button
          variant="ghost"
          className={figma.fullButton}
          disabled={pending || !loaded}
          onClick={() =>
            void command("clear_desktop_toys").catch((cause: unknown) => setError(errorText(cause)))
          }
        >
          <RemoveIcon size={15} />
          장난감 모두 정리
        </Button>
      </aside>
      <div className={figma.right}>
        {children}
        <ActivityPreferences
          preferences={preferences}
          loaded={loaded}
          supported={isDesktop() && platform === "windows"}
          onSaved={() => refreshPreferences.current()}
        />
        <section className={figma.section}>
          <h2 className={figma.sectionTitle}>장난 모드</h2>
          <div className={figma.group}>
            <SettingControlRow
              className={figma.row}
              title="장난 모드"
              description="10~20분마다 하나씩, 30초까지 장난쳐요"
              control={
                <Switch
                  aria-label="장난 모드"
                  checked={preferences.pranksEnabled}
                  disabled={pending || !loaded}
                  onChange={(event) =>
                    edit({ ...preferences, pranksEnabled: event.target.checked })
                  }
                />
              }
            />
            <SettingControlRow
              className={figma.row}
              title="친구가 꺼내도 되는 장난감"
              control={
                <div className={styles.toyChoices}>
                  {toys.map((toy) => (
                    <ToggleChip
                      key={toy.id}
                      pressed={preferences.allowedToys.includes(toy.id)}
                      disabled={pending || !loaded}
                      onClick={() =>
                        edit({
                          ...preferences,
                          allowedToys: preferences.allowedToys.includes(toy.id)
                            ? preferences.allowedToys.filter((id) => id !== toy.id)
                            : [...preferences.allowedToys, toy.id],
                        })
                      }
                    >
                      {toy.name}
                    </ToggleChip>
                  ))}
                </div>
              }
            />
          </div>
        </section>
        <section className={figma.section}>
          <div className={figma.controls}>
            <h2 className={figma.sectionTitle}>장난감</h2>
            <Button
              variant="ghost"
              size="small"
              disabled={pending || !loaded}
              onClick={() =>
                void command("clear_desktop_toys").catch((cause: unknown) =>
                  setError(errorText(cause)),
                )
              }
            >
              모두 정리
            </Button>
          </div>
          <div className={figma.summaryGrid}>
            {toys.map((toy) => (
              <SettingsSummary
                key={toy.id}
                className={figma.summary}
                title={toy.name}
                description={
                  toy.id === "ball"
                    ? "던지면 튀기며 굴러가요"
                    : toy.id === "paper-plane"
                      ? "끌어서 날리면 천천히 내려앉아요"
                      : "누르면 톡 터져요"
                }
                leading={
                  <span className={figma.icon}>
                    <Icon
                      name={
                        toy.id === "ball" ? "ball2" : toy.id === "paper-plane" ? "plane" : "bubble"
                      }
                      size={20}
                    />
                  </span>
                }
                trailing={<span>꺼내기</span>}
                disabled={
                  pending ||
                  !loaded ||
                  !widgets.snapshot?.widgets.some(
                    (item) => item.kind === toy.id,
                  )
                }
                onClick={() => {
                  const target = widgets.snapshot?.widgets.find(
                    (item) => item.kind === toy.id,
                  );
                  if (target)
                    void command("execute_widget", {
                      request: {
                        requestId: crypto.randomUUID(),
                        instanceId: target.id,
                        expectedRevision: target.revision,
                        action: "desktop-open",
                        input: {},
                      },
                    }).catch((cause: unknown) => setError(errorText(cause)));
                }}
              />
            ))}
          </div>
          <p className={figma.caption}>꺼낸 장난감은 끌어서 옮기고, 우클릭으로 하나씩 정리해요.</p>
        </section>
        {(dirty || pending || error || notice) && (
          <footer className={styles.saveBar}>
            <ActionBar
              className={layout.footerBar}
              status={
                <SaveStatus
                  state={pending ? "saving" : error ? "error" : notice ? "saved" : "idle"}
                  message={error ?? notice ?? "저장하지 않은 변경이 있어요."}
                />
              }
            >
              <Inline gap="sm">
                <Button
                  variant="ghost"
                  disabled={pending || !loaded || !dirty}
                  onClick={() => edit(saved.current)}
                >
                  변경 취소
                </Button>
                <Button
                  variant="primary"
                  disabled={pending || !loaded || !dirty}
                  onClick={() => void save()}
                >
                  장난 설정 저장
                </Button>
              </Inline>
            </ActionBar>
          </footer>
        )}
      </div>
    </div>
  );
}

function ActivityPreferences({ preferences, loaded, supported, onSaved }: {
  preferences: Preferences;
  loaded: boolean;
  supported: boolean;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [applications, setApplications] = useState<FocusUsageTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await command<DataRecord>("list_usage_applications");
      if (result.supported !== true) throw new Error("프로그램 목록을 불러올 수 없어요.");
      setApplications(rows(result.applications).flatMap((item) => {
        const app = readUsageTarget(item);
        return app ? [app] : [];
      }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  async function save(enabled: boolean, excludedApps: string[]): Promise<void> {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await command("set_activity_preferences", { enabled, excludedApps });
      await onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const excluded = preferences.activityExcludedApps ?? [];
  const unavailable = excluded.filter((id) => !applications.some((app) => app.id === id));
  return (
    <section className={figma.section}>
      <h2 className={figma.sectionTitle}>지금 하는 앱 눈치채기</h2>
      <div className={figma.group}>
        <SettingControlRow
          className={figma.row}
          title="지금 하는 앱 눈치채기"
          description={supported
            ? "앱 이름과 연속 사용 시간만 봐요. 창 제목·내용은 읽지 않아요. (Windows)"
            : "이 기기에서는 아직 안 돼요. Windows에서 사용할 수 있어요."}
          control={
            <Switch
              aria-label="지금 하는 앱 눈치채기"
              checked={preferences.activityEnabled}
              disabled={(!supported && !preferences.activityEnabled) || !loaded || pending}
              onChange={(event) => void save(event.target.checked, excluded)}
            />
          }
        />
        <SettingControlRow
          className={figma.row}
          title="제외 앱"
          description="선택한 앱을 사용 중일 때는 관측하지 않아요."
          control={
            <Button
              variant="ghost"
              size="small"
              disabled={!supported || !loaded || pending}
              onClick={() => {
                setOpen(!open);
                if (!open) void refresh();
              }}
            >
              {open ? "닫기" : `앱 고르기 (${excluded.length})`}
            </Button>
          }
        />
        {open && (
          <div className={styles.activityChoices}>
            <div className={styles.toyChoices}>
              {applications.map((app) => (
                <ToggleChip
                  key={app.id}
                  pressed={excluded.includes(app.id)}
                  disabled={loading || pending}
                  onClick={() => void save(preferences.activityEnabled, excluded.includes(app.id)
                    ? excluded.filter((id) => id !== app.id)
                    : [...excluded, app.id])}
                >
                  {app.name}
                </ToggleChip>
              ))}
              {unavailable.map((id, index) => (
                <ToggleChip
                  key={id}
                  pressed
                  disabled={loading || pending}
                  onClick={() => void save(preferences.activityEnabled, excluded.filter((item) => item !== id))}
                >
                  실행 중이지 않은 앱 {index + 1} · 제외 해제
                </ToggleChip>
              ))}
            </div>
            {!loading && applications.length === 0 && <p className={figma.caption}>실행 중인 앱을 찾지 못했어요.</p>}
            <Button variant="ghost" size="small" disabled={loading || pending} onClick={() => void refresh()}>
              {loading ? "확인 중…" : "앱 목록 새로고침"}
            </Button>
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
