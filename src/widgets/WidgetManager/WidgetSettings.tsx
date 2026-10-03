import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Surface } from "@fleetia/lagrange";
import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionObservation, ConnectionTool } from "../ConnectionTools/ConnectionTools";
import { ClockSettings } from "../PlanningTools/PlanningTools";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as styles from "./widgetManager.css";

export const CONFIGURABLE_WIDGETS = ["calendar", "weather", "music", "clock"];
export const DISPLAY_KINDS = ["clock", "weather"];

export function WidgetSettings({
  widget,
  active,
  act,
  onDirtyChange,
  displayControls,
  metadata,
  related,
  disabled,
}: {
  widget: WidgetView;
  active: boolean;
  act: ToolAction;
  onDirtyChange: (id: string, dirty: boolean) => void;
  displayControls?: ReactNode;
  metadata?: ReactNode;
  related?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  const [appearanceActions, setAppearanceActions] = useState<HTMLDivElement | null>(null);
  const [compactActions, setCompactActions] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(
    () => window.matchMedia?.("(max-width: 1439px)").matches ?? window.innerWidth <= 1439,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 1439px)");
    const update = (): void => setCompact(query?.matches ?? window.innerWidth <= 1439);
    if (query) query.addEventListener("change", update);
    else window.addEventListener("resize", update);
    return () => {
      if (query) query.removeEventListener("change", update);
      else window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    onDirtyChange(widget.id, connectionDirty || appearanceDirty);
  }, [widget.id, connectionDirty, appearanceDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(widget.id, false), [widget.id, onDirtyChange]);
  const configure: ToolAction = (action, input, target = widget) => act(action, input, target);
  return (
    <div
      data-widget-settings
      className={
        DISPLAY_KINDS.includes(widget.kind) ? styles.settingsColumns : styles.settingsSingle
      }
    >
      <div className={styles.settingsBody} data-widget-settings-body>
        <div className={styles.connectionColumn}>
          <Surface
            className={`${styles.connectionPanel} ${widget.kind === "weather" ? styles.weatherConnection : ""}`}
            role="region"
            aria-label={widget.kind === "weather" ? "지역과 연결" : "위젯 설정"}
          >
            <fieldset className={styles.connectionFields} disabled={disabled}>
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
                  mode="settings"
                  onDirtyChange={setConnectionDirty}
                />
              )}
              {widget.kind === "clock" && <ClockSettings widget={widget} act={configure} />}
            </fieldset>
            {related}
            {metadata}
          </Surface>
          {widget.kind === "weather" && (
            <Surface className={styles.observationPanel}>
              <ConnectionObservation widget={widget} />
            </Surface>
          )}
        </div>
        {DISPLAY_KINDS.includes(widget.kind) && (
          <Surface className={styles.appearancePanel} role="region" aria-label="바탕화면 표시">
            <WidgetAppearance
              widget={widget}
              onDirtyChange={setAppearanceDirty}
              active={active}
              actionContainer={compact ? compactActions : appearanceActions}
              displayControls={displayControls}
              disabled={disabled}
            />
            <div
              className={styles.appearanceActions}
              data-appearance-actions
              ref={setAppearanceActions}
            />
          </Surface>
        )}
      </div>
      {DISPLAY_KINDS.includes(widget.kind) && (
        <div
          className={styles.compactActions}
          data-compact-appearance-actions
          ref={setCompactActions}
        />
      )}
    </div>
  );
}
