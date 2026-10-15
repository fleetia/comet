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
  return (
    <section className={s.pane} aria-label="집중 타이머 설정">
      <SettingControlRow
        title="기본 집중 시간"
        description="다음 집중을 준비할 때 사용하는 시간이에요"
        control={
          <Stepper
            aria-label="기본 집중 시간 (분)"
            min={1}
            max={1440}
            unit="분"
            value={duration}
            disabled={busy || settingsBusy || (data.status !== undefined && data.status !== "idle")}
            onChange={(event) => setDuration(event.target.value)}
            onValueChange={(value) => setDuration(String(value))}
          />
        }
      />
      {durationConflict && (
        <p role="alert" className={s.error}>
          집중 시간이 다른 곳에서 바뀌었어요. 입력을 취소하고 최신 값을 확인해 주세요.
        </p>
      )}
      {durationDirty && (
        <div className={s.row}>
          <Button
            disabled={
              busy ||
              settingsBusy ||
              durationConflict ||
              !duration.trim() ||
              !Number.isFinite(Number(duration)) ||
              Number(duration) < 1 ||
              Number(duration) > 1440 ||
              (data.status !== undefined && data.status !== "idle")
            }
            onClick={async () => {
              if (await configure({ durationMs: Math.round(Number(duration) * 60000) })) {
                durationSavedRevision.current = widget.revision;
                setDurationBase(Number(duration));
              }
            }}
          >
            집중 시간 저장
          </Button>
          <Button
            variant="ghost"
            disabled={busy || settingsBusy}
            onClick={() => {
              const value =
                durationSavedRevision.current !== null &&
                widget.revision <= durationSavedRevision.current
                  ? durationBase
                  : savedDuration;
              setDuration(String(value));
              setDurationBase(value);
              setError("");
            }}
          >
            집중 시간 변경 취소
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <fieldset className={s.settingsFields} disabled={busy}>
        <FocusTimerSettings
          widget={widget}
          calendar={calendar}
          act={act}
          embedded
          onClose={() => undefined}
          onDirtyChange={setSettingsDirty}
          onBusyChange={setSettingsBusy}
        />
      </fieldset>
    </section>
  );
}
