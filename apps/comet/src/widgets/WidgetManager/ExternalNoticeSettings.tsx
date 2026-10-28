import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, SettingControlRow, Surface, Switch, TextInput } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
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
    onBusyChange(busy);
  }, [busy, onBusyChange]);
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
    if (!dirty || conflict || busy || failedPrefix.current === prefix) return;
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
  }, [prefix, dirty, conflict, busy, retry, widget.revision]);

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
              disabled={busy}
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
              disabled={busy}
              onChange={(event) => void configure({ osNotifications: event.target.checked })}
            />
          }
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
