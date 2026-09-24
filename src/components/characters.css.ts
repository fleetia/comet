import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const page = style({
  padding: vars.space.lg,
  background: vars.color.surface.canvas,
  minHeight: "100dvh",
});
export const embedded = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  height: "100%",
  minHeight: 0,
});
export const header = style({ marginBottom: vars.space.md });
export const layout = style({
  display: "grid",
  flex: 1,
  minHeight: 0,
  gridTemplateColumns: "168px minmax(0,1fr)",
  alignItems: "start",
  gap: vars.space.lg,
  "@media": {
    "(max-width: 680px)": { gridTemplateColumns: "140px minmax(0,1fr)", gap: vars.space.sm },
  },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  alignSelf: "stretch",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
});
export const libraryHeading = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: vars.space.xs,
  borderBottom: `1px solid ${vars.color.border.strong}`,
  paddingBottom: vars.space.xs,
});
export const characterList = style({ display: "flex", flexDirection: "column" });
export const item = style({
  width: "100%",
  justifyContent: "space-between",
  gap: vars.space.xs,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  minHeight: vars.dimension.control,
  textAlign: "left",
  whiteSpace: "normal",
  border: 0,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  borderInlineStart: "2px solid transparent",
  selectors: {
    '&[aria-pressed="true"]': {
      background: vars.color.selection.surface,
      color: vars.color.content.accent,
      borderInlineStartColor: vars.color.selection.indicator,
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': { background: vars.color.selection.surface },
  },
});
export const itemName = style({ overflowWrap: "anywhere", minWidth: 0 });
export const small = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  margin: 0,
  overflowWrap: "anywhere",
});
export const roster = style({
  display: "grid",
  gap: vars.space.xs,
  padding: `${vars.space.sm} 0 ${vars.space.md}`,
});
export const libraryActions = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.sm,
  margin: `${vars.space.sm} 0`,
});
export const detail = style({
  display: "flex",
  flexDirection: "column",
  alignSelf: "stretch",
  minWidth: 0,
  minHeight: 0,
  paddingLeft: vars.space.lg,
  borderLeft: `1px solid ${vars.color.border.subtle}`,
  "@media": { "(max-width: 680px)": { paddingLeft: vars.space.sm } },
});
export const editor = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});
export const editorHeader = style({
  flexShrink: 0,
  background: vars.color.surface.canvas,
});
export const editorPanel = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  scrollbarGutter: "stable",
  paddingTop: vars.space.md,
});
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const section = style({
  margin: `${vars.space.md} 0 0`,
  paddingTop: vars.space.sm,
  borderTop: `1px solid ${vars.color.border.strong}`,
});
export const sectionHeader = style({
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: vars.space.sm,
});
export const subheading = style({
  color: vars.color.content.accent,
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  margin: `0 0 ${vars.space.sm}`,
});
export const characterFace = style({
  width: 32,
  height: 32,
  display: "grid",
  placeItems: "center",
  fontSize: vars.typography.size.body,
  whiteSpace: "nowrap",
  color: vars.color.content.accent,
});
export const characterPortrait = style({
  width: "100%",
  height: "100%",
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const basicFields = style({
  display: "grid",
  gridTemplateColumns: "minmax(170px,0.8fr) minmax(0,1.4fr)",
  gap: `${vars.space.xs} ${vars.space.lg}`,
  "@media": { "(max-width: 850px)": { gridTemplateColumns: "1fr" } },
});
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "68px minmax(0,1fr)",
  alignItems: "baseline",
  columnGap: vars.space.sm,
  minWidth: 0,
});
export const personalityInput = style({
  minHeight: vars.dimension.control,
  height: vars.dimension.control,
});
export const expressionAdd = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: vars.space.sm,
  alignItems: "center",
  marginTop: vars.space.xs,
});
export const personalityField = style([inlineField, { gridColumn: "1 / -1" }]);
export const relationshipRow = style({
  display: "grid",
  gap: vars.space.xs,
  margin: `${vars.space.sm} 0`,
});
export const relationshipControls = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: vars.space.sm,
});
export const appearanceLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) minmax(160px,1fr)",
  gap: vars.space.lg,
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const appearanceSettings = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  minWidth: 0,
});
export const appearanceCheckbox = style({
  width: "100%",
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
});
export const expressionHead = style({
  display: "grid",
  gridTemplateColumns: "70px minmax(60px,1fr) minmax(105px,1.2fr) 24px",
  alignItems: "center",
  gap: vars.space.sm,
  borderBottom: `1px solid ${vars.color.border.strong}`,
  minHeight: vars.dimension.control,
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});
export const expressionRow = style({
  display: "grid",
  gridTemplateColumns: "70px minmax(60px,1fr) minmax(105px,1.2fr) 24px",
  alignItems: "center",
  gap: vars.space.sm,
  minHeight: vars.dimension.control,
  padding: 0,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  fontSize: vars.typography.size.label,
});
export const spriteFrame = style({
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  overflow: "hidden",
});
export const spriteImage = style({
  width: "100%",
  height: "100%",
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const spriteActions = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.xxs,
  minWidth: 0,
});
export const balloonSetting = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.xs,
});
export const balloonColorInput = style({
  width: 48,
  padding: vars.space.xxs,
});
export const balloonTextPreview = style({
  margin: 0,
  padding: vars.space.sm,
  border: `1px solid ${vars.color.border.subtle}`,
  lineHeight: 1.6,
  overflowWrap: "anywhere",
});
export const compactActions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.sm,
  marginTop: vars.space.xs,
});
export const dialogueRow = style({
  display: "grid",
  gridTemplateColumns: "78px minmax(0,1fr) auto",
  alignItems: "center",
  gap: vars.space.sm,
  minHeight: 30,
  padding: 0,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  fontSize: vars.typography.size.label,
});
export const lineSummary = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: vars.color.content.secondary,
});
export const lineEditor = style({ padding: `${vars.space.sm} 0 ${vars.space.md}`, minWidth: 0 });
export const line = style({ paddingBottom: vars.space.sm });
export const textarea = style({ minHeight: `calc(${vars.dimension.control} * 2)` });
export const dialogueScope = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
  margin: `${vars.space.sm} 0`,
});
export const scopeField = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const saveBar = style({
  flexShrink: 0,
  background: vars.color.surface.canvas,
  borderTop: `3px double ${vars.color.border.strong}`,
  padding: `${vars.space.xs} 0`,
  marginTop: vars.space.md,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
  flexWrap: "wrap",
});
export const attributionSummary = style({
  flexShrink: 0,
  display: "grid",
  gridTemplateColumns: "64px minmax(0,1fr) auto",
  alignItems: "center",
  columnGap: vars.space.sm,
  rowGap: vars.space.xs,
  marginTop: vars.space.sm,
  fontSize: vars.typography.size.label,
});
export const packSelector = style({ padding: vars.space.sm });
export const packControls = style({ marginTop: vars.space.sm });
export const packField = style({ flex: "1 1 180px", minWidth: 0 });
export const packHint = style({ display: "block", marginTop: vars.space.xs });
export const preview = style({
  padding: `${vars.space.sm} 0`,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const notice = style({
  margin: `${vars.space.sm} 0`,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
export const disclosureSummary = style({
  padding: `${vars.space.xs} 0`,
  color: vars.color.content.accent,
  fontSize: vars.typography.size.label,
  cursor: "pointer",
});

globalStyle(`${saveBar}[hidden]`, { display: "none" });
