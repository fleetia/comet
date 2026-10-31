import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import * as shared from "./common.css";


export const documentRoot = style({
  minHeight: "100%",
  colorScheme: "light",
  selectors: { '&[data-comet-theme="dark"]': { colorScheme: "dark" } },
  color: tokens["color/ink"],
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: tokens["typography/sans/body/lineHeight"],
});
export const root = style({ minHeight: "100dvh" });

// Hide scrollbar chrome without changing wheel, touch, or keyboard scrolling.
globalStyle(`${documentRoot}, ${documentRoot} *`, { scrollbarWidth: "none" });
globalStyle(`${documentRoot}::-webkit-scrollbar, ${documentRoot} *::-webkit-scrollbar`, {
  display: "none",
});

// Focus and scrollIntoView stop short of the edge so 2px focus rings drawn outside stay visible.
// Text fields keep caret scrolling flush; a one-row field has no room for the padding.
globalStyle(`${documentRoot}, ${documentRoot} :not(textarea, input)`, { scrollPadding: 6 });

globalStyle(`${documentRoot} body`, { WebkitFontSmoothing: "antialiased" });
globalStyle(`${documentRoot} body, ${documentRoot} #root`, {
  margin: 0,
  minHeight: "100%",
  width: "100%",
});
globalStyle(`${root}, ${root} *, ${root} *::before, ${root} *::after`, {
  boxSizing: "border-box",
});
globalStyle(`${root} :where(h1, h2, h3, p)`, { margin: 0 });
globalStyle(`${root} [hidden]`, { display: "none" });
globalStyle(`${root} [role="tabpanel"]:focus`, { outline: "none" });
globalStyle(`${root} summary`, { cursor: "pointer" });
globalStyle(`${root} summary:focus-visible`, {
  outline: `1px solid ${tokens["color/focus-ring"]}`,
  outlineOffset: 2,
});
globalStyle(`${root} ${shared.settings}`, {
  maxWidth: 760,
  padding: `${tokens["spacing/space-26"]} ${tokens["spacing/space-26"]} ${tokens["spacing/space-16"]}`,
  display: "flex",
  flexDirection: "column",
  "@media": { "(max-width: 480px)": { padding: tokens["spacing/space-16"] } },
});
globalStyle(`${root} ${shared.settingsTitle}`, {
  color: tokens["color/primary"],
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontWeight: tokens["typography/display/page/fontWeight"],
  lineHeight: "1.25",
  margin: `0 0 ${tokens["spacing/space-8"]}`,
});
globalStyle(`${root} ${shared.sectionTitle}`, {
  color: tokens["color/primary"],
  fontFamily: `${tokens["typography/display/title/fontFamily"]}, sans-serif`,
  fontWeight: tokens["typography/display/title-sm/fontWeight"],
  lineHeight: "1.385",
  fontSize: tokens["typography/display/title-sm/fontSize"],
  marginBottom: tokens["spacing/space-16"],
});
globalStyle(`${root} ${shared.field}`, {
  gap: tokens["spacing/space-4"],
  marginBottom: tokens["spacing/space-12"],
});
globalStyle(`${root} ${shared.row}`, {
  gap: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-8"]} 0`,
});
globalStyle(`${root} ${shared.section}`, {
  marginTop: tokens["spacing/space-16"],
  paddingTop: tokens["spacing/space-16"],
});
globalStyle(`${root} ${shared.choice}`, {
  flex: "0 1 auto",
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
});

export const tabs = style({ flex: 1 });
export const tabList = style({ flexWrap: "wrap" });
export const tabPanel = style({ padding: `${tokens["spacing/space-16"]} 0`, minWidth: 0 });
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const info = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  marginBottom: tokens["spacing/space-16"],
});
export const modeChoices = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-16"],
  marginBottom: tokens["spacing/space-12"],
});
export const data = style({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: tokens["typography/sans/caption/fontSize"],
  fontVariantNumeric: "tabular-nums slashed-zero",
});
export const saveBar = style({
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  display: "grid",
  gap: tokens["spacing/space-8"],
  marginTop: tokens["spacing/space-16"],
  paddingBottom: tokens["spacing/space-8"],
  background: tokens["color/sky"],
});
export const saveStatus = style({
  flex: "1 1 180px",
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});
export const disclosure = style({
  marginTop: tokens["spacing/space-26"],
  paddingTop: tokens["spacing/space-12"],
  borderTop: `1px dotted ${tokens["color/line"]}`,
});
export const disclosureSummary = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/body/fontSize"],
  padding: `${tokens["spacing/space-6"]} 0`,
});
