import { useState, type ReactElement, type ReactNode } from "react";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { FocusTimerControls } from "./FocusTimerControls";
import { FocusTimerContext } from "./FocusTimerContext";
import { useFocusTimerClock } from "./useFocusTimerClock";
import { useFocusTimerContext } from "./useFocusTimerContext";
import { useFocusTimerLayout, useFocusTimerLayoutState } from "./useFocusTimerLayout";
import { useFocusTimerSession } from "./useFocusTimerSession";
import { useFocusTimerTodoCompletion } from "./useFocusTimerTodoCompletion";
import * as s from "./FocusTimer.css";

export { readDraft } from "./useFocusTimerSession";

type TimerToolProps = {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  headerActionsTarget?: HTMLElement | null;
  onClose?: () => Promise<void>;
  busy?: boolean;
  embedded?: boolean;
  active?: boolean;
  onCollapse?: () => void;
  companionRows?: (now: number) => ReactNode;
};

export type FocusTimerToolViewProps = TimerToolProps & {
  busy: boolean;
  embedded: boolean;
  active: boolean;
};

export function TimerTool(props: TimerToolProps): ReactElement {
  const { widget, widgets, act, busy: hostBusy = false, embedded = false, active = true } = props;
  const busy = hostBusy || !active;
  const [error, setError] = useState("");
  const layoutState = useFocusTimerLayoutState(embedded);
  const panel = useFocusTimerContext(widget, active, hostBusy, layoutState, setError);
  const now = useFocusTimerClock();
  const session = useFocusTimerSession(widget, widgets, act, now, setError);
  const completion = useFocusTimerTodoCompletion(act, setError);
  const layout = useFocusTimerLayout(
    widget,
    embedded,
    active,
    layoutState,
    panel,
    session.timer.phase,
    setError,
  );
  const tool = { ...props, busy, embedded, active };
  const { calendar } = session.timer;
  return (
    <section
      ref={layout.host}
      className={s.root}
      aria-label="집중 타이머"
      data-window-resizing={layout.resizeWidth !== null}
    >
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
      <div
        ref={layout.layout}
        className={s.layout}
        data-expanded={layout.expanded}
        data-embedded={embedded}
        data-collapsed={layout.collapsed}
        data-resizing={layout.resizeWidth !== null}
      >
        <FocusTimerControls
          tool={tool}
          session={session}
          layout={layout}
          panel={panel}
          completion={completion}
        />
        <FocusTimerContext tool={tool} session={session} layout={layout} panel={panel} />
      </div>
    </section>
  );
}
