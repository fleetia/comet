import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const header = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  width: "100%",
  minHeight: 32,
  height: "100%",
});
export const title = style({
  flex: 1,
  alignSelf: "stretch",
  minWidth: 0,
  userSelect: "none",
});
export const macTitle = style({ display: "flex", justifyContent: "flex-end" });
export const captionSpaceAll = style({ paddingRight: 138, boxSizing: "border-box" });
export const captionSpaceClose = style({ paddingRight: 46, boxSizing: "border-box" });
export const brand = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  height: "100%",
  whiteSpace: "nowrap",
});
export const icon = style({
  display: "block",
  flexShrink: 0,
  width: 24,
  height: 24,
  padding: 3,
  boxSizing: "border-box",
  background: tokens["color/component/primary-alpha-80"],
  borderRadius: 8,
});
export const brandName = style({
  flexShrink: 0,
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 15,
  fontWeight: 400,
  lineHeight: "1.385",
});
export const windowName = style({
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.385",
  paddingLeft: 10,
  borderLeft: `1px solid ${tokens["color/divider"]}`,
});
export const grabTarget = style({
  cursor: "grab",
  ":active": { cursor: "grabbing" },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  gap: tokens["spacing/space-8"],
});
export const trafficControls = style({
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexShrink: 0,
});
const traffic = style({
  width: 12,
  height: 12,
  minWidth: 12,
  padding: 0,
  border: 0,
  borderRadius: "50%",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
const lights = styleVariants({
  close: [traffic, { background: tokens["color/traffic-red"] }],
  minimize: [traffic, { background: tokens["color/traffic-yellow"] }],
  maximize: [traffic, { background: tokens["color/traffic-green"] }],
});
export const trafficClose = lights.close;
export const trafficMinimize = lights.minimize;
export const trafficMaximize = lights.maximize;
export const trafficInactive = style({
  width: 12,
  height: 12,
  flexShrink: 0,
  borderRadius: "50%",
  background: tokens["color/ink-3"],
  opacity: 0.35,
});
export const captionControls = style({
  position: "fixed",
  top: 0,
  right: 0,
  display: "flex",
  zIndex: 1,
});
export const captionButton = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 46,
  minWidth: 46,
  height: 32,
  padding: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  color: tokens["color/ink"],
  cursor: "pointer",
  selectors: {
    "&:hover:not(:disabled)": { background: tokens["color/hover"] },
    "&:active:not(:disabled)": { background: tokens["color/pressed"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: -2 },
  },
});
export const captionClose = style({
  selectors: {
    "&:hover:not(:disabled)": {
      background: tokens["color/window-close-hover"],
      color: tokens["color/window-close-ink"],
    },
    "&:active:not(:disabled)": {
      background: tokens["color/window-close-pressed"],
      color: tokens["color/window-close-ink"],
    },
  },
});
