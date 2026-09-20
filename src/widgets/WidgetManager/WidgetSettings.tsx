import { useEffect, useState, type ReactElement } from "react";
import { Heading } from "@fleetia/lagrange";
import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionTool } from "../ConnectionTools/ConnectionTools";
import { ClockSettings } from "../PlanningTools/PlanningTools";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as styles from "./widgetManager.css";

export const CONFIGURABLE_WIDGETS = ["calendar", "weather", "music", "device", "clock"];
export const DISPLAY_KINDS = ["clock", "weather", "device"];

export function WidgetSettings({
  widget,
  active,
  act,
  onDirtyChange,
}: {
  widget: WidgetView;
  active: boolean;
  act: ToolAction;
  onDirtyChange: (id: string, dirty: boolean) => void;
}): ReactElement {
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [appearanceDirty, setAppearanceDirty] = useState(false);
  useEffect(() => {
    onDirtyChange(widget.id, connectionDirty || appearanceDirty);
  }, [widget.id, connectionDirty, appearanceDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(widget.id, false), [widget.id, onDirtyChange]);
  const configure: ToolAction = (action, input, target = widget) => act(action, input, target);
  return (
    <>
      {widget.kind === "calendar" && (
        <CalendarTool
          widget={widget}
          act={configure}
          mode="settings"
          active={active}
          onDirtyChange={setConnectionDirty}
        />
      )}
      {["weather", "music", "device"].includes(widget.kind) && (
        <ConnectionTool widget={widget} mode="settings" onDirtyChange={setConnectionDirty} />
      )}
      {widget.kind === "clock" && <ClockSettings widget={widget} act={configure} />}
      {DISPLAY_KINDS.includes(widget.kind) && (
        <section className={styles.group}>
          <Heading level={4} variant="label">
            바탕화면 표시 설정
          </Heading>
          <WidgetAppearance widget={widget} onDirtyChange={setAppearanceDirty} />
        </section>
      )}
    </>
  );
}
