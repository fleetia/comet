import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 });
export const heading = style({
  margin: 0,
  fontSize: 13,
  color: tokens["color/ink-2"],
  fontWeight: 400,
});
export const steps = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 10,
  marginBottom: 10,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const step = style({ padding: 14, fontSize: 12, lineHeight: "18px", boxShadow: "none" });
export const number = style({
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  marginBottom: 10,
  borderRadius: "50%",
  color: tokens["color/byul-ink"],
  background: tokens["color/icon-tile"],
});
export const connections = style({ padding: 0, boxShadow: "none", overflow: "hidden" });
export const title = style({ display: "inline-flex", alignItems: "center", gap: 10 });
export const status = style({
  borderRadius: tokens["radius/radius-pill"],
  border: `1px solid ${tokens["color/card-border"]}`,
  padding: "2px 8px",
  color: tokens["color/cat-focus"],
  fontSize: 12,
  whiteSpace: "nowrap",
});
export const relatedButton = style({
  display: "block",
  width: "100%",
  padding: 0,
  background: "transparent",
  border: 0,
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
});
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/ink-3"],
});
