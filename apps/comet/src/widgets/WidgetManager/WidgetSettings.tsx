import { useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import { Button, Surface, Text } from "../../ui";
import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionObservation, ConnectionTool } from "../ConnectionTools/ConnectionTools";
import { FocusWidgetSettings } from "../PlanningTools/FocusWidgetSettings";
import { PreparationSettings } from "../PreparationTool/PreparationSettings";
import { ClockTool } from "../PlanningTools/PlanningTools";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as styles from "./widgetSettings.css";

export const CONFIGURABLE_WIDGETS = [
  "calendar",
  "weather",
  "music",
  "clock",
  "focus-timer",
  "preparation",
];
export const DISPLAY_KINDS = ["clock", "weather"];
const SETTINGS_LABELS: Record<string, string> = {
  calendar: "캘린더 연결과 알림",
  weather: "지역과 연결",
  music: "음악 앱 연결",
  clock: "기념일",
  "focus-timer": "집중 타이머 설정",
  preparation: "준비 봉투 설정",
};

export function WidgetSettings({
  widget,
  widgets = [],
  sideContainer,
  onOpenRelated,
  active,
  act,
  onDirtyChange,
  onBusyChange,
  displayControls,
  related,
  disabled,
}: {
  widget: WidgetView;
  widgets?: WidgetView[];
  sideContainer?: HTMLElement | null;
  onOpenRelated?: (kind: string) => void;
  active: boolean;
  act: ToolAction;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onBusyChange?: (id: string, busy: boolean) => void;
  displayControls?: ReactNode;
  related?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const [connectionBusy, setConnectionBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(widget.id, connectionBusy);
    return () => onBusyChange?.(widget.id, false);
  }, [widget.id, connectionBusy, onBusyChange]);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceActions, setAppearanceActions] = useState<HTMLDivElement | null>(null);
  const appearanceId = useId();
  useEffect(() => {
    onDirtyChange(widget.id, connectionDirty || appearanceDirty);
  }, [widget.id, connectionDirty, appearanceDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(widget.id, false), [widget.id, onDirtyChange]);
  const configure: ToolAction = (action, input, target = widget) => act(action, input, target);
  const hasAppearance = DISPLAY_KINDS.includes(widget.kind);
  const showAppearanceActions = appearanceOpen || appearanceDirty;
  return (
    <Surface data-widget-settings className={styles.settings}>
      <div className={styles.body} data-widget-settings-body>
        <section className={styles.primary} aria-label={SETTINGS_LABELS[widget.kind]}>
          <fieldset className={styles.fields} disabled={disabled}>
            {widget.kind === "calendar" && (
              <CalendarTool
                widget={widget}
                act={configure}
                mode="settings"
                active={active}
                onDirtyChange={setConnectionDirty}
              />
            )}
            {["weather", "music"].includes(widget.kind) && (
              <ConnectionTool
                widget={widget}
                disabled={disabled}
                onBusyChange={setConnectionBusy}
                sideContainer={sideContainer}
                mode="settings"
                onDirtyChange={setConnectionDirty}
              />
            )}
            {widget.kind === "focus-timer" && (
              <FocusWidgetSettings
                widget={widget}
                calendar={widgets.find((item) => item.kind === "calendar" && item.installed)}
                act={configure}
                onDirtyChange={setConnectionDirty}
                onBusyChange={setConnectionBusy}
              />
            )}
            {widget.kind === "preparation" && (
              <PreparationSettings
                widgets={widgets}
                onOpenRelated={(item) => onOpenRelated?.(item.kind)}
              />
            )}
            {widget.kind === "clock" && (
              <ClockTool
                widget={widget}
                widgets={[]}
                act={configure}
                compact
                onDirtyChange={setConnectionDirty}
              />
            )}
          </fieldset>
          {related}
        </section>
        {hasAppearance && (
          <section className={styles.secondary} aria-label="바탕화면 표시">
            {displayControls}
            <Button
              variant="quiet"
              className={styles.disclosure}
              aria-label="바탕화면 꾸미기"
              aria-expanded={appearanceOpen}
              aria-controls={appearanceId}
              onClick={() => setAppearanceOpen((open) => !open)}
            >
              <span aria-hidden="true">{appearanceOpen ? "⌄" : "›"}</span>
              <span>바탕화면 꾸미기</span>
              <Text variant="caption" tone="muted" className={styles.disclosureHint}>
                {appearanceDirty ? "변경사항 있음" : "배경 · 글자 · 위치"}
              </Text>
            </Button>
            <div id={appearanceId} className={styles.appearance} hidden={!appearanceOpen}>
              <WidgetAppearance
                widget={widget}
                onDirtyChange={setAppearanceDirty}
                active={active && showAppearanceActions}
                actionContainer={appearanceActions}
                disabled={disabled}
              />
            </div>
          </section>
        )}
        {widget.kind === "weather" && (
          <details className={styles.observation}>
            <summary className={styles.observationSummary}>최근 날씨 정보</summary>
            <ConnectionObservation widget={widget} />
          </details>
        )}
      </div>
      {hasAppearance && (
        <div
          className={styles.actions}
          data-appearance-actions
          data-compact-appearance-actions
          hidden={!showAppearanceActions}
          ref={setAppearanceActions}
        />
      )}
    </Surface>
  );
}
