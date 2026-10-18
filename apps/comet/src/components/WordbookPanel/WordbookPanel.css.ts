import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const workspace = style({
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  containerType: "inline-size",
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "372px minmax(0,1fr)",
  gap: 28,
  height: "100%",
  minHeight: 0,
  "@container": {
    "(max-width: 1050px)": { gridTemplateColumns: "300px minmax(0,1fr)", gap: 24 },
    "(max-width: 780px)": { gridTemplateColumns: "240px minmax(0,1fr)", gap: 16 },
  },
});
export const inspector = style({
  alignSelf: "start",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minWidth: 0,
  minHeight: 0,
  maxHeight: "100%",
  boxSizing: "border-box",
  padding: "18px 20px 20px",
  borderRadius: 24,
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: `radial-gradient(ellipse at 50% 0, ${tokens["color/component/cat-rest-alpha-160"]}, transparent 70%), ${tokens["color/card-2"]}`,
});
export const listHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
});
export const pageTitle = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 22,
  fontWeight: 400,
  lineHeight: "28px",
});
export const searchRow = style({ display: "flex", gap: 8, minWidth: 0 });
globalStyle(`${searchRow} > span:first-child`, { flex: 1, minWidth: 0 });
globalStyle(`${searchRow} > span:last-child`, { flex: "0 0 110px", width: 110 });
globalStyle(`${searchRow} input`, { width: "100%" });
globalStyle(`${searchRow} select`, { width: 110 });
export const listBody = style({
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  gap: 16,
  paddingRight: 1,
});
export const listGroup = style({ display: "grid", gap: 6 });
export const listGroupTitle = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
  fontWeight: 400,
});
export const entryGroup = style({
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/card"],
});
export const entryRow = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
  padding: "10px 12px",
  selectors: {
    "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` },
    '&[data-selected="true"]': { background: tokens["color/component/primary-alpha-160"] },
  },
});
export const entry = style({
  display: "grid",
  gap: 3,
  minWidth: 0,
  flex: 1,
  padding: 0,
  border: 0,
  background: "transparent",
  textAlign: "left",
  color: tokens["color/ink"],
  cursor: "pointer",
  font: "inherit",
  fontSize: 14,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const caption = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "17px",
  color: tokens["color/ink-3"],
});
export const entryKeywords = style([
  caption,
  { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
]);
export const editorForm = style({ display: "flex", minWidth: 0, minHeight: 0 });
export const editor = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  padding: 0,
  margin: 0,
  border: 0,
});
export const editorBody = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 18,
  paddingRight: 2,
});
export const legend = style({
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clipPath: "inset(50%)",
});
export const section = style({ display: "grid", gap: 8, minWidth: 0 });
export const sectionTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  fontSize: 14,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
  fontWeight: 400,
});
export const editorCard = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
  overflow: "hidden",
});
export const fields = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 170px",
  padding: 16,
  gap: 20,
  "@container": { "(max-width: 900px)": { gridTemplateColumns: "minmax(0,1fr) 130px", gap: 12 } },
});
export const keywordField = style({
  display: "grid",
  gap: 8,
  padding: "12px 16px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const keywordsInput = style({ height: 34, minHeight: 34, resize: "vertical" });
export const linesSection = style({
  display: "grid",
  gap: 8,
  padding: "12px 16px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const line = style({
  display: "grid",
  gridTemplateColumns: "104px minmax(0,1fr) 24px",
  alignItems: "start",
  gap: 8,
  minWidth: 0,
});
export const lineText = style({ minHeight: 34, height: 34, resize: "vertical" });
export const lineAdvanced = style({
  gridColumn: "1 / -1",
  fontSize: 11,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const lineControls = style({
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  marginTop: 8,
});
export const toggleRows = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
globalStyle(`${toggleRows} > div + div`, { borderLeft: `1px solid ${tokens["color/divider"]}` });
export const warning = style({
  margin: 0,
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  fontSize: 12,
  lineHeight: "18px",
});
export const previewDetails = style({ fontSize: 12, color: tokens["color/ink-2"] });
globalStyle(`${previewDetails} > summary`, { cursor: "pointer", padding: "5px 0" });
export const matchTest = style({
  padding: "10px 16px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 16,
  background: tokens["color/card"],
});
export const testControls = style({ display: "flex", alignItems: "end", gap: 10 });
globalStyle(`${testControls} > div`, { flex: 1, minWidth: 0 });
export const preview = style({ padding: 16, whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
export const previewLines = style({ margin: 0, paddingLeft: 20 });
export const previewText = style({ display: "block", whiteSpace: "pre-wrap" });
export const saveBar = style({ paddingTop: 16, flexShrink: 0 });
export const actions = style({ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" });
export const saveStatus = style({
  marginRight: "auto",
  fontSize: 12,
  color: tokens["color/ink-3"],
});
export const confirmation = style({
  display: "grid",
  gap: 10,
  padding: 14,
  marginTop: 10,
  borderRadius: 16,
  background: tokens["color/card"],
  fontSize: 13,
});
