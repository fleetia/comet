import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionTool } from "../ConnectionTools/ConnectionTools";
import { FocusWidgetSettings } from "../PlanningTools/FocusWidgetSettings";
import { PreparationSettings } from "../PreparationTool/PreparationSettings";
import { ClockSettings, ClockTool } from "../PlanningTools/PlanningTools";
import { ExternalNoticeSettings } from "./ExternalNoticeSettings";
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
  "external-notice",
];
const SETTINGS_LABELS: Record<string, string> = {
  calendar: "캘린더 연결과 알림",
  weather: "지역과 연결",
  music: "음악 앱 연결",
  clock: "시계와 기념일",
  "focus-timer": "집중 타이머 설정",
  preparation: "준비 봉투 설정",
  "external-notice": "바깥 알림 설정",
};

export function WidgetSettings({
  widget,
  widgets = [],
  sideContainer,
  onConnectionOpenChange,
  onOpenRelated,
  active,
  act,
  onDirtyChange,
  onBusyChange,
  related,
  disabled,
}: {
  widget: WidgetView;
  widgets?: WidgetView[];
  sideContainer?: HTMLElement | null;
  onConnectionOpenChange?: (open: boolean) => void;
  onOpenRelated?: (kind: string) => void;
  active: boolean;
  act: ToolAction;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onBusyChange?: (id: string, busy: boolean) => void;
  related?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const [connectionBusy, setConnectionBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(widget.id, connectionBusy);
    return () => onBusyChange?.(widget.id, false);
  }, [widget.id, connectionBusy, onBusyChange]);
  const [connectionDirty, setConnectionDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(widget.id, connectionDirty);
  }, [widget.id, connectionDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(widget.id, false), [widget.id, onDirtyChange]);
  const configure: ToolAction = (action, input, target = widget) => act(action, input, target);
  return (
    <div data-widget-settings className={styles.settings}>
      <div className={styles.body} data-widget-settings-body>
        <section className={styles.primary} aria-label={SETTINGS_LABELS[widget.kind]}>
          <fieldset className={styles.fields} disabled={disabled}>
            {widget.kind === "calendar" && (
              <CalendarTool
                widget={widget}
                act={configure}
                mode="settings"
                sideContainer={sideContainer}
                onConnectionOpenChange={onConnectionOpenChange}
                disabled={disabled}
                active={active}
                onDirtyChange={setConnectionDirty}
                onBusyChange={setConnectionBusy}
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
                widget={widget}
                widgets={widgets}
                act={configure}
                onBusyChange={setConnectionBusy}
                onOpenRelated={(item) => onOpenRelated?.(item.kind)}
              />
            )}
            {widget.kind === "clock" && <ClockSettings widget={widget} act={configure} />}
            {widget.kind === "external-notice" && (
              <ExternalNoticeSettings
                widget={widget}
                act={configure}
                onDirtyChange={setConnectionDirty}
                onBusyChange={setConnectionBusy}
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
      </div>
    </div>
  );
}
