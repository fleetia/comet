import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, SettingControlRow, Stepper } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import { number, record, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { FocusTimerSettings } from "./FocusTimerSettings";
import * as s from "./FocusTimer.css";

export function FocusWidgetSettings({
  widget,
  calendar,
  act,
  onDirtyChange,
  onBusyChange,
}: {
  widget: WidgetView;
  calendar?: WidgetView;
  act: ToolAction;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const data = record(widget.data);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const report = useRef({ onBusyChange, onDirtyChange });
  report.current = { onBusyChange, onDirtyChange };
  useEffect(() => {
    report.current.onBusyChange?.(busy || settingsBusy);
  }, [busy, settingsBusy]);
  useEffect(
    () => () => {
      report.current.onBusyChange?.(false);
      report.current.onDirtyChange?.(false);
    },
    [],
  );
  const savedDuration =
    (number(data.focusDurationMs) ||
      (data.mode !== "rest" ? number(data.durationMs) : 0) ||
      1500000) / 60000;
  const [duration, setDuration] = useState(String(savedDuration));
  const [durationBase, setDurationBase] = useState(savedDuration);
  const durationSavedRevision = useRef<number | null>(null);
  const durationDirty = !duration.trim() || Number(duration) !== durationBase;
  const durationConflict =
    durationDirty &&
    savedDuration !== durationBase &&
    (durationSavedRevision.current === null || widget.revision > durationSavedRevision.current);
  useEffect(() => {
    report.current.onDirtyChange?.(durationDirty || settingsDirty);
  }, [durationDirty, settingsDirty]);
  useEffect(() => {
    if (
      !durationDirty &&
      !locked.current &&
      (durationSavedRevision.current === null || widget.revision > durationSavedRevision.current)
    ) {
      durationSavedRevision.current = null;
      setDuration(String(savedDuration));
      setDurationBase(savedDuration);
    }
  }, [widget.revision, savedDuration, durationDirty]);
  const idle = data.status === undefined || data.status === "idle";
  const durationValid =
    Boolean(duration.trim()) &&
    Number.isFinite(Number(duration)) &&
    Number(duration) >= 1 &&
    Number(duration) <= 1440;
  const failedDuration = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (
      !durationDirty ||
      !durationValid ||
      durationConflict ||
      !idle ||
      locked.current ||
      settingsBusy ||
      failedDuration.current === duration
    )
      return;
    const value = duration;
    const timer = window.setTimeout(() => {
      void configure({ durationMs: Math.round(Number(value) * 60000) }).then((saved) => {
        if (saved) {
          failedDuration.current = null;
          durationSavedRevision.current = widget.revision;
          setDurationBase(Number(value));
        } else failedDuration.current = value;
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [duration, durationDirty, durationValid, durationConflict, idle, settingsBusy, busy, retry]);
  function loadLatestDuration(): void {
    const value =
      durationSavedRevision.current !== null && widget.revision <= durationSavedRevision.current
        ? durationBase
        : savedDuration;
    failedDuration.current = null;
    setDuration(String(value));
    setDurationBase(value);
    setError("");
  }
  async function configure(input: DataRecord): Promise<boolean> {
    if (locked.current || settingsBusy) return false;
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
  const durationControl = (
    <>
      <SettingControlRow
        className={s.settingRow}
        title="기본 집중 시간"
        description="시작 화면의 처음 값이에요"
        control={
          <Stepper
            size="compact"
            aria-label="기본 집중 시간 (분)"
            min={1}
            max={1440}
            unit="분"
            value={duration}
            disabled={busy || settingsBusy || !idle}
            onChange={(event) => setDuration(event.target.value)}
            onValueChange={(value) => setDuration(String(value))}
          />
        }
      />
      {durationDirty && !durationValid && (
        <p role="alert" className={s.error}>
          기본 집중 시간은 1~1440분으로 입력해 주세요.
        </p>
      )}
      {durationConflict && (
        <p role="alert" className={s.error}>
          집중 시간이 다른 곳에서 바뀌었어요. 최신 값을 불러온 뒤 다시 바꿔 주세요.
        </p>
      )}
      {(durationConflict || (error && durationDirty)) && (
        <div className={s.row}>
          {!durationConflict && (
            <Button
              disabled={busy || settingsBusy}
              onClick={() => {
                failedDuration.current = null;
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              다시 저장
            </Button>
          )}
          <Button variant="ghost" disabled={busy || settingsBusy} onClick={loadLatestDuration}>
            최신 값 불러오기
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </>
  );
  return (
    <section className={s.settingsRoot} aria-label="집중 타이머 설정">
      <fieldset className={s.settingsFields} disabled={busy}>
        <FocusTimerSettings
          widget={widget}
          calendar={calendar}
          act={act}
          durationControl={durationControl}
          onDirtyChange={setSettingsDirty}
          onBusyChange={setSettingsBusy}
        />
      </fieldset>
    </section>
  );
}
