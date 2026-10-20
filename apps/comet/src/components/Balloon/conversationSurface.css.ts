import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const inputHost = style([
  {
    width: 344,
    maxHeight: 520,
    overflowY: "auto",
    color: tokens["color/ink"],
    fontFamily: tokens["typography/sans/body/fontFamily"],
  },
]);
export const inputContents = style({ width: "100%" });
export const inputCapsule = style({ margin: 0 });
export const inputActions = style({
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  paddingTop: 4,
  marginBottom: 12,
});
export const inputAction = style({
  height: 32,
  padding: "0 13px 0 10px",
  borderRadius: 16,
  borderColor: tokens["color/chip-border"],
  background: tokens["color/chip"],
  fontSize: 13,
  fontWeight: 400,
  lineHeight: "normal",
});
export const resumeAction = style({ width: 106 });
export const togetherAction = style({ width: 132, height: 34 });
export const historyAction = style({ width: 94 });
export const inputError = style({
  boxSizing: "border-box",
  margin: "8px 0 0",
  padding: "8px 19px",
  border: `1px solid ${tokens["color/danger-border"]}`,
  borderRadius: tokens["radius/radius-12"],
  // Window colors follow the skin but not the balloon-opacity slider.
  background: tokens["color/glass-window"],
  color: tokens["color/ink"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  overflowWrap: "anywhere",
});
export const responseHost = style([
  {
    boxSizing: "border-box",
    width: 340,
    paddingBottom: 16,
    color: tokens["color/ink"],
  },
]);
export const responseBubble = style({ width: "100%", minHeight: 78 });
export const responseTail = style({ width: 15, height: 15, left: 39.5, bottom: -12.1 });
export const responseText = style({
  maxHeight: 360,
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: 1.5,
});
export const responseSource = style({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
});
