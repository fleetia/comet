import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const eyebrow = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  letterSpacing: "0.15em",
  fontWeight: 600,
  color: tokens["color/ink-2"],
});
export const quiet = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
export const inline = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  whiteSpace: "nowrap",
});
globalStyle(`${inline} select`, { width: "auto" });
export const row = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-12"],
  alignItems: "center",
  margin: `${tokens["spacing/space-12"]} 0`,
});
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  fontSize: tokens["typography/sans/body/fontSize"],
  marginBottom: tokens["spacing/space-16"],
  minWidth: 0,
});
export const error = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  color: tokens["color/danger"],
  background: tokens["color/component/danger-alpha-100"],
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
  marginTop: tokens["spacing/space-8"],
  lineHeight: "1.462",
  overflowWrap: "anywhere",
  borderRadius: tokens["radius/radius-10"],
  border: `1px solid ${tokens["color/component/danger-alpha-100"]}`,
});
export const success = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  color: tokens["color/nadir-ink"],
  padding: `${tokens["spacing/space-8"]} 0`,
});
export const settings = style({
  maxWidth: 680,
  padding: `${tokens["spacing/space-40"]} ${tokens["spacing/space-26"]} calc(${tokens["spacing/space-40"]} + ${tokens["spacing/space-8"]})`,
  margin: "0 auto",
  minHeight: "100dvh",
});
export const previewSettings = style({
  borderTop: `1px solid ${tokens["color/input-border"]}`,
  minHeight: 0,
});
export const settingsTitle = style({
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/display/page/fontSize"],
  fontWeight: 500,
  letterSpacing: "-0.035em",
  marginBottom: tokens["spacing/space-8"],
});
export const section = style({
  border: 0,
  margin: `${tokens["spacing/space-40"]} 0 0`,
  padding: `${tokens["spacing/space-26"]} 0 0`,
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const sectionTitle = style({
  fontSize: tokens["typography/display/title-sm/fontSize"],
  fontWeight: 600,
  marginBottom: tokens["spacing/space-16"],
});
export const tabs = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-26"]} 0 ${tokens["spacing/space-16"]}`,
});
export const choice = style({
  display: "block",
  flex: 1,
  minWidth: 0,
  padding: `${tokens["spacing/space-12"]} ${tokens["spacing/space-16"]}`,
  textAlign: "left",
  whiteSpace: "normal",
  selectors: {
    '&[aria-pressed="true"]': {
      borderColor: tokens["color/selected-border"],
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: tokens["color/primary"],
      color: tokens["color/on-primary"],
    },
  },
});
export const memory = style({
  padding: tokens["spacing/space-12"],
  marginBlock: tokens["spacing/space-6"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/card"],
});
export const progress = style({
  width: "100%",
  accentColor: tokens["color/nadir-ink"],
  height: 7,
  borderRadius: 7,
  overflow: "hidden",
});
export const emptyHint = style({
  marginTop: tokens["spacing/space-12"],
  fontSize: tokens["typography/sans/body/fontSize"],
  color: tokens["color/ink-2"],
  lineHeight: "1.462",
});
export const loadingHeader = style({
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  padding: tokens["spacing/space-8"],
  zIndex: 1,
  background: tokens["color/sky"],
});
export const loading = style({
  display: "grid",
  placeContent: "center",
  minHeight: "100dvh",
  gap: tokens["spacing/space-16"],
  padding: tokens["spacing/space-26"],
});
