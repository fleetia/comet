import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const panel = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  flex: 1,
  minHeight: 0,
});
export const actions = style({ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" });
export const search = style({ width: 260 });
export const layout = style({
  display: "grid",
  gridTemplateColumns: "300px minmax(0, 1fr)",
  gap: 18,
  flex: 1,
  minHeight: 480,
  "@media": {
    "(max-width: 1000px)": { gridTemplateColumns: "240px minmax(0,1fr)" },
    "(max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
});
const card = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card-2"],
  minWidth: 0,
});
export const list = style([
  card,
  { display: "flex", flexDirection: "column", gap: 6, padding: 12, overflowY: "auto" },
]);
export const detail = style([
  card,
  { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 22, padding: 24 },
]);
export const heading = style({
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontWeight: 400,
  fontSize: 21,
  lineHeight: "30px",
  margin: 0,
});
export const emptyHits = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 8,
});
export const caption = style({
  fontSize: 12,
  lineHeight: "20px",
  margin: 0,
  color: tokens["color/ink-2"],
  overflowWrap: "anywhere",
});
export const text = style({
  fontSize: 14,
  lineHeight: "24px",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  margin: 0,
});
export const source = style({
  borderTop: `1px solid ${tokens["color/divider"]}`,
  paddingTop: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: "auto",
});
