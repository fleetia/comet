import { style } from "@vanilla-extract/css";
import { list } from "../SettingsPanel/settings.css";

export const memoryList = style([
  list,
  { maxHeight: "min(360px, 45vh)", overflowY: "auto", overscrollBehavior: "contain" },
]);
