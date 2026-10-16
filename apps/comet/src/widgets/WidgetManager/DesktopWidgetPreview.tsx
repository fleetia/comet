import { useEffect, useState, type ReactElement } from "react";
import type { WidgetShape } from "@comet/ui";
import { FreeformWidget } from "../WidgetDisplay/DesktopWidget";
import {
  DEFAULT_APPEARANCE,
  backgroundPosition,
  getWidgetAppearance,
  placementAlignment,
  widgetBackgroundUrl,
} from "../widgetAppearance";
import type { WidgetView } from "../types";
import * as s from "./widgetPreview.css";

const SECOND_TICK = ["clock", "focus-timer", "music"];

/** Renders the same desktop widget, saved shape and appearance that the desktop shows. */
export function DesktopWidgetPreview({
  widget,
  widgets,
  shape,
  label,
}: {
  widget: WidgetView;
  widgets: readonly WidgetView[];
  shape?: WidgetShape;
  label: string;
}): ReactElement {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(
      () => setNow(Date.now()),
      SECOND_TICK.includes(widget.kind) ? 1000 : 60_000,
    );
    return () => window.clearInterval(timer);
  }, [widget.kind]);
  const appearance = getWidgetAppearance(widget.data);
  const alignment = placementAlignment(appearance.textPosition);
  return (
    <div className={s.stage} role="figure" aria-label={label}>
      <FreeformWidget
        widget={widget}
        widgets={widgets}
        now={now}
        shape={shape}
        backgroundImage={widgetBackgroundUrl(widget) ?? undefined}
        backgroundColor={
          appearance.backgroundColor !== DEFAULT_APPEARANCE.backgroundColor
            ? appearance.backgroundColor
            : undefined
        }
        textColor={
          appearance.textColor !== DEFAULT_APPEARANCE.textColor ? appearance.textColor : undefined
        }
        imagePosition={backgroundPosition(appearance.backgroundPosition)}
        contentStyle={
          appearance.textPosition !== DEFAULT_APPEARANCE.textPosition
            ? { alignItems: alignment.justifyContent, justifyContent: alignment.alignItems }
            : undefined
        }
      />
    </div>
  );
}
