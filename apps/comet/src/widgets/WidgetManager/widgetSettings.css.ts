import { globalStyle, style } from "@vanilla-extract/css";
export const settings = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
});
export const body = style({ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 });
globalStyle(`${body} > *`, { flexShrink: 0 });
export const primary = style({ display: "grid", minWidth: 0, gap: 20 });
export const fields = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
