import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";

export const title = style({
  fontSize: vars.typography.size.headingMd,
  lineHeight: vars.typography.lineHeight.tight,
  fontWeight: 700,
  margin: 0,
  overflowWrap: "anywhere",
});
export const profileLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 880fr) minmax(0, 544fr)",
  gap: vars.space.lg,
  minHeight: 0,
  height: "100%",
  minWidth: 0,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)" } },
});
export const profileMain = style({ minWidth: 0, minHeight: 0 });
export const profileAside = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.lg,
  minWidth: 0,
  minHeight: 0,
});
export const identityPreview = style({
  display: "grid",
  gridTemplateColumns: "128px minmax(0, 1fr)",
  alignItems: "center",
  gap: vars.space.xl,
  minHeight: 200,
  flexShrink: 0,
  "@media": { "(max-width: 1280px)": { display: "none" } },
});
export const portrait = style({
  width: 128,
  height: 128,
  display: "grid",
  placeItems: "center",
  fontSize: 26,
});
export const appearanceLayout = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0, 1fr)",
  gap: vars.space.lg,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const assetList = style({
  minWidth: 0,
  minHeight: 0,
  height: "100%",
});
export const assetHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.sm,
  minHeight: vars.dimension.control,
  marginBottom: vars.space.sm,
});
export const assetRow = style({
  display: "grid",
  gap: 0,
  minWidth: 0,
  minHeight: 56,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  alignContent: "start",
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const assetMeta = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.compact,
  color: vars.color.content.secondary,
});
export const inspector = style({ minWidth: 0, minHeight: 0 });
export const previewStage = style({
  display: "grid",
  placeItems: "center",
  minHeight: 204,
  marginBlock: 0,
  gap: vars.space.sm,
});
export const expressionImage = style({
  width: 128,
  height: 128,
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
  gap: vars.space.lg,
  marginBlock: vars.space.md,
});
export const commonSettings = style({
  display: "grid",
  gap: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  paddingTop: vars.space.lg,
  marginTop: vars.space.lg,
});
export const expressionBindings = style({ marginTop: vars.space.md });
export const balloonLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,792fr) minmax(0,632fr)",
  gap: vars.space.lg,
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" } },
});
export const balloonStage = style({
  display: "grid",
  placeItems: "center",
  minHeight: 464,
  gap: vars.space.lg,
  "@media": { "(max-width: 1280px)": { minHeight: 300 } },
});
export const balloonSpecimen = style({
  display: "grid",
  gap: vars.space.md,
  width: "100%",
  maxWidth: 400,
  background: vars.color.surface.raised,
  color: vars.color.content.primary,
  padding: 20,
  borderRadius: vnextVars.radius.inset,
});
export const dialogueTypes = style({
  display: "flex",
  gap: vars.space.sm,
  flexShrink: 0,
  minHeight: 40,
  alignItems: "center",
});
export const dialogueContents = style({ minWidth: 0 });

export const instructionsInput = style({ minHeight: 192 });

export const heroHeader = style({
  display: "flex",
  gap: vars.space.md,
  alignItems: "center",
  minHeight: 56,
});
export const heroIdentity = style({ minWidth: 0 });

export const packCaption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.compact,
  margin: "3px 0 0",
  color: vars.color.content.secondary,
  overflowWrap: "anywhere",
});

export const workPanel = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
});
export const workBody = style({
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  scrollbarGutter: "stable",
  padding: vars.space.lg,
});
export const workFooter = style({
  flexShrink: 0,
  minWidth: 0,
  padding: `${vars.space.xs} ${vars.space.lg} ${vars.space.sm}`,
});
globalStyle(`${workFooter} > div`, { flexWrap: "wrap" });
export const fullHeight = style({ height: "100%", minHeight: 0, minWidth: 0 });
export const headerActions = style({
  display: "flex",
  gap: vars.space.md,
  marginLeft: "auto",
  flexShrink: 0,
});
export const navigation = style({
  height: 36,
  alignItems: "center",
  flexWrap: "nowrap",
  gap: vars.space.sm,
});
globalStyle(`${navigation} > [role="tab"]`, {
  width: 96,
  height: vars.dimension.control,
  minHeight: vars.dimension.control,
  justifyContent: "center",
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderRadius: vars.shape.radius.subtle,
});
globalStyle(
  `${navigation} > [role="tab"]:nth-child(2), ${navigation} > [role="tab"]:nth-child(4)`,
  { width: 128 },
);
globalStyle(`${navigation} > [role="tab"]`, { "@media": { "(max-width: 1280px)": { width: 64 } } });
globalStyle(
  `${navigation} > [role="tab"]:nth-child(2), ${navigation} > [role="tab"]:nth-child(4)`,
  { "@media": { "(max-width: 1280px)": { width: 88 } } },
);
export const tabDivider = style({
  width: 16,
  flexShrink: 0,
  color: vars.color.border.subtle,
  textAlign: "center",
});
export const sectionBoundary = style({
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
  marginTop: vars.space.md,
  paddingTop: vars.space.md,
});
export const contextHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: 56,
  paddingInline: vars.space.md,
});
export const authoredSummary = style({ marginTop: vars.space.md });
export const detailRow = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: 40,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "72px minmax(0,1fr)" } },
});
export const expressionTop = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,576fr) minmax(0,480fr)",
  gap: vars.space.lg,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "1fr" } },
});
export const expressionAttributes = style({
  display: "grid",
  gap: vars.space.md,
  alignContent: "start",
  minWidth: 0,
});
export const authoredLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1000fr) minmax(0,424fr)",
  gap: vars.space.lg,
  minHeight: 0,
  flex: 1,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "1fr" } },
});
export const authoredPreview = style({ "@media": { "(max-width: 1280px)": { display: "none" } } });
export const authoredGroup = style({ display: "grid", gap: vars.space.sm });
export const authoredHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.md,
  minHeight: 36,
});
export const authoredRow = style({
  display: "grid",
  gridTemplateColumns: "24px minmax(0,1fr) 112px 176px 104px",
  alignItems: "start",
  gap: vars.space.sm,
  paddingBlock: vars.space.xs,
  minHeight: 48,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "24px minmax(0,1fr) 96px 64px" } },
});
export const authoredMotion = style({
  minWidth: 0,
  "@media": { "(max-width: 1280px)": { gridColumn: "2 / -1", gridRow: 2 } },
});
export const authoredText = style({ height: 40, minHeight: 40, resize: "vertical" });
export const speechPreview = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  marginBlock: vars.space.md,
  minHeight: 108,
});
export const balloonFontFields = style({
  display: "grid",
  gridTemplateColumns: "176px 176px minmax(0,1fr)",
  gap: vars.space.lg,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } },
});
export const balloonSample = style({ marginTop: vars.space.md });
export const dialoguePanel = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  height: "100%",
  minHeight: 0,
});
export const independentDialogue = style({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
});
globalStyle(`${independentDialogue}[hidden]`, { display: "none" });
export const relationshipPanel = style({ flex: "1 1 260px", maxHeight: 363, minHeight: 100 });
export const attributionPanel = style({ flexShrink: 0 });

globalStyle(`${authoredLayout}[hidden]`, { display: "none" });

globalStyle(`${headerActions} > button`, {
  width: 112,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});

export const assetItems = style({
  display: "grid",
  gap: vars.space.sm,
  marginBottom: vars.space.sm,
});
globalStyle(`${assetRow} > span:first-child`, {
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
});
globalStyle(`${dialogueTypes} > button`, {
  width: 136,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});
globalStyle(`${dialogueTypes} > button:first-child`, {
  width: 184,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});
