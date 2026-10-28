import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, SettingControlRow, Surface, Switch, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as s from "../PreparationTool/preparationSettings.css";

const DEFAULT_PREFIX = "바깥에서 소식:";
const EXAMPLE = '/Applications/comet.app/Contents/MacOS/comet notify "빌드 끝남"';

export function ExternalNoticeSettings({
  widget,
  act,
  onDirtyChange,
  onBusyChange,
}: {
  widget: WidgetView;
  act: ToolAction;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}): ReactElement {
  const data = record(widget.data);
  const savedPrefix = typeof data.prefix === "string" ? data.prefix : DEFAULT_PREFIX;
  const [prefix, setPrefix] = useState(savedPrefix);
  const [base, setBase] = useState(savedPrefix);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(isDesktop() ? "unknown" : "system");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionRequest = useRef(0);
  const permissionLock = useRef(false);
  const mounted = useRef(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const locked = useRef(false);
  const failedPrefix = useRef<string | null>(null);
  const savedRevision = useRef<number | null>(null);
  const dirty = prefix !== base;
  const conflict =
    dirty &&
    savedPrefix !== base &&
    (savedRevision.current === null || widget.revision > savedRevision.current);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy || permissionBusy);
  }, [busy, permissionBusy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    function refreshPermission(): void {
      if (!isDesktop() || permissionLock.current) return;
      const request = ++permissionRequest.current;
      void command<string>("get_planner_notification_permission")
        .then((value) => {
          if (mounted.current && permissionRequest.current === request) setPermission(value);
        })
        .catch((cause: unknown) => {
          if (mounted.current && permissionRequest.current === request) {
            setPermission("unknown");
            setError(errorText(cause));
          }
        });
    }
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    return () => {
      mounted.current = false;
      permissionRequest.current += 1;
      window.removeEventListener("focus", refreshPermission);
    };
  }, []);

  async function requestPermission(): Promise<void> {
    if (permissionLock.current) return;
    permissionLock.current = true;
    setPermissionBusy(true);
    setError("");
    const request = ++permissionRequest.current;
    try {
      const value = await command<string>("request_planner_notification_permission");
      if (mounted.current && permissionRequest.current === request) setPermission(value);
    } catch (cause: unknown) {
      if (mounted.current && permissionRequest.current === request) setError(errorText(cause));
    } finally {
      permissionLock.current = false;
      if (mounted.current) setPermissionBusy(false);
    }
  }
  useEffect(() => {
    if (
      !dirty &&
      !locked.current &&
      (savedRevision.current === null || widget.revision > savedRevision.current)
    ) {
      savedRevision.current = null;
      setPrefix(savedPrefix);
      setBase(savedPrefix);
    }
  }, [widget.revision, savedPrefix, dirty]);

  async function configure(input: DataRecord): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (!(await act("configure", input))) {
        setError("설정을 저장하지 못했어요. 다시 시도해 주세요.");
        return false;
      }
      return true;
    } catch (cause: unknown) {
      setError(errorText(cause));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!dirty || conflict || busy || permissionBusy || failedPrefix.current === prefix) return;
    const value = prefix;
    const revision = widget.revision;
    const timer = window.setTimeout(() => {
      void configure({ prefix: value }).then((saved) => {
        if (saved) {
          failedPrefix.current = null;
          savedRevision.current = revision;
          setBase(value);
        } else {
          failedPrefix.current = value;
        }
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [prefix, dirty, conflict, busy, permissionBusy, retry, widget.revision]);

  return (
    <section className={s.root} aria-label="바깥 알림 설정">
      <h2 className={s.heading}>알림 받기</h2>
      <Surface variant="card" className={s.connections}>
        <SettingControlRow
          title="받기 허용"
          description="링크로 보낸 알림을 받아요"
          control={
            <Switch
              aria-label="바깥 알림 받기 허용"
              checked={data.enabled !== false}
              disabled={busy || permissionBusy}
              onChange={(event) => void configure({ enabled: event.target.checked })}
            />
          }
        />
        <SettingControlRow
          title="OS 알림 병행"
          description="말풍선과 함께 시스템 알림도 보내요"
          control={
            <Switch
              aria-label="OS 알림 병행"
              checked={data.osNotifications === true}
              disabled={busy || permissionBusy || (data.osNotifications !== true && !["granted", "system"].includes(permission))}
              onChange={(event) => void configure({ osNotifications: event.target.checked })}
            />
          }
        />
        <SettingControlRow
          title={`OS 알림 권한: ${({ granted: "허용됨", denied: "꺼짐 · 시스템 설정에서 변경", prompt: "권한 요청 전", system: "시스템 설정을 따름", unknown: "확인 필요" } as Record<string, string>)[permission] || "확인 필요"}`}
          description={permission === "prompt" ? "허용 후 OS 알림 병행을 켤 수 있어요" : undefined}
          control={isDesktop() && permission !== "granted" && permission !== "system" ? (
            <Button type="button" variant="ghost" disabled={busy || permissionBusy} onClick={() => void requestPermission()}>
              OS 알림 권한 요청
            </Button>
          ) : undefined}
        />
        <SettingControlRow
          title="접두 문구"
          control={
            <TextInput
              aria-label="접두 문구"
              value={prefix}
              maxLength={200}
              disabled={busy}
              onChange={(event) => {
                failedPrefix.current = null;
                setPrefix(event.target.value);
              }}
            />
          }
        />
      </Surface>
      {conflict && (
        <p className={s.error} role="alert">
          접두 문구가 다른 곳에서 바뀌었어요. 최신 값을 불러온 뒤 다시 바꿔 주세요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {(conflict || (error && dirty)) && (
        <div>
          {!conflict && (
            <Button
              disabled={busy}
              onClick={() => {
                failedPrefix.current = null;
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              다시 저장
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              failedPrefix.current = null;
              setPrefix(savedPrefix);
              setBase(savedPrefix);
              setError("");
            }}
          >
            최신 값 불러오기
          </Button>
        </div>
      )}
      <h2 className={s.heading}>명령으로 보내기</h2>
      <p className={s.caption}>
        명령을 통한 알림 전송은 아직 지원하지 않아요.
      </p>
      <code>{EXAMPLE}</code>
      <Button disabled>명령 복사</Button>
    </section>
  );
}
