import type { ReactElement } from "react";
import type { WidgetShape } from "@comet/ui";
import type { WidgetView } from "../types";
import type { ToolAction } from "../toolData";
import { FocusSettingsPreview } from "../PlanningTools/FocusSettingsPreview";
import { DesktopWidgetPreview } from "./DesktopWidgetPreview";
import { canPlaceOnDesktop } from "./useWidgetDesktop";

export function WidgetDetailPreview({
  widget,
  widgets = [],
  shape,
  act,
  disabled,
  onBusyChange,
}: {
  widget: WidgetView;
  widgets?: readonly WidgetView[];
  shape?: WidgetShape;
  act?: ToolAction;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement | null {
  if (widget.kind === "focus-timer" && act) {
    return (
      <FocusSettingsPreview
        key={widget.id}
        widget={widget}
        act={act}
        disabled={disabled}
        onBusyChange={onBusyChange}
      />
    );
  }
  if (!canPlaceOnDesktop(widget.kind)) return null;
  return (
    <DesktopWidgetPreview
      widget={widget}
      widgets={widgets}
      shape={shape}
      label="바탕화면 위젯 미리보기"
    />
  );
}
