import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { ActionBar, Inline, SaveStatus } from "../../primitives";
import { Icon, CalendarIcon, RemoveIcon } from "@comet/icon";
import { Button, SettingControlRow, SettingsSummary, Switch, ToggleChip } from "@comet/ui";
import { useWidgets } from "../../widgets/useWidgets";
import * as figma from "../SettingsPanel/figmaSettings.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as layout from "../SettingsPanel/settings.css";
import * as styles from "./desktopPreferences.css";

type Preferences = { charactersVisible: boolean; pranksEnabled: boolean; allowedToys: string[] };
const toys = [
  { id: "ball", name: "공" },
  { id: "paper-plane", name: "종이비행기" },
  { id: "bubbles", name: "비눗방울" },
];

export function DesktopPreferences({
  hidden,
  onDirtyChange,
  children,
}: {
  hidden: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  children?: ReactNode;
}): JSX.Element {
  const widgets = useWidgets();
  const [preferences, setPreferences] = useState<Preferences>({
    charactersVisible: !hidden,
    pranksEnabled: false,
    allowedToys: toys.map((toy) => toy.id),
  });
  const [loaded, setLoaded] = useState(!isDesktop());
  const [dirty, setDirty] = useState(false);
  const dirtyFields = useRef(new Set<"pranksEnabled" | "allowedToys">());
  const saved = useRef(preferences);
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
    let received = false;
    let unlisten: (() => void) | undefined;
    void listen<Preferences>("desktop-preferences", (event) => {
      received = true;
      if (active) {
        setLoaded(true);
        saved.current = event.payload;
        setPreferences((previous) => ({
          ...event.payload,
          ...Object.fromEntries([...dirtyFields.current].map((key) => [key, previous[key]])),
        }));
      }
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const value = await command<Preferences>("get_desktop_preferences");
        if (active && !received) {
          setLoaded(true);
          saved.current = value;
          setPreferences((previous) => ({
            ...value,
            ...Object.fromEntries([...dirtyFields.current].map((key) => [key, previous[key]])),
          }));
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
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
      saved.current = preferences;
      dirtyFields.current.clear();
      setDirty(false);
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
