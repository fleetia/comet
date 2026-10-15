import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const root = style({ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 });
export const toolbar = style({ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" });
export const spacer = style({ flex: 1, minWidth: 0 });
export const range = style({
  margin: 0,
  fontWeight: 400,
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontSize: 21,
  color: tokens["color/ink"],
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  gap: 18,
  alignItems: "start",
  "@media": { "(max-width: 1100px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const main = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minWidth: 0,
  alignItems: "stretch",
});
export const details = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
  alignItems: "stretch",
});
export const titleButton = style({
  appearance: "none",
  border: 0,
  padding: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const detailTitle = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 19,
  fontWeight: 400,
  lineHeight: "24px",
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
});
export const statistics = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 8,
});
const panel = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  borderRadius: tokens["radius/radius-18"],
});
export const stat = style([
  panel,
  {
    display: "flex",
    flexDirection: "column",
    padding: "10px 12px",
    gap: 1,
    fontSize: 11,
    lineHeight: "15px",
    color: tokens["color/ink-3"],
  },
]);
export const settings = style([panel, { overflow: "hidden" }]);
export const statValue = style({
  fontSize: 18,
  lineHeight: "24px",
  fontWeight: 500,
  color: tokens["color/ink"],
});
export const setting = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  minHeight: 50,
  padding: "8px 16px",
  boxSizing: "border-box",
  borderBottom: `1px solid ${tokens["color/divider"]}`,
  fontSize: 14,
  selectors: { "&:last-child": { borderBottom: 0 } },
});
export const recordControls = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
});
export const feedback = style([
  panel,
  {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    background: tokens["color/card-2"],
    fontSize: 14,
    lineHeight: "19px",
  },
]);
export const caption = style({
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
  margin: "2px 0 0",
});
export const feedbackIcon = style({
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/component/cat-rest-alpha-160"],
});
export const feedbackCharacter = style({ position: "relative", width: 31, height: 31 });
export const feedbackBody = style({ position: "absolute", left: "20.31%", top: "12.5%" });
export const feedbackSpark = style({ position: "absolute", left: "12.5%", top: "23.44%" });
export const error = style({
  margin: 0,
  color: tokens["color/danger"],
  fontSize: 13,
  lineHeight: "19px",
});
export const empty = style({ margin: 0, padding: 16, color: tokens["color/ink-2"] });
export const form = style({ display: "flex", flexDirection: "column", gap: 14, minWidth: 280 });
export const weekdays = style({
  display: "flex",
  gap: 12,
  border: 0,
  padding: 0,
  margin: 0,
  fontSize: 13,
});
