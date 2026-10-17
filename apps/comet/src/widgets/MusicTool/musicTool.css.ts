import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const root = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowWrap: "anywhere",
  gap: tokens["spacing/space-8"],
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
  background: tokens["color/card-2"],
  borderRadius: tokens["radius/radius-14"],
});
export const artwork = style([cover]);
export const artworkPlaceholder = style([
  cover,
  {
    display: "grid",
    placeItems: "center",
    color: tokens["color/ink-2"],
    fontSize: 38,
    border: `1px solid ${tokens["color/line"]}`,
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
  gap: tokens["spacing/space-6"],
});
export const tabList = style({ flex: 1, minWidth: 0, flexWrap: "wrap" });
export const scrollBody = style({
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  flex: 1,
  padding: `${tokens["spacing/space-16"]} 0`,
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
export const lyrics = style({ display: "grid", gap: tokens["spacing/space-16"] });
export const lyricsText = style({
  whiteSpace: "pre-wrap",
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontSize: 18,
  lineHeight: 2.15,
  padding: `${tokens["spacing/space-12"]} ${tokens["spacing/space-8"]} ${tokens["spacing/space-26"]}`,
});
export const empty = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  padding: `${tokens["spacing/space-26"]} 0`,
  color: tokens["color/ink-2"],
  lineHeight: "1.462",
});
export const info = style({ display: "grid", gap: tokens["spacing/space-12"] });
export const metadata = style({ margin: 0 });
export const metadataRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(95px, 26%) minmax(0, 1fr)",
  gap: tokens["spacing/space-16"],
  padding: `${tokens["spacing/space-8"]} 0`,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
globalStyle(`${metadataRow} dt`, { color: tokens["color/ink-2"] });
globalStyle(`${metadataRow} dd`, { margin: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" });
export const library = style({ display: "grid", gap: tokens["spacing/space-12"] });
export const libraryHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
});
export const trackList = style({ padding: 0, margin: 0, listStyle: "none" });
export const trackRow = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  alignItems: "center",
  padding: `${tokens["spacing/space-12"]} 0`,
});
export const trackSummary = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  minWidth: 0,
  flex: 1,
  fontSize: tokens["typography/sans/body/fontSize"],
});
