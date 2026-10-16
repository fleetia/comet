import { type ReactElement } from "react";
import type { WidgetView } from "../types";
import { MusicTool } from "../MusicTool/MusicTool";
import { MusicSettings } from "../MusicTool/MusicSettings";
import { WeatherSettings } from "./WeatherSettings";
import { WeatherTool } from "./WeatherTool";

type Props = {
  widget: WidgetView;
  mode?: "settings" | "tool";
  sideContainer?: HTMLElement | null;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCollapse?: () => void;
};
export function ConnectionTool({ onCollapse, ...props }: Props): ReactElement {
  if (props.widget.kind === "music")
    return props.mode === "settings" ? (
      <MusicSettings {...props} />
    ) : (
      <MusicTool widget={props.widget} onCollapse={onCollapse} />
    );
  return props.mode === "settings" ? (
    <WeatherSettings {...props} />
  ) : (
    <WeatherTool widget={props.widget} />
  );
}
