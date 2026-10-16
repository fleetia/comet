import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const window = style({
  boxSizing: "border-box",
  minHeight: "100dvh",
  overflow: "hidden",
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
});
/** Measured for fit_widget_stack: its box is the whole visible stack. */
export const root = style({
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  width: "max-content",
  padding: 12,
});
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 4,
  height: 28,
  opacity: 0,
  transition: "opacity 120ms ease",
  cursor: "grab",
  selectors: {
    "&:focus-within": { opacity: 1 },
    [`${root}:hover &`]: { opacity: 1 },
  },
});
export const toolbarVisible = style({ opacity: 1 });
export const grip = style({
  flex: 1,
  height: 4,
  maxWidth: 40,
  marginInline: "auto",
  borderRadius: 2,
  background: tokens["color/glass-border"],
});
export const capsuleDock = style({ width: "max-content" });
export const stack = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  maxWidth: "100%",
});
export const row = style({ position: "relative", flexShrink: 0, minWidth: 0 });
globalStyle(`${row}[hidden]`, { display: "none" });
export const editingRow = style({ cursor: "grab" });
export const selectedRow = style({
  outline: `2px solid ${tokens["color/primary"]}`,
  outlineOffset: 2,
});
export const movePill = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  marginRight: "auto",
  padding: "0 12px",
  borderRadius: 14,
  background: tokens["color/glass-panel"],
  boxShadow: `inset 0 0 0 1px ${tokens["color/glass-border"]}`,
  color: tokens["color/ink-2"],
  fontSize: 12,
  whiteSpace: "nowrap",
});
export const remove = style({
  position: "absolute",
  top: -6,
  left: -6,
  zIndex: 2,
  width: 24,
  height: 24,
  minWidth: 24,
  borderRadius: 12,
  background: tokens["color/glass-panel"],
  boxShadow: `0 0 0 1px ${tokens["color/glass-border"]}`,
});
export const notice = style({
  margin: 0,
  padding: "10px 14px",
  borderRadius: 16,
  background: tokens["color/glass-panel"],
  color: tokens["color/ink-2"],
  fontSize: 12,
});
globalStyle(`${notice} p`, { margin: "0 0 6px" });
export const error = style({
  maxWidth: 370,
  margin: 0,
  padding: 8,
  borderRadius: 12,
  background: tokens["color/glass-panel"],
  color: tokens["color/danger"],
  fontSize: 12,
});
