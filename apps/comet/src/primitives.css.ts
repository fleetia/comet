import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokenNames, tokens } from "@comet/token";

const uiFont = `${tokens["typography/sans/body/fontFamily"]}, sans-serif`;
const displayFont = `${tokens["typography/display/title/fontFamily"]}, sans-serif`;
const dataFont = '"IBM Plex Mono", monospace';
const lineHeight = { tight: "1.25", compact: "1.385", body: "1.462" };

export const space = styleVariants({
  none: { gap: 0 },
  xxs: { gap: tokens["spacing/space-4"] },
  xs: { gap: tokens["spacing/space-6"] },
  sm: { gap: tokens["spacing/space-8"] },
  md: { gap: tokens["spacing/space-12"] },
  lg: { gap: tokens["spacing/space-16"] },
  xl: { gap: tokens["spacing/space-26"] },
  xxl: { gap: tokens["spacing/space-40"] },
});

export const inline = style({ display: "flex", minWidth: 0, flexDirection: "row" });
export const align = styleVariants({
  start: { alignItems: "flex-start" },
  center: { alignItems: "center" },
  end: { alignItems: "flex-end" },
  stretch: { alignItems: "stretch" },
  baseline: { alignItems: "baseline" },
});
export const justify = styleVariants({
  start: { justifyContent: "flex-start" },
  center: { justifyContent: "center" },
  end: { justifyContent: "flex-end" },
  between: { justifyContent: "space-between" },
});
export const wrap = styleVariants({ true: { flexWrap: "wrap" }, false: { flexWrap: "nowrap" } });

export const text = style({ margin: 0, color: tokens["color/ink"] });
export const textVariant = styleVariants({
  body: {
    fontFamily: uiFont,
    fontSize: tokens["typography/sans/body/fontSize"],
    lineHeight: lineHeight.body,
  },
  label: {
    fontFamily: uiFont,
    fontSize: tokens["typography/sans/body/fontSize"],
    fontWeight: 650,
    lineHeight: lineHeight.compact,
    letterSpacing: "0.045em",
  },
  caption: {
    fontFamily: uiFont,
    fontSize: tokens["typography/sans/caption/fontSize"],
    lineHeight: lineHeight.compact,
  },
});
export const tone = styleVariants({
  default: { color: tokens["color/ink"] },
  muted: { color: tokens["color/ink-2"] },
  accent: { color: tokens["color/primary"] },
  positive: { color: tokens["color/nadir-ink"] },
  critical: { color: tokens["color/danger"] },
});

export const heading = style({ margin: 0, textWrap: "balance" });
export const headingVariant = styleVariants({
  section: {
    fontFamily: displayFont,
    fontSize: tokens["typography/display/page/fontSize"],
    fontWeight: 600,
    lineHeight: lineHeight.tight,
    letterSpacing: "-0.015em",
  },
  subsection: {
    fontFamily: displayFont,
    fontSize: tokens["typography/display/title-sm/fontSize"],
    fontWeight: 650,
    lineHeight: lineHeight.compact,
  },
  label: {
    fontFamily: uiFont,
    fontSize: tokens["typography/sans/body/fontSize"],
    fontWeight: 700,
    lineHeight: lineHeight.compact,
    letterSpacing: "0.075em",
    textTransform: "uppercase",
  },
});

const hairline = "1px";
export const rule = style({
  boxSizing: "border-box",
  flexShrink: 0,
  width: "100%",
  margin: 0,
  padding: 0,
  color: tokens["color/line"],
  border: 0,
});
export const ruleVariant = styleVariants({
  weak: { height: hairline, borderTop: `${hairline} dotted currentColor` },
  boundary: { height: hairline, borderTop: `${hairline} solid currentColor` },
  structural: {
    height: `calc(${hairline} * 2 + ${tokens["spacing/space-8"]})`,
    borderTop: `${hairline} solid currentColor`,
    borderBottom: `${hairline} solid currentColor`,
  },
});

export const sectionHeader = style({
  display: "grid",
  minWidth: 0,
  gap: tokens["spacing/space-8"],
});
export const sectionHeaderMain = style({
  display: "grid",
  minWidth: 0,
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "end",
  gap: tokens["spacing/space-16"],
  "@media": {
    "screen and (max-width: 40rem)": { gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" },
  },
});
export const sectionHeaderCopy = style({
  display: "grid",
  minWidth: 0,
  gap: tokens["spacing/space-4"],
});
export const sectionHeaderDescription = style({ maxWidth: "62ch" });
export const sectionHeaderAside = style({
  display: "flex",
  minWidth: 0,
  alignItems: "center",
  justifyContent: "flex-end",
  gap: tokens["spacing/space-8"],
  "@media": { "screen and (max-width: 40rem)": { justifyContent: "flex-start" } },
});

export const saveStatus = style({
  display: "grid",
  minHeight: tokens["size/control-36"],
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  padding: `${tokens["spacing/space-6"]} 0`,
  borderTop: `${hairline} dotted ${tokens["color/divider"]}`,
  borderBottom: `${hairline} dotted ${tokens["color/divider"]}`,
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: lineHeight.compact,
});
export const saveStatusAnnouncement = style({
  display: "grid",
  minWidth: 0,
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
});
export const saveStatusMarker = style({
  fontFamily: dataFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const saveStatusMessage = style({ minWidth: 0 });
export const saveStatusAction = style({ display: "flex", minWidth: 0, alignItems: "center" });
export const saveStatusTone = styleVariants({
  idle: { color: tokens["color/ink-2"] },
  saving: { color: tokens["color/primary"] },
  saved: { color: tokens["color/nadir-ink"] },
  error: { color: tokens["color/danger"] },
});

export const actionBar = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  minWidth: 0,
  minHeight: 44,
  paddingTop: 4,
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const actionBarStatus = style({
  minWidth: 0,
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const actionBarActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexShrink: 0,
});
globalStyle(`${actionBar} ${saveStatus}`, { border: 0, minHeight: 0, padding: 0 });

export const selectableListRow = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
  width: "100%",
  minHeight: 48,
  padding: "10px 12px",
  color: tokens["color/ink"],
  background: "transparent",
  border: 0,
  borderRadius: 0,
  fontFamily: uiFont,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: lineHeight.body,
  textAlign: "left",
  cursor: "pointer",
  selectors: {
    '&:hover:not(:disabled):not([data-selected="true"])': { background: tokens["color/card-2"] },
    '&[data-selected="true"]': {
      color: "#FFFFFF",
      background: "#101015",
      borderRadius: 8,
      vars: {
        [tokenNames["color/ink"]]: "#FFFFFF",
        [tokenNames["color/ink-2"]]: "#CCCCD2",
        [tokenNames["color/primary"]]: "#FFFFFF",
      },
    },
    "&:focus-visible": {
      outline: `1px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 2,
    },
    "&:disabled": { opacity: 0.55, cursor: "not-allowed" },
  },
});

export const field = style({ display: "grid", minWidth: 0, gap: tokens["spacing/space-4"] });
export const fieldLabelRow = style({
  display: "flex",
  minWidth: 0,
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
});
export const fieldLabel = style({
  color: tokens["color/primary"],
  fontFamily: uiFont,
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 700,
  lineHeight: lineHeight.compact,
  letterSpacing: "0.045em",
});
export const fieldMarker = style({
  color: tokens["color/ink-2"],
  fontFamily: dataFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  fontVariantNumeric: "tabular-nums",
  lineHeight: lineHeight.compact,
});
export const fieldRequired = style({
  color: tokens["color/danger"],
  marginInlineStart: tokens["spacing/space-6"],
});
export const fieldFeedback = style({
  margin: 0,
  fontFamily: uiFont,
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: lineHeight.compact,
});
export const fieldDescription = style({ color: tokens["color/ink-2"] });
export const fieldError = style({ color: tokens["color/danger"], fontWeight: 650 });

export const tabPanel = style({
  minWidth: 0,
  padding: tokens["spacing/space-16"],
  color: tokens["color/ink-2"],
  fontFamily: uiFont,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: lineHeight.body,
  selectors: {
    "&[hidden]": { display: "none" },
    "&:focus": { outline: "none" },
    "&:focus-visible": {
      outline: `${hairline} solid ${tokens["color/focus-ring"]}`,
      outlineOffset: "-1px",
    },
  },
});
