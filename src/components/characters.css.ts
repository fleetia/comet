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
  gridTemplateColumns: "224px minmax(0,1fr)",
  alignItems: "stretch",
  gap: vars.space.lg,
  "@media": {
    "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)", gap: vars.space.lg },
    "(max-width: 850px)": { gridTemplateColumns: "160px minmax(0,1fr)", gap: vars.space.md },
  },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  alignSelf: "stretch",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
});
export const rosterBody = style({
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  padding: vars.space.md,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
});
export const libraryHeading = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: vars.space.xs,
  paddingBottom: 0,
});
export const characterList = style({ display: "flex", flexDirection: "column" });
export const item = style({
  display: "grid",
  gridTemplateColumns: "36px minmax(0,1fr)",
  alignItems: "center",
  gap: vars.space.md,
  minHeight: 64,
});
export const itemDetail = style({
  display: "grid",
  gap: vars.space.xs,
  textAlign: "left",
  minWidth: 0,
});
export const itemStatus = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.compact,
  color: vars.color.content.secondary,
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
  flexDirection: "column",
  gap: vars.space.sm,
  margin: `${vars.space.sm} 0`,
});
export const detail = style({
  display: "flex",
  flexDirection: "column",
  alignSelf: "stretch",
  minWidth: 0,
  minHeight: 0,
  paddingLeft: 0,
  borderLeft: 0,
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
  display: "grid",
  gap: vars.space.md,
  paddingBottom: vars.space.md,
});
export const editorPanel = style({
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  padding: 0,
});
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const section = style({
  margin: `${vars.space.md} 0 0`,
  paddingTop: vars.space.sm,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
});
export const sectionHeader = style({
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: vars.space.md,
});
export const subheading = style({
  color: vars.color.content.primary,
  fontFamily: vars.typography.family.ui,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
  margin: `0 0 ${vars.space.sm}`,
});
export const characterFace = style({
  width: 40,
  height: 40,
  flexShrink: 0,
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
  alignItems: "start",
  gridTemplateColumns: "minmax(160px,0.6fr) minmax(0,1.6fr)",
  gap: vars.space.lg,
  minWidth: 0,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "1fr" } },
});
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "1fr",
  alignItems: "baseline",
  gap: vars.space.sm,
  minWidth: 0,
});
export const personalityInput = style({
  minHeight: 96,
  height: 96,
});
export const expressionAdd = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: vars.space.sm,
  alignItems: "center",
  marginTop: vars.space.xs,
});
globalStyle(`${expressionAdd}[hidden]`, { display: "none" });
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
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.strong}`,
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
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
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
  border: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
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
  borderBottom: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
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
export const textarea = style({ minHeight: 96 });
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
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  padding: `${vars.space.xs} 0`,
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

export const sourceHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.md,
  minHeight: vars.dimension.control,
  flexWrap: "wrap",
});
export const sourceDetail = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: vars.dimension.control,
  marginBlock: vars.space.sm,
  overflowWrap: "anywhere",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "64px minmax(0,1fr)" } },
});
export const ownerContent = style({
  height: "100%",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
});
globalStyle(`${ownerContent}[hidden]`, { display: "none" });
export const packPicker = style({ width: "100%", justifyContent: "space-between", flexShrink: 0 });

export const rosterOrder = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: vars.space.sm,
});
globalStyle(`${libraryActions} > button`, { width: "100%" });
