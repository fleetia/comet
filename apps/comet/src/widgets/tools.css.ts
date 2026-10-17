import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import * as common from "../common.css";
export const host = style({
  maxWidth: 760,
  margin: "0 auto",
  overflowWrap: "anywhere",
});
export const focusHost = style([host, { maxWidth: "none" }]);
export const focusHeaderActions = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const status = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
export const empty = style({ display: "grid", gap: tokens["spacing/space-12"], padding: `${tokens["spacing/space-16"]} 0` });
export const previewNote = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  marginBottom: tokens["spacing/space-12"],
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
});
export const musicContent = style({
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const musicBody = style([
  body,
  { flex: 1, minHeight: 0, "@media": { "(max-height: 440px)": { flex: "none" } } },
]);
export const focusContent = style({
  display: "flex",
  flexDirection: "column",
  padding: 0,
  overflow: "hidden",
});
export const focusBody = style([body, { flex: 1, minHeight: 0 }]);
globalStyle(`${focusHost} ${focusContent}`, { padding: 0 });
export const row = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
  alignItems: "center",
});
export const item = style({
  padding: `${tokens["spacing/space-8"]} 0`,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-6"],
  overflowWrap: "anywhere",
});
export const number = style({
  textAlign: "center",
  fontSize: "clamp(32px, 10vw, 44px)",
  fontFamily: '"IBM Plex Mono", monospace',
  fontVariantNumeric: "tabular-nums",
  lineHeight: "1.25",
  padding: `${tokens["spacing/space-16"]} 0 ${tokens["spacing/space-6"]}`,
  color: tokens["color/primary"],
});
export const area = style({
  position: "relative",
  height: "clamp(140px, 40dvh, 230px)",
  background: tokens["color/card-2"],
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  overflow: "hidden",
  touchAction: "none",
});
export const token = style({
  position: "absolute",
  transform: "translate(-50%,-50%)",
  fontSize: 28,
  lineHeight: 1,
  background: "transparent",
  border: 0,
  padding: tokens["spacing/space-6"],
  transition: "left 500ms linear, top 500ms linear",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': {
      background: tokens["color/selected"],
      color: tokens["color/selected-ink"],
    },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: tokens["color/selected-ink"],
      outlineOffset: -2,
    },
  },
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const bubble = style([
  token,
  {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: `1px solid ${tokens["color/primary"]}`,
    background: tokens["color/glass-panel"],
    padding: 0,
  },
]);
export const prose = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: "1.462",
});

export const jarSummary = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  padding: tokens["spacing/space-16"],
  textAlign: "center",
  background: tokens["color/glass-panel"],
  borderRadius: tokens["radius/radius-9"],
});
export const jarCount = style([number, { padding: 0 }]);
export const marbles = style({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minHeight: tokens["size/control-36"],
});
export const marble = style({
  width: tokens["spacing/space-16"],
  height: tokens["spacing/space-16"],
  borderRadius: "50%",
  background: tokens["color/primary"],
});
export const completedList = style({ listStyle: "none", padding: 0, margin: 0 });

export const data = style({
  fontFamily: '"IBM Plex Mono", monospace',
  fontVariantNumeric: "tabular-nums slashed-zero",
});
export const section = style({ display: "grid", gap: tokens["spacing/space-12"] });
export const sectionTitle = style({
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  color: tokens["color/primary"],
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "1.385",
});
export const composer = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  padding: 0,
});
export const actions = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  alignItems: "flex-end",
  flexWrap: "wrap",
});
export const filters = style({
  display: "flex",
  gap: tokens["spacing/space-6"],
  flexWrap: "wrap",
});
export const filterButton = style({
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]}`,
  selectors: {
    '&[aria-pressed="true"]': {
      color: tokens["color/selected-ink"],
      background: tokens["color/selected"],
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      color: tokens["color/selected-ink"],
      background: tokens["color/selected"],
    },
    '&[aria-pressed="true"]:focus-visible': {
      outlineColor: tokens["color/selected-ink"],
      outlineOffset: -3,
    },
  },
});
export const disclosure = style({
  paddingTop: tokens["spacing/space-8"],
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const optionSummary = style({
  display: "block",
  marginTop: tokens["spacing/space-6"],
  color: tokens["color/primary"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
globalStyle(`${host} h2`, {
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/display/title-sm/fontSize"],
  color: tokens["color/primary"],
  lineHeight: "1.385",
});
globalStyle(`${host} summary`, {
  padding: `${tokens["spacing/space-8"]} 0`,
  fontSize: tokens["typography/sans/body/fontSize"],
  color: tokens["color/ink-2"],
});
globalStyle(`${host} button`, { maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" });
globalStyle(`${body} > button`, { alignSelf: "flex-start" });
globalStyle(`${host} input, ${host} select, ${host} textarea`, { minWidth: 0 });
globalStyle(`${actions} > ${common.field}`, { flex: "1 1 140px", marginBottom: 0 });

export const regionSearch = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 132px",
  gap: tokens["spacing/space-12"],
  alignItems: "end",
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr) 96px" } },
});

export const regionResult = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 144px",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  minHeight: 40,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr) 96px" } },
});

export const weatherHeading = style({ display: "grid", gap: tokens["spacing/space-6"] });
export const weatherStatus = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: 48,
  paddingTop: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "1fr", gap: tokens["spacing/space-6"] } },
});
export const weatherResults = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  padding: tokens["spacing/space-12"],
  minHeight: 0,
  maxHeight: 224,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const observation = style({ display: "grid", gap: tokens["spacing/space-12"], minWidth: 0 });
export const weatherReadings = style({
  display: "grid",
  gridTemplateColumns: "216fr 256fr 264fr",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: 72,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "1fr 1fr", gap: tokens["spacing/space-12"] } },
});
export const weatherTemperature = style({
  fontSize: tokens["typography/display/page/fontSize"],
  fontWeight: 700,
  lineHeight: "1.25",
});
export const observationSource = style({
  paddingTop: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
});
