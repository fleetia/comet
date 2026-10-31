import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const connectButton = style({ width: 129, height: 30, minHeight: 30 });
export const headingActions = style({ display: "flex", alignItems: "center", gap: 8 });
export const alerts = style({ position: "relative" });
export const alertsSummary = style({
  position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, fontSize: 0, lineHeight: 0,
  listStyle: "none", cursor: "pointer", borderRadius: 15, color: tokens["color/ink-3"],
});
globalStyle(`${alertsSummary}::-webkit-details-marker`, { display: "none" });
export const accessibleLabel = style({ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" });
export const dirtyDot = style({ position: "absolute", right: 2, top: 2, width: 5, height: 5, borderRadius: "50%", background: tokens["color/cat-record"] });
export const alertsBody = style({
  position: "absolute", top: 36, right: 0, zIndex: 5, display: "grid", gap: 14,
  width: "min(540px, calc(100vw - 48px))", maxHeight: "min(560px, calc(100dvh - 190px))", overflowY: "auto",
  padding: 16, border: `1px solid ${tokens["color/card-border"]}`, borderRadius: 9,
  background: tokens["color/glass-window"], backdropFilter: "blur(20px)",
});
export const menuColorControls = style({ display: "grid", gap: 6, padding: 8 });

export const root = style({
  display: "grid",
  gap: 26,
  border: 0,
  margin: 0,
  padding: 0,
  minWidth: 0,
});
export const connectionSection = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
});
export const connectionHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  selectors: { "&[hidden]": { display: "none" } },
});
export const heading = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const connectionList = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  selectors: { "&[hidden]": { display: "none" } },
});
export const connectionCard = style({
  padding: "12px 14px",
  border: 0,
  boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
  display: "flex",
  flexDirection: "column",
  gap: 10,
});
export const connectionName = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
});
export const calendarIcon = style({
  display: "grid",
  placeItems: "center",
  width: 40,
  height: 40,
  flexShrink: 0,
  borderRadius: tokens["radius/radius-20"],
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
});
export const name = style({ margin: 0, fontSize: 14.5, lineHeight: "19px", fontWeight: 600 });
export const connectionText = style({ flex: 1, minWidth: 0, display: "grid", gap: 2 });
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const connectionStatus = style({
  flexShrink: 0, height: 24, minHeight: 24, padding: "0 10px",
  border: `1px solid ${tokens["color/chip-border"]}`, borderRadius: 12,
  background: tokens["color/chip"], color: tokens["color/ink-2"],
  fontSize: 12, lineHeight: "16px", fontWeight: 400,
});
export const attentionStatus = style([connectionStatus, {
  background: tokens["color/component/danger-alpha-100"], borderColor: tokens["color/danger-border"], color: tokens["color/cat-life"],
}]);
export const readyStatus = style([
  connectionStatus,
  {
    color: tokens["color/document/live-chip-label"],
    borderColor: tokens["color/document/live-chip-border"],
    background: tokens["color/document/live-chip-background"],
  },
]);
export const connectionCalendars = style({ paddingLeft: 54 });
globalStyle(`${connectionCalendars} > [role="group"]`, {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 6,
});
globalStyle(`${connectionCalendars} > [role="group"] > div`, {
  border: 0,
  boxShadow: `inset 0 0 0 1px ${tokens["color/chip-border"]}`,
  borderRadius: 14,
  background: tokens["color/chip"],
  paddingRight: 10,
});
export const connectionMenu = style({ position: "relative", flexShrink: 0 });
globalStyle(`${connectionMenu} > summary`, {
  display: "grid",
  placeItems: "center",
  listStyle: "none",
  cursor: "pointer",
  width: 30,
  height: 30,
  borderRadius: 15,
});
globalStyle(`${connectionMenu} > summary::-webkit-details-marker`, { display: "none" });
export const menuActions = style({
  position: "absolute",
  top: 34,
  right: 0,
  zIndex: 2,
  display: "grid",
  gap: 4,
  minWidth: 190,
  padding: 6,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 9,
  background: tokens["color/glass-window"],
});
export const connectionForm = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  selectors: { "&[hidden]": { display: "none" } },
});
export const providerChoices = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr)",
  gap: 8,
});
globalStyle(`${providerChoices} > button`, { width: "100%", textAlign: "left" });
export const providerPanel = style({
  display: "grid",
  gap: 12,
  minWidth: 0,
  border: 0,
  padding: 0,
  margin: 0,
});
export const group = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 9,
  overflow: "hidden",
  background: tokens["color/card"],
});
export const fetchGroup = style([group, { border: 0, boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}` }]);
globalStyle(`${fetchGroup} > div`, { paddingBlock: 9 });
export const settingRow = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  minHeight: 49,
  padding: "11px 16px",
  boxSizing: "border-box",
  fontSize: 14,
  lineHeight: "19px",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  selectors: { "&:last-child": { borderBottom: 0 } },
});
globalStyle(`${settingRow} > span:has(select)`, { width: "auto", flexShrink: 0 });
globalStyle(`${settingRow} select`, { width: "auto", height: 34, minHeight: 34, fontSize: 13 });
export const formGroup = style([group, { border: 0, boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}` }]);
export const formRow = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  minHeight: 78,
  padding: "10px 16px",
  boxShadow: `inset 0 -1px 0 ${tokens["color/divider"]}`,
  margin: 0,
  fontSize: 13,
  lineHeight: "18px",
});
globalStyle(`${formRow} > *`, { width: "100%", minWidth: 0 });
globalStyle(`${formRow} label`, { fontSize: 13, lineHeight: "18px", color: tokens["color/ink-2"] });
globalStyle(`${formRow} input`, { minHeight: 34, height: 34, fontSize: 13.5 });
export const swatches = style({ display: "flex", gap: 12, paddingInline: 4, alignItems: "center" });
export const swatch = style({
  display: "grid",
  placeItems: "center",
  width: 26,
  height: 26,
  padding: 0,
  border: "2px solid transparent",
  borderRadius: 13,
  cursor: "pointer",
  color: "#151a32",
  selectors: {
    '&[aria-pressed="true"]': {
      borderColor: tokens["color/ink"],
      boxShadow: `0 0 0 2px ${tokens["color/card"]}`,
    },
  },
});
export const customSwatch = style([swatch, {
  position: "relative", border: `1px solid ${tokens["color/card-border"]}`, color: tokens["color/ink-2"], background: tokens["color/card"],
  selectors: { "&:focus-within": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 } },
}]);
export const customColorInput = style({ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0, opacity: 0, cursor: "pointer" });
export const providerIcon = style([calendarIcon, { width: 36, height: 36 }]);
export const readOnlyCaption = style([caption, { lineHeight: "18px" }]);
export const localSection = style({ display: "grid", gap: 8 });
export const localRow = style({
  minHeight: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "11px 16px",
  boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}`,
  borderRadius: 9,
  background: tokens["color/card"],
  fontSize: 14,
  lineHeight: "19px",
});
export const previewDot = style({ width: 10, height: 10, borderRadius: "50%", flexShrink: 0 });
export const formActions = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  gap: 8,
});
export const readOnlyNotice = style({
  display: "flex", alignItems: "flex-start", gap: 10,
  margin: 0,
  fontSize: 12.5,
  lineHeight: "18px",
  padding: "12px 14px",
  borderRadius: 9,
  border: `1px solid ${tokens["color/danger-border"]}`,
  background: `color-mix(in srgb, ${tokens["color/danger"]} 8%, transparent)`,
  color: tokens["color/ink"],
});
export const noticeIcon = style({ flexShrink: 0, marginTop: 1, color: tokens["color/danger"] });
