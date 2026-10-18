import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const title = style({
  fontSize: tokens["typography/display/page/fontSize"],
  lineHeight: "1.25",
  fontWeight: 700,
  margin: 0,
  overflowWrap: "anywhere",
});
export const profileLayout = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  padding: "0 28px 26px",
  minHeight: 0,
  height: "100%",
  minWidth: 0,
  alignItems: "start",
  "@media": {
    "(max-width: 1050px)": { gridTemplateColumns: "minmax(250px,32%) minmax(0,1fr)" },
    "(max-width: 740px)": { gridTemplateColumns: "1fr" },
  },
});
export const profileMain = style({
  gridColumn: 2,
  gridRow: 1,
  minWidth: 0,
  minHeight: 0,
  background: "transparent",
  border: 0,
  boxShadow: "none",
  backdropFilter: "none",
  overflow: "visible",
  "@media": { "(max-width: 740px)": { gridColumn: 1, gridRow: 2 } },
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
  gap: tokens["spacing/space-16"],
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const assetRow = style({
  display: "grid",
  gap: 0,
  minWidth: 0,
  minHeight: 56,
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]}`,
  alignContent: "start",
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const inspector = style({ minWidth: 0, minHeight: 0 });
export const previewStage = style({
  padding: 16,
  display: "grid",
  placeItems: "center",
  minHeight: 204,
  marginBlock: 0,
  gap: tokens["spacing/space-8"],
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
  gap: tokens["spacing/space-16"],
  marginBlock: tokens["spacing/space-12"],
});
export const commonSettings = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-16"],
  marginTop: tokens["spacing/space-16"],
});
export const expressionBindings = style({ padding: 12, marginTop: tokens["spacing/space-12"] });
export const balloonLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,792fr) minmax(0,632fr)",
  gap: tokens["spacing/space-16"],
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)" } },
});
export const balloonStage = style({
  padding: 16,
  display: "grid",
  placeItems: "center",
  minHeight: 464,
  gap: tokens["spacing/space-16"],
  "@media": { "(max-width: 1280px)": { minHeight: 300 } },
});
export const balloonSpecimen = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  width: "100%",
  maxWidth: 400,
  background: tokens["color/glass-panel"],
  color: tokens["color/ink"],
  padding: 20,
  borderRadius: tokens["radius/radius-12"],
});
export const dialogueTypes = style({
  display: "flex",
  gap: tokens["spacing/space-8"],
  flexShrink: 0,
  minHeight: 40,
  alignItems: "center",
});
export const instructionsInput = style({ minHeight: 78, height: 78 });

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
  padding: tokens["spacing/space-16"],
});
export const workFooter = style({
  flexShrink: 0,
  minWidth: 0,
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-16"]} ${tokens["spacing/space-8"]}`,
});
globalStyle(`${workFooter} > div`, { flexWrap: "wrap" });
export const fullHeight = style({ height: "100%", minHeight: 0, minWidth: 0 });
export const headerActions = style({
  display: "flex",
  gap: tokens["spacing/space-12"],
  marginLeft: "auto",
  flexShrink: 0,
});
export const navigation = style({
  height: 36,
  alignItems: "center",
  flexWrap: "nowrap",
  gap: tokens["spacing/space-8"],
});
globalStyle(`${navigation} > [role="tab"]`, {
  width: 96,
  height: tokens["size/control-36"],
  minHeight: tokens["size/control-36"],
  justifyContent: "center",
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]}`,
  borderRadius: tokens["radius/radius-9"],
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
export const sectionBoundary = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  marginTop: tokens["spacing/space-12"],
  paddingTop: tokens["spacing/space-12"],
});
export const contextHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: 56,
  paddingInline: tokens["spacing/space-12"],
});
export const authoredSummary = style({ marginTop: 10, width: "100%" });
export const detailRow = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: 40,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "72px minmax(0,1fr)" } },
});
export const expressionTop = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,576fr) minmax(0,480fr)",
  gap: tokens["spacing/space-16"],
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "1fr" } },
});
export const expressionAttributes = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  alignContent: "start",
  minWidth: 0,
});
export const authoredLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1000fr) minmax(0,424fr)",
  gap: tokens["spacing/space-16"],
  minHeight: 0,
  flex: 1,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "1fr" } },
});
export const authoredPreview = style({ "@media": { "(max-width: 1280px)": { display: "none" } } });
export const authoredGroup = style({ display: "grid", gap: tokens["spacing/space-8"] });
export const authoredHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  minHeight: 36,
});
export const authoredRow = style({
  display: "grid",
  gridTemplateColumns: "24px minmax(0,1fr) 112px 176px 104px",
  alignItems: "start",
  gap: tokens["spacing/space-8"],
  paddingBlock: tokens["spacing/space-6"],
  minHeight: 48,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "24px minmax(0,1fr) 96px 64px" } },
});
export const authoredMotion = style({
  minWidth: 0,
  "@media": { "(max-width: 1280px)": { gridColumn: "2 / -1", gridRow: 2 } },
});
export const authoredText = style({ height: 40, minHeight: 40, resize: "vertical" });
export const speechPreview = style({
  padding: 16,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  marginBlock: tokens["spacing/space-12"],
  minHeight: 108,
});
export const balloonFontFields = style({
  display: "grid",
  gridTemplateColumns: "176px 176px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } },
});
export const balloonSample = style({ marginTop: tokens["spacing/space-12"] });
export const dialoguePanel = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
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
globalStyle(`${authoredLayout}[hidden]`, { display: "none" });

globalStyle(`${headerActions} > button`, {
  width: 112,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});

globalStyle(`${assetRow} > span:first-child`, {
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
});
globalStyle(`${dialogueTypes} > button`, {
  width: 136,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});
globalStyle(`${dialogueTypes} > button:first-child`, {
  width: 184,
  "@media": { "(max-width: 1280px)": { width: "auto" } },
});

export const relationshipWorkspace = style({
  height: "100%",
  minHeight: 0,
  padding: "0 28px 28px",
});
globalStyle(`${profileMain} > [data-character-scroll="body"]`, { padding: 0, overflow: "visible" });
globalStyle(`${profileMain} > [data-character-footer="fixed"]`, { padding: "16px 0 0" });
globalStyle(`${profileMain} input, ${profileMain} textarea`, {
  background: tokens["color/input"],
  borderColor: tokens["color/input-border"],
});
// Standalone form row: align with the surrounding fields instead of a settings list group.
export const formControlRow = style({ paddingInline: 0, borderTop: 0 });
export const cardPanel = style({ padding: 16 });
export const cardCompact = style({ padding: 12 });
