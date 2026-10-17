import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

import * as common from "../../common.css";

export const root = style({ display: "grid", gap: tokens["spacing/space-8"], minWidth: 0 });
export const toolbar = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  alignItems: "center",
  flexWrap: "wrap",
});
export const listSelect = style({ flex: "1 1 90px", width: "auto" });
export const titleField = style({ flex: "1 1 180px", minWidth: 0 });
export const item = style({
  display: "grid",
  gap: tokens["spacing/space-4"],
  padding: tokens["spacing/space-8"],
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
});
export const itemMain = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "start",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
  minHeight: tokens["spacing/space-32"],
});
export const itemHeading = style({
  display: "flex",
  flex: "1 1 160px",
  alignItems: "start",
  gap: tokens["spacing/space-4"],
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
  gap: tokens["spacing/space-6"],
});
export const memo = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
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
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
  overflowWrap: "anywhere",
  paddingLeft: "22px",
});
export const detail = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  paddingLeft: "22px",
  selectors: { "&[hidden]": { display: "none" } },
});
export const detailDates = style({
  display: "grid",
  gridTemplateColumns: "auto minmax(0,1fr)",
  columnGap: tokens["spacing/space-8"],
  rowGap: tokens["spacing/space-4"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
  overflowWrap: "anywhere",
});
export const completionNotice = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-6"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  padding: `${tokens["spacing/space-6"]} 0`,
});
export const count = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
});

globalStyle(`${root} .${common.field}`, { gap: tokens["spacing/space-4"], marginBottom: 0 });
