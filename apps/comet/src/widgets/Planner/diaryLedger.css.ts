import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const page = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
  color: tokens["color/ink"],
});
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 36,
  flexWrap: "wrap",
});
export const title = style({
  margin: 0,
  flex: 1,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
export const columns = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 320px",
  gap: 18,
  minWidth: 0,
  "@media": { "(max-width: 1050px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const column = style({ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 });
export const sidebar = style([column, { gap: 14 }]);
export const fullWidth = style({ width: "100%" });
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const card = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  padding: "14px 18px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-20"],
  background: tokens["color/card-2"],
});
export const heading = style({ margin: 0, fontSize: 13.5, fontWeight: 600, lineHeight: "18px" });
export const amount = style({
  fontFamily: tokens["typography/display/title-lg/fontFamily"],
  fontSize: 20,
  lineHeight: "26px",
});
export const rows = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
  overflow: "hidden",
});
export const entryRow = style({
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  paddingRight: 6,
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const entry = style({ flex: 1, width: "100%", minWidth: 0 });
export const group = style({ display: "flex", flexDirection: "column", gap: 6 });
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  minWidth: 0,
});
export const spread = style({ flex: 1, minWidth: 0 });
export const form = style({ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 });
export const formRow = style({
  display: "grid",
  gridTemplateColumns: "84px minmax(0, 1fr)",
  alignItems: "start",
  gap: 12,
  "@media": { "(max-width: 480px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: 4 } },
});
export const label = style([caption, { paddingTop: 8 }]);
export const actions = style([row, { justifyContent: "flex-end", paddingTop: 6 }]);
export const months = style({
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: 6,
});
export const error = style([caption, { color: tokens["color/danger"] }]);
export const income = style({ color: tokens["color/cat-focus"] });
export const settingsRow = style([
  row,
  {
    padding: "9px 16px",
    selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
  },
]);
export const forecastTable = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  lineHeight: "24px",
  textAlign: "left",
});
