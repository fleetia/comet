import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const root = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowWrap: "anywhere",
  gap: vars.space.sm,
  "@media": { "(max-height: 440px)": { flex: "none" } },
});
export const fixed = style({
  flexShrink: 0,
  display: "grid",
  gap: 12,
});
export const primary = style({ position: "relative", width: 370, maxWidth: "100%" });
const cover = style({
  width: 64,
  height: 64,
  flexShrink: 0,
  objectFit: "cover",
  background: vars.color.surface.muted,
  borderRadius: tokens["radius/radius-14"],
});
export const artwork = style([cover]);
export const artworkPlaceholder = style([
  cover,
  {
    display: "grid",
    placeItems: "center",
    color: vars.color.content.secondary,
    fontSize: 38,
    border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  },
]);
export const notice = style({
  margin: 0,
  fontSize: 12,
  color: tokens["color/ink-3"],
  lineHeight: "17px",
});
export const tabs = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  "@media": { "(max-height: 440px)": { flex: "none" } },
});
export const tabHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  gap: vars.space.xs,
});
export const tabList = style({ flex: 1, minWidth: 0, flexWrap: "wrap" });
export const scrollBody = style({
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  flex: 1,
  padding: `${vars.space.lg} 0`,
  "@media": { "(max-height: 440px)": { flex: "none", overflowY: "visible" } },
});
export const moreMenu = style({
  position: "absolute",
  top: 16,
  right: 18,
  zIndex: 3,
  selectors: { "&[data-collapse]": { right: 87 } },
});
export const morePanel = style({
  position: "absolute",
  top: 36,
  right: 0,
  width: "min(260px, calc(100vw - 48px))",
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
});
export const trackSummary = style({
  display: "grid",
  gap: vars.space.xs,
  minWidth: 0,
  flex: 1,
  fontSize: vars.typography.size.label,
});
