import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingTop: 4 });
export const heading = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  color: tokens["color/ink-2"],
  fontWeight: 400,
  lineHeight: "18px",
});
export const steps = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 10,
  marginBottom: 12,
});
export const step = style({ padding: 14, fontSize: 13.5, lineHeight: "18px", boxShadow: "none", border: 0, outline: `1px solid ${tokens["color/card-border"]}`, outlineOffset: -1 });
export const number = style({
  display: "grid",
  placeItems: "center",
  width: 26,
  height: 26,
  marginBottom: 10,
  borderRadius: "50%",
  color: tokens["color/byul-ink"],
  background: tokens["color/icon-tile"],
});
export const connections = style({ border: 0, outline: `1px solid ${tokens["color/card-border"]}`, outlineOffset: -1, padding: 0, boxShadow: "none", overflow: "hidden" });
export const connection = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 14px",
  minHeight: 56,
  boxSizing: "border-box",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const summary = style({
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 0,
  background: "transparent",
});
export const icon = style({
  display: "grid",
  placeItems: "center",
  width: 32,
  height: 32,
  borderRadius: 16,
  flexShrink: 0,
  background: tokens["color/icon-tile"],
});
export const status = style({
  borderRadius: tokens["radius/radius-pill"],
  border: `1px solid ${tokens["color/card-border"]}`,
  padding: "2px 8px",
  color: tokens["color/ink-3"],
  selectors: {
    '&[data-enabled="true"]': {
      color: tokens["color/cat-focus"],
      background: tokens["color/document/live-chip-background"],
      borderColor: tokens["color/document/live-chip-border"],
    },
  },
  fontSize: 12,
  whiteSpace: "nowrap",
});
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/ink-3"],
});

export const error = style([caption, { color: tokens["color/danger"] }]);

globalStyle(`${step} p`, { margin: 0 });
globalStyle(`${root} > ${caption}`, { marginBottom: 12 });
globalStyle(`${connections} > div`, { minHeight: 56 });

