import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, SectionHeader, Surface } from "@fleetia/lagrange";
import { version } from "../../../package.json";
import cometIcon from "../../../src-tauri/icons/source.svg";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
import * as styles from "./updatePanel.css";

type UpdateStatus = {
  phase:
    | "idle"
    | "disabled"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "installing"
    | "error";
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number | null;
  message: string | null;
};

const INITIAL_STATUS: UpdateStatus = {
  phase: "idle",
  version: null,
  notes: null,
  downloaded: 0,
  total: null,
  message: null,
};

export function UpdatePanel({
  onBusyChange,
  hasUnsavedChanges = false,
}: {
  onBusyChange?: (busy: boolean) => void;
  hasUnsavedChanges?: boolean;
}): JSX.Element {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    void listen<UpdateStatus>("app-update", (event) => {
      receivedEvent = true;
      if (!disposed) {
        setStatus(event.payload);
        setError(null);
      }
    })
      .then(async (cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const current = await command<UpdateStatus>("get_update_status");
        if (!disposed && !receivedEvent) setStatus(current);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(errorText(cause));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function run(install: boolean): Promise<void> {
    setPending(true);
    setError(null);
    try {
      if (install && status.version) {
        await command("install_app_update", { version: status.version });
      } else {
        setStatus(await command<UpdateStatus>("check_app_update"));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  const busy = pending || ["checking", "downloading", "installing"].includes(status.phase);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const available = status.version && ["available", "error"].includes(status.phase);
  const message = error ?? status.message;
  return (
    <Surface tone="accent" className={styles.panel} aria-labelledby="app-update-title">
      <div className={styles.identity}>
        <img src={cometIcon} alt="" width={40} height={40} />
        <div className={styles.identityCopy}>
          <p className={styles.appName}>comet</p>
          <p className={styles.caption}>설치 버전 · {version}</p>
        </div>
      </div>
      <section className={styles.update}>
        <SectionHeader
          title="앱 업데이트"
          headingId="app-update-title"
          headingVariant="subsection"
          rule="none"
        />
        <div className={styles.status} role="status" aria-live="polite">
          {status.phase === "idle" && <p className={styles.caption}>업데이트 확인 전</p>}
          {status.phase === "checking" && <p>새 버전을 확인하고 있어요.</p>}
          {status.phase === "current" && <p>최신 버전이에요.</p>}
          {available && <p>새 버전 {status.version}을 설치할 수 있어요.</p>}
          {status.phase === "downloading" && (
            <>
              <p>업데이트를 내려받고 있어요. {(status.downloaded / 1024 / 1024).toFixed(1)} MB</p>
              <progress
                aria-label="업데이트 다운로드"
                value={status.total ? status.downloaded : undefined}
                max={status.total || undefined}
              />
            </>
          )}
          {status.phase === "installing" && <p>업데이트를 설치하고 다시 시작해요.</p>}
        </div>
        {status.notes && (
          <details>
            <summary>새 버전 변경 내용</summary>
            <p>{status.notes}</p>
          </details>
        )}
        {message && (
          <p
            role={status.phase === "disabled" ? "status" : "alert"}
            className={status.phase === "disabled" ? s.quiet : s.error}
          >
            {message}
          </p>
        )}
        {available && (
          <p className={s.quiet}>설치하면 진행 중인 대화를 멈추고 앱을 다시 시작해요.</p>
        )}
        {available && hasUnsavedChanges && (
          <p className={s.quiet}>저장하지 않은 변경을 저장하거나 취소한 뒤 설치해 주세요.</p>
        )}
        <div className={styles.actions}>
          <Button
            className={styles.updateButton}
            variant="primary"
            disabled={busy}
            onClick={() => void run(false)}
          >
            업데이트 확인
          </Button>
          {available && (
            <Button disabled={busy || hasUnsavedChanges} onClick={() => void run(true)}>
              설치하고 다시 시작
            </Button>
          )}
        </div>
      </section>
      <p className={styles.about}>
        바탕화면에서 함께 지내는
        <br />
        작은 친구들
      </p>
    </Surface>
  );
}
