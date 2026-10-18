import { style } from "@vanilla-extract/css";
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
