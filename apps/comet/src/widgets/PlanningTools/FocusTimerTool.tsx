import { useLayoutEffect, useState, type ReactElement, type RefObject } from "react";
import { useWindowDrag } from "../../hooks/useWindowDrag";
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
import { record, text } from "../toolData";
import { notificationUnavailable, useNotificationAvailability } from "./useNotificationAvailability";

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
  onDirtyChange?: (dirty: boolean) => void;
  closeLayoutRef?: RefObject<{ collapsed: boolean; resizing: RefObject<boolean>; expand: () => Promise<boolean> } | null>;
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
  const availability = useNotificationAvailability(widget.id);
  const channel = text(record(record(widget.data).settings).finishNotification) || "bubble";
  const drag = useWindowDrag(!embedded, setError);
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
  useLayoutEffect(() => {
    if (!props.closeLayoutRef) return;
    props.closeLayoutRef.current = {
      collapsed: layout.collapsed,
      resizing: layout.resizing,
      expand: () => layout.resize(false),
    };
    return () => { if (props.closeLayoutRef) props.closeLayoutRef.current = null; };
  });
  const tool = { ...props, busy, embedded, active };
  const { calendar } = session.timer;
  return (
    <section
      ref={layout.host}
      className={s.root}
      aria-label="집중 타이머"
      data-window-resizing={layout.resizeWidth !== null}
      onPointerDown={(event) => {
        drag.reset();
        const target = event.target as Element;
        const excluded = target.closest(
          `button, input, textarea, select, [contenteditable], [role="button"], [role="slider"], [draggable='true'], .${s.dial}, .${s.recordsPanel}, .${s.noteSection}`,
        );
        if (
          embedded ||
          (excluded && !excluded.matches(`button.${s.compactTimer}`))
        )
          return;
        drag.onPointerDown(event);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={(event) => {
        if (!(event.target as Element).closest(`button.${s.compactTimer}`)) drag.reset();
      }}
      onPointerCancel={drag.reset}
      onClickCapture={(event) => {
        if (!(event.target as Element).closest(`button.${s.compactTimer}`)) return;
        if (event.detail !== 0 && drag.dragged()) {
          event.preventDefault();
          event.stopPropagation();
        }
        drag.reset();
      }}
    >
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notificationUnavailable(channel, availability.bubble, availability.permission) && (
        <p role="status" className={s.error}>지금은 알림이 나가지 않아요.</p>
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
