import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const root = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  gap: vars.space.sm,
});
export const fixed = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.md,
  paddingTop: vars.space.sm,
});
export const hero = style({
  display: "flex",
  gap: vars.space.lg,
  alignItems: "center",
  minWidth: 0,
});
const cover = style({
  width: 84,
  height: 84,
  flexShrink: 0,
  objectFit: "cover",
  background: vars.color.surface.muted,
  selectors: { [`${root}[data-expanded="true"] &`]: { width: 128, height: 128 } },
  "@media": {
    "(max-width: 520px)": {
      selectors: { [`${root}[data-expanded="true"] &`]: { width: 84, height: 84 } },
    },
  },
});
export const artwork = style([cover]);
export const artworkPlaceholder = style([
  cover,
  {
    display: "grid",
    placeItems: "center",
    color: vars.color.content.secondary,
    fontSize: 38,
    border: `1px solid ${vars.color.border.subtle}`,
  },
]);
export const summary = style({ flex: 1, minWidth: 0, display: "grid", gap: vars.space.xs });
export const source = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const title = style({
  fontFamily: vars.typography.family.display,
  fontSize: 22,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
});
export const artist = style({
  fontSize: vars.typography.size.label,
  color: vars.color.content.secondary,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
});
export const timeline = style({ display: "grid", gap: 2, marginTop: vars.space.xs });
export const range = style({
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
  width: "100%",
  minWidth: 0,
  height: 16,
  margin: 0,
  background: "transparent",
  accentColor: vars.color.content.accent,
  selectors: {
    "&:disabled": { cursor: "default", opacity: 0.5 },
    "&:focus-visible": { outline: `2px solid ${vars.color.interaction.focus}`, outlineOffset: 2 },
  },
});
globalStyle(`${range}::-webkit-slider-runnable-track`, {
  background: vars.color.border.strong,
  height: 2,
});
globalStyle(`${range}::-webkit-slider-thumb`, {
  appearance: "none",
  WebkitAppearance: "none",
  width: 8,
  height: 8,
  marginTop: -3,
  borderRadius: 0,
  background: vars.color.content.accent,
});
globalStyle(`${range}::-moz-range-track`, { background: vars.color.border.strong, height: 2 });
globalStyle(`${range}::-moz-range-thumb`, {
  width: 8,
  height: 8,
  border: 0,
  borderRadius: 0,
  background: vars.color.content.accent,
});
export const time = style({
  display: "flex",
  justifyContent: "space-between",
  fontFamily: vars.typography.family.data,
  fontVariantNumeric: "tabular-nums",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const controls = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
  flexWrap: "wrap",
});
export const transport = style({ display: "flex", alignItems: "center", gap: vars.space.xs });
export const secondaryControls = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.xs,
  minWidth: 0,
});
globalStyle(`${secondaryControls} button[aria-pressed="true"]`, {
  color: vars.color.content.accent,
  background: vars.color.selection.surface,
});
export const volume = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  width: 100,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  whiteSpace: "nowrap",
});
export const notice = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  lineHeight: vars.typography.lineHeight.body,
});
export const tabs = style({ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 });
export const tabHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  borderBottom: `1px solid ${vars.color.border.strong}`,
  gap: vars.space.xs,
});
export const tabList = style({ flex: 1, minWidth: 0, flexWrap: "wrap" });
export const scrollBody = style({
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  flex: 1,
  padding: `${vars.space.lg} 0`,
});
export const compactLinks = style({
  display: "flex",
  gap: vars.space.xs,
  borderTop: `1px dotted ${vars.color.border.subtle}`,
  paddingTop: vars.space.xs,
});
export const footer = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  gap: vars.space.sm,
  marginTop: "auto",
});
export const lyrics = style({ display: "grid", gap: vars.space.lg });
export const lyricsText = style({
  whiteSpace: "pre-wrap",
  fontFamily: vars.typography.family.display,
  fontSize: 18,
  lineHeight: 2.15,
  padding: `${vars.space.md} ${vars.space.sm} ${vars.space.xl}`,
});
export const empty = style({
  display: "grid",
  gap: vars.space.sm,
  padding: `${vars.space.xl} 0`,
  color: vars.color.content.secondary,
  lineHeight: vars.typography.lineHeight.body,
});
export const info = style({ display: "grid", gap: vars.space.md });
export const metadata = style({ margin: 0 });
export const metadataRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(95px, 26%) minmax(0, 1fr)",
  gap: vars.space.lg,
  padding: `${vars.space.sm} 0`,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
globalStyle(`${metadataRow} dt`, { color: vars.color.content.secondary });
globalStyle(`${metadataRow} dd`, { margin: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" });
export const library = style({ display: "grid", gap: vars.space.md });
export const libraryHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.sm,
  flexWrap: "wrap",
});
export const trackList = style({ padding: 0, margin: 0, listStyle: "none" });
export const trackRow = style({
  display: "flex",
  gap: vars.space.sm,
  alignItems: "center",
  padding: `${vars.space.md} 0`,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
});
export const trackSummary = style({
  display: "grid",
  gap: vars.space.xs,
  minWidth: 0,
  flex: 1,
  fontSize: vars.typography.size.label,
});
export const settings = style({
  display: "grid",
  gap: vars.space.md,
  margin: 0,
  border: 0,
  padding: 0,
  minWidth: 0,
});
export const settingsForm = style({ display: "grid", gap: vars.space.lg });
export const settingField = style({ display: "grid", gap: vars.space.sm });
export const options = style({ display: "grid", gap: vars.space.md });
export const settingActions = style({ display: "flex", gap: vars.space.sm, flexWrap: "wrap" });
export const pairing = style({
  display: "grid",
  gap: vars.space.md,
  marginTop: vars.space.lg,
  paddingTop: vars.space.lg,
  borderTop: `1px solid ${vars.color.border.subtle}`,
  lineHeight: vars.typography.lineHeight.body,
});
export const pairingCode = style({
  display: "grid",
  gap: vars.space.sm,
  padding: vars.space.md,
  background: vars.color.surface.muted,
});
globalStyle(`${pairingCode} code`, {
  fontSize: 24,
  letterSpacing: "0.08em",
  overflowWrap: "anywhere",
});
