import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const root = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
  color: tokens["color/ink"],
});
export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 36,
});
export const title = style({
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
export const workspace = style({
  display: "grid",
  gridTemplateColumns: "280px minmax(0,1fr)",
  gap: 18,
  alignItems: "start",
  minWidth: 0,
  selectors: { '&[data-single="true"]': { gridTemplateColumns: "minmax(0,1fr)" } },
  "@media": { "(max-width: 760px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 12,
  minWidth: 0,
  borderRadius: 9,
  background: tokens["color/card-2"],
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
});
export const actions = style({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
export const row = actions;
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const error = style([caption, { color: tokens["color/danger"] }]);
export const disclosure = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  fontSize: 13,
  lineHeight: "18px",
});
export const empty = style({ padding: 22, borderRadius: 9, background: tokens["color/card-2"] });
export const detailDialog = style({
  width: "min(980px, calc(100vw - 48px))",
  maxWidth: "calc(100vw - 48px)",
});
