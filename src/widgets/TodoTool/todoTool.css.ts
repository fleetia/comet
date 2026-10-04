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
  borderBottom: `${vars.border.width.hairline} dotted ${vars.color.border.subtle}`,
});
export const itemMain = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "start",
  justifyContent: "space-between",
  gap: vars.space.sm,
  minHeight: vars.dimension.row,
});
export const itemHeading = style({
  display: "flex",
  flex: "1 1 160px",
  alignItems: "start",
  gap: vars.space.xxs,
  minWidth: 0,
});
export const itemTitle = style({
  flex: 1,
  minWidth: 0,
  textAlign: "left",
  justifyContent: "start",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  selectors: {
    '&[data-completed="true"]': { textDecoration: "line-through" },
  },
});
export const itemActions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.xs,
});
export const memo = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const memoPreview = style([
  memo,
  {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    paddingLeft: "22px",
  },
]);
export const metadata = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  overflowWrap: "anywhere",
  paddingLeft: "22px",
});
export const detail = style({
  display: "grid",
  gap: vars.space.xs,
  paddingLeft: "22px",
  selectors: { "&[hidden]": { display: "none" } },
});
export const detailDates = style({
  display: "grid",
  gridTemplateColumns: "auto minmax(0,1fr)",
  columnGap: vars.space.sm,
  rowGap: vars.space.xxs,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  overflowWrap: "anywhere",
});
export const completionNotice = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.xs,
  fontSize: vars.typography.size.caption,
  padding: `${vars.space.xs} 0`,
});
export const count = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});

globalStyle(`${root} .${common.field}`, { gap: vars.space.xxs, marginBottom: 0 });
