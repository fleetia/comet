import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const label = style({ margin: 0, fontSize: 13, color: tokens["color/ink-2"] });
export const titleNote = style({
  marginLeft: 6,
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 12,
  color: tokens["color/ink-3"],
});
export const skinGrid = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
  "@media": { "(max-width: 1050px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
});
export const tile = style({ width: "100%" });
export const pair = style({ display: "flex", gap: 4, width: "100%" });
export const customFields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
});
export const warning = style({ margin: 0, fontSize: 12.5, color: tokens["color/danger"] });
export const opacityRow = style({
  display: "grid",
  gridTemplateColumns: "72px minmax(0, 1fr) 56px",
  alignItems: "center",
  gap: 14,
  minHeight: 56,
  padding: "11px 16px",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
globalStyle(`${opacityRow} > span:nth-child(2), ${opacityRow} input`, { width: "100%" });
export const opacityValue = style({
  fontSize: 13,
  textAlign: "right",
  color: tokens["color/ink-2"],
  fontVariantNumeric: "tabular-nums",
});
export const friendList = style({
  display: "grid",
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 9,
  background: tokens["color/card"],
});
export const friend = style({
  width: "100%",
  minHeight: 56,
  padding: "11px 16px",
  border: "none",
  borderRadius: 0,
  background: "transparent",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
// The list clips its rows, so each row draws its focus ring inside.
globalStyle(`${friendList} > ${friend}:focus-visible`, { outlineOffset: -2 });
