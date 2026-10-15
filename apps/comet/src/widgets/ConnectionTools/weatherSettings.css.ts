import { style, globalStyle } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const settings = style({ display: "grid", gap: 20, minWidth: 0 });
export const results = style({
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
  gap: 10,
});
export const result = style({
  display: "grid",
  alignContent: "space-between",
  gap: 12,
  padding: 14,
  borderRadius: 16,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
});
export const current = style({
  borderColor: tokens["color/selected-border"],
  background: tokens["color/component/selected-icon-alpha-140"],
});
export const form = style({ display: "flex", alignItems: "end", gap: 10 });
globalStyle(`${form} > div`, { flex: 1, minWidth: 0 });
