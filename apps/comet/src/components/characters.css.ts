import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const page = style({
  padding: tokens["spacing/space-16"],
  background: tokens["color/sky"],
  minHeight: "100dvh",
});
export const embedded = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  height: "100%",
  minHeight: 0,
});
export const header = style({ marginBottom: tokens["spacing/space-12"] });
export const layout = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-6"],
  alignSelf: "stretch",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
});
export const libraryHeading = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: tokens["spacing/space-6"],
  paddingBottom: 0,
});
export const item = style({
  display: "grid",
  gridTemplateColumns: "36px minmax(0,1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  minHeight: 64,
});
export const itemName = style({ overflowWrap: "anywhere", minWidth: 0 });
export const small = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  color: tokens["color/ink-2"],
  margin: 0,
  overflowWrap: "anywhere",
});
export const roster = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  padding: `${tokens["spacing/space-8"]} 0 ${tokens["spacing/space-12"]}`,
});
export const libraryActions = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-8"]} 0`,
});
export const detail = style({ display: "contents" });
export const editor = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});
export const editorPanel = style({
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: 0,
});
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const section = style({
  margin: `${tokens["spacing/space-12"]} 0 0`,
  paddingTop: tokens["spacing/space-8"],
  borderTop: `1px solid ${tokens["color/input-border"]}`,
});
export const sectionHeader = style({
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: tokens["spacing/space-12"],
});
export const subheading = style({
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "1.385",
  fontWeight: 600,
  margin: `0 0 ${tokens["spacing/space-8"]}`,
});
export const basicFields = style({
  display: "grid",
  alignItems: "start",
  gridTemplateColumns: "200px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  minWidth: 0,
  "@media": { "(max-width: 820px)": { gridTemplateColumns: "1fr" } },
});
export const inlineField = style({
  display: "grid",
  gridTemplateColumns: "1fr",
  alignItems: "baseline",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
});
export const personalityInput = style({
  minHeight: 52,
  height: 52,
});
export const expressionAdd = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: tokens["spacing/space-8"],
  alignItems: "center",
  marginTop: tokens["spacing/space-6"],
});
globalStyle(`${expressionAdd}[hidden]`, { display: "none" });
export const personalityField = style([inlineField, { gridColumn: "1 / -1" }]);
export const relationshipRow = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  margin: `${tokens["spacing/space-8"]} 0`,
});
export const relationshipControls = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  gap: tokens["spacing/space-8"],
});
export const appearanceLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) minmax(160px,1fr)",
  gap: tokens["spacing/space-16"],
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const appearanceCheckbox = style({
  width: "100%",
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
});
export const spriteFrame = style({
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
  overflow: "hidden",
});
export const spriteImage = style({
  width: "100%",
  height: "100%",
  objectFit: "contain",
  imageRendering: "pixelated",
});
export const balloonColorInput = style({
  width: 48,
  padding: tokens["spacing/space-4"],
});
export const balloonTextPreview = style({
  margin: 0,
  padding: tokens["spacing/space-8"],
  border: `1px solid ${tokens["color/line"]}`,
  lineHeight: 1.6,
  overflowWrap: "anywhere",
});
export const compactActions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
  marginTop: tokens["spacing/space-6"],
});
export const line = style({ paddingBottom: tokens["spacing/space-8"] });
export const textarea = style({ minHeight: 96 });
export const dialogueScope = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
  margin: `${tokens["spacing/space-8"]} 0`,
});
export const scopeField = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
});
export const saveBar = style({
  flexShrink: 0,
  borderTop: `1px solid ${tokens["color/line"]}`,
  padding: `${tokens["spacing/space-6"]} 0`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-8"],
  flexWrap: "wrap",
});
export const packSelector = style({ padding: tokens["spacing/space-8"] });
export const packHint = style({ display: "block", marginTop: tokens["spacing/space-6"] });
export const preview = style({
  padding: `${tokens["spacing/space-8"]} 0`,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const notice = style({
  margin: `${tokens["spacing/space-8"]} 0`,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
export const disclosureSummary = style({
  padding: `${tokens["spacing/space-6"]} 0`,
  color: tokens["color/primary"],
  fontSize: tokens["typography/sans/body/fontSize"],
  cursor: "pointer",
});

globalStyle(`${saveBar}[hidden]`, { display: "none" });

export const sourceHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-12"],
  minHeight: tokens["size/control-36"],
  flexWrap: "wrap",
});
export const sourceDetail = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: tokens["size/control-36"],
  marginBlock: tokens["spacing/space-8"],
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
globalStyle(`${libraryActions} > button`, { width: "100%" });

globalStyle(`${basicFields} > div:nth-child(n+3)`, { gridColumn: "1 / -1" });
