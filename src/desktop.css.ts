import { createTheme, globalStyle, style } from "@vanilla-extract/css";
import { createThemeTokens, semanticVars as vars, themeVars } from "@fleetia/lagrange/theme";
import * as shared from "./lagrange.css";

export const theme = createTheme(
  themeVars,
  createThemeTokens({
    semantic: {
      typography: {
        family: {
          display: '"Iowan Old Style", "AppleMyungjo", "Noto Serif KR", Georgia, serif',
          ui: '"Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
          data: '"SFMono-Regular", Menlo, Consolas, monospace',
        },
      },
    },
  }),
);

export const documentRoot = style({ minHeight: "100%" });
export const root = style({ minHeight: "100dvh" });

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
globalStyle(`${root} summary`, { cursor: "pointer" });
globalStyle(`${root} summary:focus-visible`, {
  outline: `1px solid ${vars.color.interaction.focus}`,
  outlineOffset: 2,
});
globalStyle(`${root} ${shared.settings}`, {
  maxWidth: 760,
  padding: `${vars.space.xl} ${vars.space.xl} ${vars.space.lg}`,
  display: "flex",
  flexDirection: "column",
  "@media": { "(max-width: 480px)": { padding: vars.space.lg } },
});
globalStyle(`${root} ${shared.settingsTitle}`, {
  color: vars.color.content.accent,
  fontFamily: vars.typography.family.display,
  lineHeight: vars.typography.lineHeight.tight,
  margin: `${vars.space.xs} 0 ${vars.space.sm}`,
});
globalStyle(`${root} ${shared.sectionTitle}`, {
  color: vars.color.content.accent,
  fontFamily: vars.typography.family.display,
  lineHeight: vars.typography.lineHeight.compact,
  marginBottom: vars.space.md,
});
globalStyle(`${root} ${shared.field}`, {
  gap: vars.space.xxs,
  marginBottom: vars.space.md,
});
globalStyle(`${root} ${shared.row}`, {
  gap: vars.space.sm,
  margin: `${vars.space.sm} 0`,
});
globalStyle(`${root} ${shared.section}`, {
  marginTop: vars.space.xl,
  paddingTop: vars.space.lg,
});
globalStyle(`${root} ${shared.choice}`, {
  flex: "0 1 auto",
  padding: `${vars.space.sm} ${vars.space.md}`,
  borderWidth: "0 0 1px",
});

export const pageHeader = style({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: vars.space.lg,
  marginBottom: vars.space.xl,
});
export const tabs = style({ flex: 1 });
export const tabList = style({ flexWrap: "wrap" });
export const tabPanel = style({ padding: `${vars.space.lg} 0`, minWidth: 0 });
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const info = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  marginBottom: vars.space.lg,
});
export const subsettings = style({
  margin: `${vars.space.md} 0 0 ${vars.space.lg}`,
  paddingLeft: vars.space.md,
  borderLeft: `1px dotted ${vars.color.border.subtle}`,
});
export const modeChoices = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.sm,
  marginBottom: vars.space.lg,
});
export const data = style({
  fontFamily: vars.typography.family.data,
  fontSize: vars.typography.size.data,
  fontVariantNumeric: "tabular-nums slashed-zero",
});
export const shortInput = style({ width: 80 });
export const saveBar = style({
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  display: "grid",
  gap: vars.space.sm,
  marginTop: vars.space.lg,
  paddingBottom: vars.space.sm,
  background: vars.color.surface.canvas,
});
export const saveActions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.sm,
  paddingTop: vars.space.xs,
});
export const saveStatus = style({
  flex: "1 1 180px",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});
export const disclosure = style({
  marginTop: vars.space.xl,
  paddingTop: vars.space.md,
  borderTop: `1px dotted ${vars.color.border.subtle}`,
});
export const disclosureSummary = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
  padding: `${vars.space.xs} 0`,
});
