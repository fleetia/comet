import { useEffect, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";

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

export function UpdatePanel(): JSX.Element {
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
  const available = status.version && ["available", "error"].includes(status.phase);
  const message = error ?? status.message;
  return (
    <section className={s.section} aria-labelledby="app-update-title">
      <h2 className={s.sectionTitle} id="app-update-title">
        앱 업데이트
      </h2>
      <p className={s.quiet}>
        앱을 시작할 때와 하루에 한 번 새 버전을 확인해요. 설치는 직접 선택할 때만 진행해요.
      </p>
      <div role="status" aria-live="polite">
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
      {available && <p className={s.quiet}>설치하면 진행 중인 대화를 멈추고 앱을 다시 시작해요.</p>}
      <div className={s.row}>
        <Button variant="secondary" disabled={busy} onClick={() => void run(false)}>
          업데이트 확인
        </Button>
        {available && (
          <Button disabled={busy} onClick={() => void run(true)}>
            설치하고 다시 시작
          </Button>
        )}
      </div>
    </section>
  );
}
