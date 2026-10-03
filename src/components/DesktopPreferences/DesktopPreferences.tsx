import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ActionBar,
  Button,
  Checkbox,
  Inline,
  SaveStatus,
  SectionHeader,
  SettingsRow,
  Surface,
} from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
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
    <Surface className={layout.generalMain}>
      <div className={layout.panelBody}>
        {children}
        <section className={layout.settingsSection}>
          <SectionHeader title="바탕화면 장난" headingVariant="subsection" rule="none" />
          <SettingsRow
            className={layout.settingsRow}
            label={<span id="pranks-label">장난 모드</span>}
            description="10~20분마다 하나씩 · 최대 30초"
          >
            <Checkbox
              className={layout.rowControl}
              aria-labelledby="pranks-label"
              checked={preferences.pranksEnabled}
              disabled={pending || !loaded}
              onChange={(event) => edit({ ...preferences, pranksEnabled: event.target.checked })}
            >
              장난 허용
            </Checkbox>
          </SettingsRow>
          <Surface tone="inset" className={styles.toys}>
            <p className={layout.rowLabel}>사용할 장난감</p>
            <div className={styles.toyChoices}>
              {toys.map((toy) => (
                <Checkbox
                  key={toy.id}
                  checked={preferences.allowedToys.includes(toy.id)}
                  disabled={pending || !loaded}
                  onChange={(event) =>
                    edit({
                      ...preferences,
                      allowedToys: event.target.checked
                        ? [...preferences.allowedToys, toy.id]
                        : preferences.allowedToys.filter((id) => id !== toy.id),
                    })
                  }
                >
                  {toy.name}
                </Checkbox>
              ))}
            </div>
            <div className={styles.cleanup}>
              <Button
                variant="quiet"
                className={styles.cleanupButton}
                disabled={pending || !loaded}
                onClick={() => {
                  void command("clear_desktop_toys").catch((cause: unknown) =>
                    setError(errorText(cause)),
                  );
                }}
              >
                장난감 모두 정리
              </Button>
              <span className={s.quiet}>꺼내 둔 장난감만 정리</span>
            </div>
          </Surface>
        </section>
      </div>
      <footer className={styles.saveBar}>
        <ActionBar
          className={layout.footerBar}
          status={
            <div className={layout.footerStatus}>
              <SaveStatus
                state={pending ? "saving" : error ? "error" : notice ? "saved" : "idle"}
                message={error ?? notice ?? (dirty ? "변경사항 있음" : "변경사항 없음")}
              />
              <span className={s.quiet}>장난 모드·허용 목록</span>
            </div>
          }
        >
          <Inline className={layout.footerActions} gap="sm">
            <Button
              variant="quiet"
              className={layout.cancelButton}
              disabled={pending || !loaded || !dirty}
              onClick={() => edit(saved.current)}
            >
              변경 취소
            </Button>
            <Button
              variant="primary"
              className={styles.saveButton}
              disabled={pending || !loaded || !dirty}
              onClick={() => void save()}
            >
              장난 설정 저장
            </Button>
          </Inline>
        </ActionBar>
      </footer>
    </Surface>
  );
}
