import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const editor = style({
  display: "block",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  width: "100%",
  resize: "none",
  border: 0,
  borderRadius: 0,
  padding: tokens["spacing/space-12"],
  color: "inherit",
  background: "transparent",
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
  lineHeight: 1.55,
  overflowY: "auto",
  overflowWrap: "anywhere",
  ":focus": { outline: "none" },
  ":focus-visible": { boxShadow: `inset 0 0 0 1px ${tokens["color/focus-ring"]}` },
  "::placeholder": { color: tokens["color/ink-2"] },
});
export const footer = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  width: "100%",
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const footerRow = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
});
globalStyle(`${footerRow} > button`, { marginLeft: "auto" });
export const fontControls = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
});
export const failure = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  padding: tokens["spacing/space-12"],
  overflowWrap: "anywhere",
  maxHeight: "40dvh",
  overflowY: "auto",
});
