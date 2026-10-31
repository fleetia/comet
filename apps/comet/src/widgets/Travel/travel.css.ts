import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const layout = style({
  display: "grid",
  gridTemplateColumns: "100px minmax(0, 1fr)",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
});
export const brand = style({
  alignSelf: "flex-start",
  color: tokens["color/ink-3"],
  fontSize: 11,
  margin: "0 0 4px 3px",
});
export const main = style({
  display: "flex",
  flexDirection: "column",
  gap: 20,
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "34px 30px 24px 32px",
});
export const header = style({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
});
export const headerText = style({ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 });
export const travelTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 20,
  lineHeight: "26px",
  fontWeight: 400,
});
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  margin: 0,
});
export const actions = style({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
export const heading = style({ display: "flex", flexDirection: "column", gap: 10 });
export const pageTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "34px",
  fontWeight: 400,
});
export const list = style({ display: "flex", flexDirection: "column", gap: 12 });
export const row = style({ width: "100%" });
export const gap = style({ color: tokens["color/ink-2"], fontSize: 12, margin: "0 0 0 16px" });
export const columns = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 16,
  "@media": { "(max-width: 860px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const sectionTitle = style({ margin: 0, fontSize: 13, fontWeight: 600 });
export const footer = style({
  marginTop: "auto",
  color: tokens["color/ink-2"],
  fontSize: 12,
});
export const empty = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 12,
  margin: "auto 0",
});
export const status = style({ margin: "auto", color: tokens["color/ink-2"] });
export const form = style({ display: "flex", flexDirection: "column", gap: 14 });
export const fieldRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 12,
});
export const formActions = style({
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 4,
});
export const deleteAction = style({ marginRight: "auto" });
export const fieldRow3 = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
  gap: 12,
});
export const inline = style({ display: "flex", alignItems: "center", gap: 8, minWidth: 0 });
export const grow = style({ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" });
export const footerRow = style({
  marginTop: "auto",
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  color: tokens["color/ink-2"],
  fontSize: 12,
});
export const weight = style({ width: 72 });
export const settleRow = style({ display: "flex", alignItems: "center", gap: 10 });
export const spreadActions = style({ display: "flex", justifyContent: "space-between", gap: 8 });
export const LIST_COLORS = ["blue", "coral", "green", "violet", "yellow", "pink", "gray"] as const;
export const dot = style({
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
  background: tokens["color/ink-3"],
  selectors: Object.fromEntries(
    LIST_COLORS.map((name) => [`&[data-color="${name}"]`, { background: tokens[`color/list-${name}`] }]),
  ),
});
export const mapFrame = style({
  position: "relative",
  margin: 0,
  width: "100%",
  aspectRatio: "840 / 360",
  overflow: "hidden",
  borderRadius: 9,
  selectors: {
    '&[data-tiles="true"]': {
      border: `1px solid ${tokens["color/card-border"]}`,
      background: tokens["color/card"],
    },
  },
});
export const tile = style({ position: "absolute", aspectRatio: "1", opacity: 0.7, pointerEvents: "none" });
export const mapSvg = style({
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  selectors: { '&[data-pinning="true"]': { cursor: "crosshair" } },
});
export const route = style({
  fill: "none",
  strokeWidth: 2,
  stroke: tokens["color/ink-3"],
  selectors: {
    ...Object.fromEntries(
      LIST_COLORS.map((name) => [`&[data-color="${name}"]`, { stroke: tokens[`color/list-${name}`] }]),
    ),
    '&[data-dashed="true"]': { strokeDasharray: "6 5" },
  },
});
export const stop = style({ fill: tokens["color/primary"], stroke: tokens["color/rail"], strokeWidth: 2 });
export const stopLabel = style({ fill: tokens["color/ink"], fontSize: 12 });
export const photoDot = style({ fill: tokens["color/ink-2"], opacity: 0.6 });
export const legend = style({
  position: "absolute",
  right: 12,
  bottom: 10,
  display: "flex",
  gap: 14,
  alignItems: "center",
  color: tokens["color/ink-2"],
  fontSize: 11,
});
export const legendLine = style({
  width: 16,
  height: 2,
  borderRadius: 1,
  background: tokens["color/ink-3"],
  selectors: Object.fromEntries(
    LIST_COLORS.map((name) => [`&[data-color="${name}"]`, { background: tokens[`color/list-${name}`] }]),
  ),
});
export const mapEmpty = style({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 24,
  borderRadius: 9,
  border: `1px dashed ${tokens["color/card-border"]}`,
});
export const settings = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingTop: 12,
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const photoGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
  gap: 10,
});
export const photoButton = style({
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
});
export const thumb = style({
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  aspectRatio: "4 / 3",
  overflow: "hidden",
  borderRadius: 10,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  selectors: { '&[data-missing="true"]': { opacity: 0.55 } },
});
globalStyle(`${thumb} img`, { width: "100%", height: "100%", objectFit: "cover" });
export const badge = style({
  position: "absolute",
  left: 6,
  top: 6,
  padding: "1px 6px",
  borderRadius: 6,
  fontSize: 10.5,
  background: tokens["color/chip"],
  border: `1px solid ${tokens["color/chip-border"]}`,
  selectors: { [`& + &`]: { top: 28 } },
});
export const emptyCard = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 260,
  padding: 24,
  textAlign: "center",
  borderRadius: 9,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
});
globalStyle(`${mapFrame}[data-compact="true"] text`, { fontSize: 16 });
