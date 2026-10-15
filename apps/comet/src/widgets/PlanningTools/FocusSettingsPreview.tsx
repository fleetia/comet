import { useEffect, useRef, useState, type ReactElement } from "react";
import { FocusTimerPreview, SegmentedControl, SettingControlRow } from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import { number, record, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { countdown } from "./FocusTimerData";
import * as s from "./FocusTimer.css";

export function FocusSettingsPreview({
  widget,
  act,
  disabled = false,
  onBusyChange,
}: {
  widget: WidgetView;
  act: ToolAction;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const data = record(widget.data);
  const savedPresentation = data.presentation === "digits" ? "digits" : "dial";
  const [presentation, setPresentation] = useState<"dial" | "digits">(savedPresentation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const mounted = useRef(true);
  const report = useRef(onBusyChange);
  report.current = onBusyChange;
  const duration =
    number(data.focusDurationMs) || (data.mode !== "rest" ? number(data.durationMs) : 0) || 1500000;
  useEffect(() => setPresentation(savedPresentation), [widget.id, savedPresentation]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      report.current?.(false);
    };
  }, []);
  async function changePresentation(value: string): Promise<void> {
    if (disabled || locked.current || (value !== "dial" && value !== "digits")) return;
    locked.current = true;
    setBusy(true);
    report.current?.(true);
    setError("");
    try {
      if (await act("configure", { presentation: value }, widget)) {
        if (mounted.current) setPresentation(value);
      } else if (mounted.current) {
        setError("타이머 모양을 저장하지 못했어요. 다시 시도해 주세요.");
      }
    } catch (cause: unknown) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        report.current?.(false);
      }
    }
  }
  return (
    <section className={s.pane} aria-label="집중 타이머 미리보기">
      <FocusTimerPreview time={countdown(duration)} presentation={presentation} />
      <SettingControlRow
        title="타이머 모양"
        control={
          <SegmentedControl
            label="타이머 모양"
            value={presentation}
            disabled={disabled || busy}
            options={[
              { value: "dial", label: "고리" },
              { value: "digits", label: "숫자만" },
            ]}
            onValueChange={(value) => void changePresentation(value)}
          />
        }
      />
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </section>
  );
}
