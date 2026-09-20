import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

import * as common from "../../lagrange.css";

export const root = style({ display: "grid", gap: vars.space.xs, minWidth: 0 });
export const toolbar = style({
  display: "flex",
  gap: vars.space.sm,
  alignItems: "center",
  flexWrap: "wrap",
});
export const listSelect = style({ flex: "1 1 90px", width: "auto" });
export const titleField = style({ flex: "1 1 180px", minWidth: 0 });
export const item = style({
  display: "grid",
  gap: vars.space.xxs,
  padding: `${vars.space.xs} 0`,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
});
export const itemMain = style({
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: vars.space.sm,
  minHeight: vars.dimension.row,
});
export const memo = style({
  whiteSpace: "pre-wrap",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  paddingLeft: "22px",
});
export const count = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});

globalStyle(`${root} .${common.field}`, { gap: vars.space.xxs, marginBottom: 0 });
