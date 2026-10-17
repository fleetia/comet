import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const columns = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: tokens["spacing/space-12"],
  "@media": { "(max-width: 760px)": { gridTemplateColumns: "1fr" } },
});
export const group = style({
  display: "grid",
  alignContent: "start",
  gap: tokens["spacing/space-6"],
  minWidth: 0,
});
export const permission = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-8"],
});
export const heading = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  color: tokens["color/primary"],
  marginTop: tokens["spacing/space-8"],
});
export const notice = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  padding: tokens["spacing/space-8"],
  background: tokens["color/card-2"],
});
