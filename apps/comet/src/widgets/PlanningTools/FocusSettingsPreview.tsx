import { useEffect, useRef, useState, type ReactElement } from "react";
import { SegmentedControl } from "@comet/ui";
import { Icon } from "@comet/icon";
import { errorText } from "../../hooks/useSnapshot";
import { number, record, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { countdown } from "./FocusTimerData";
import { FocusDial } from "./FocusTimerView";
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
    <section className={s.settingsPreview} aria-label="집중 타이머 미리보기">
      <header className={s.previewHeader}>
        <span className={s.previewIcon}>
          <Icon name="timer" size={18} />
        </span>
        <h2 className={s.previewTitle}>집중 타이머</h2>
      </header>
      <FocusDial
        time={countdown(duration)}
        description="기본 집중 시간"
        presentation={presentation}
        size="preview"
      />
      <div className={s.previewShape}>
        <span>타이머 모양</span>
        <SegmentedControl
          label="타이머 모양"
          appearance="contained"
          value={presentation}
          disabled={disabled || busy}
          options={[
            { value: "dial", label: "고리" },
            { value: "digits", label: "숫자만" },
          ]}
          onValueChange={(value) => void changePresentation(value)}
        />
      </div>
      <p className={s.previewCaption}>바탕화면 위젯으로 놓으면 그 자리에서 남은 시간을 보여 줘요.</p>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </section>
  );
}
