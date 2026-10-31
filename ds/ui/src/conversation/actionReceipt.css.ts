import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const receipt = style({
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  width: "100%",
  minWidth: 0,
  padding: tokens["spacing/space-12"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
});

export const title = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});

export const detail = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "18px",
  overflowWrap: "anywhere",
});

export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
});
