import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

const font = `${tokens["typography/sans/body/fontFamily"]}, sans-serif`;
const lineHeight = "1.385";

export const formField = style({ display: "grid", minWidth: 0, gap: tokens["spacing/space-4"] });
export const label = style({
  color: tokens["color/ink-2"],
  fontFamily: font,
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 400,
  lineHeight,
  letterSpacing: "0.045em",
});
// Labels of nested choices (a checkbox inside the field) share the quiet field label tone.
globalStyle(`${formField} label`, { color: tokens["color/ink-2"], fontWeight: 400 });
export const required = style({
  color: tokens["color/danger"],
  marginInlineStart: tokens["spacing/space-6"],
});
export const feedback = style({
  margin: 0,
  fontFamily: font,
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight,
});
export const description = style({ color: tokens["color/ink-2"] });
export const error = style({ color: tokens["color/danger"], fontWeight: 650 });
