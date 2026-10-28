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
  // These controls sit directly on a transparent desktop window, not a panel.
  // Keep the backing opaque even when a disabled foreground is muted.
  selectors: {
    "&&": {
      background: tokens["color/glass-window"],
    },
    "&&:disabled": {
      opacity: 1,
      color: `color-mix(in srgb, ${tokens["color/ink"]} 45%, ${tokens["color/glass-window"]})`,
    },
    "&&:hover:not(:disabled)": {
      background: `linear-gradient(${tokens["color/chip"]}, ${tokens["color/chip"]}), ${tokens["color/glass-window"]}`,
    },
    "&&:active:not(:disabled)": {
      background: `linear-gradient(${tokens["color/track"]}, ${tokens["color/track"]}), ${tokens["color/glass-window"]}`,
    },
  },
});
export const resumeAction = style({ width: 106 });
export const togetherAction = style({ width: 132, height: 34 });
export const historyAction = style({ width: 94 });
export const inputError = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
  margin: 0,
  padding: "8px 20px 0",
  color: tokens["color/danger"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  overflowWrap: "anywhere",
});
export const inputErrorMessage = style({ margin: 0 });
export const responseHost = style([
  {
    boxSizing: "border-box",
    width: 340,
    maxHeight: "min(520px, 100dvh)",
    overflowY: "auto",
    paddingBottom: 16,
    color: tokens["color/ink"],
  },
]);
export const responseBubble = style({ width: "100%", minHeight: 78 });
export const responseTail = style({
  width: 15,
  height: 15,
  left: "calc(var(--comet-response-tail-x, 47px) - 7.5px)",
  bottom: -12.1,
});
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
