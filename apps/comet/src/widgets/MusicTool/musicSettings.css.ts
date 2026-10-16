import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const workspace = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  minWidth: 0,
  alignItems: "start",
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const withSideContainer = style({ minWidth: 0 });
export const side = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  margin: 0,
  border: 0,
  padding: 0,
  minWidth: 0,
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const options = style({
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
});
export const optionRow = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  minHeight: 46,
  boxSizing: "border-box",
  padding: "9px 16px",
  boxShadow: `inset 0 -1px ${tokens["color/divider"]}`,
  fontSize: 14,
  lineHeight: "19px",
  selectors: { "&:last-child": { boxShadow: "none" } },
});
globalStyle(`${optionRow} > span:first-child`, { flex: 1, minWidth: 0, display: "grid", gap: 2 });
globalStyle(`${optionRow} > span:first-child > span`, { lineHeight: "16px" });
export const settings = style({
  display: "flex",
  flexDirection: "column",
  gap: 26,
  minWidth: 0,
  border: 0,
  margin: 0,
  padding: 0,
});
export const form = style({ display: "flex", flexDirection: "column", gap: 14 });
export const section = style({ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 });
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const rows = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  overflow: "hidden",
  background: tokens["color/card"],
});
export const providerSelect = style({
  maxWidth: 142,
  width: 142,
  flexShrink: 0,
  height: 34,
  minHeight: 34,
  fontSize: 13,
});
export const settingRow = style([optionRow, { padding: "11px 16px", minHeight: 49 }]);
export const providerGroup = style({ borderBottom: `1px solid ${tokens["color/divider"]}` });
export const platformChip = style({ height: 24, minHeight: 24, padding: "0 10px" });
export const settingActions = style({
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
});
export const sectionHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
});
export const status = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
  textAlign: "right",
});
export const pairingCode = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "12px 16px",
  border: `1px solid ${tokens["color/selected-border"]}`,
  borderRadius: 16,
  background: tokens["color/selected"],
});
globalStyle(`${pairingCode} code`, {
  fontSize: 22,
  letterSpacing: ".08em",
  color: tokens["color/selected-ink"],
});
export const headingActions = style({ display: "flex", alignItems: "center", gap: 8 });
export const moreMenu = style({ position: "relative", flexShrink: 0 });
globalStyle(`${moreMenu} > summary`, {
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 18,
  cursor: "pointer",
  listStyle: "none",
  borderRadius: 9,
  color: tokens["color/ink-3"],
});
globalStyle(`${moreMenu} > summary::-webkit-details-marker`, { display: "none" });
export const morePanel = style({
  position: "absolute",
  zIndex: 4,
  top: 26,
  right: 0,
  display: "grid",
  gap: 12,
  width: "min(340px, calc(100vw - 80px))",
  padding: 14,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/component/os-notification-surface"],
  backdropFilter: "blur(16px)",
  boxShadow: `0 14px 34px ${tokens["color/component/surface-shadow-alpha-400"]}`,
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "18px",
});
globalStyle(`${morePanel} p`, { margin: 0 });
globalStyle(`${morePanel} ${optionRow}`, { padding: 0 });

globalStyle(`${settingRow} > span:has(select)`, { flex: "0 0 142px", width: 142, minWidth: 0 });
globalStyle(`${settingRow} > span:has(select) select`, { width: "100%", maxWidth: "100%" });
