import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const header = style({
  display: "flex",
  flexDirection: "column",
  alignSelf: "start",
  gap: 14,
  padding: "18px 20px 20px",
  minWidth: 0,
  borderRadius: 9,
  border: 0,
  outline: `1px solid ${tokens["color/chip-border"]}`,
  outlineOffset: -1,
  background: `radial-gradient(420px 300px at 50% 0%, ${tokens["color/icon-tile"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const titleRow = style({ display: "flex", alignItems: "center", gap: 10, minWidth: 0 });
export const identity = style({ minWidth: 0, flex: 1 });
export const icon = style({
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  flexShrink: 0,
  borderRadius: 18,
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
});
export const title = style({
  margin: 0,
  fontSize: 22,
  lineHeight: "28px",
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontWeight: 400,
  color: tokens["color/ink"],
});
export const subtitle = style({
  margin: "1px 0 0",
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const inspectorSlot = style({ selectors: { "&:empty": { display: "none" } } });
export const editLink = style({
  display: "inline-flex",
  gap: 6,
  alignItems: "center",
  alignSelf: "start",
  padding: 0,
  minHeight: 20,
  color: tokens["color/cat-record"],
  fontSize: 12,
  lineHeight: "20px",
});
export const launch = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  textAlign: "center",
});
export const launchButton = style({
  width: "100%",
  justifyContent: "center",
  minHeight: 40,
  borderRadius: 20,
});
export const hint = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const manage = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  paddingTop: 14,
  borderTop: `1px solid ${tokens["color/divider"]}`,
});

globalStyle(`${editLink}${editLink}`, {
  height: 20,
  minHeight: 20,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  padding: 0,
  boxShadow: "none",
});

globalStyle(`${launchButton}${launchButton}`, { background: tokens["color/primary"], color: tokens["color/check-ink"] });
globalStyle(`${manage} > button:last-child`, { minHeight: 34, borderRadius: 17, padding: "0 16px", outline: `1px solid ${tokens["color/danger"]}`, outlineOffset: -1 });
