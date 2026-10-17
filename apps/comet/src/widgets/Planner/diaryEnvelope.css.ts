import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const page = style({
  display: "flex",
  flexDirection: "column",
  gap: 18,
  minWidth: 0,
  width: "100%",
  padding: "20px 22px",
  borderRadius: tokens["radius/radius-20"],
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  background: tokens["color/card-2"],
  color: tokens["color/ink"],
  boxSizing: "border-box",
  minHeight: 0,
  alignSelf: "start",
});
export const section = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  paddingTop: 0,
});
export const heading = style({
  margin: 0,
  fontSize: tokens["typography/display/stat/fontSize"],
  fontWeight: 600,
  lineHeight: "1.25",
});
export const subheading = style({
  margin: 0,
  fontSize: 13.5,
  lineHeight: "18px",
  color: tokens["color/ink"],
  fontWeight: 600,
});
export const caption = style({
  margin: 0,
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "17px",
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  flexWrap: "wrap",
});
export const actions = style([row, { justifyContent: "flex-end" }]);
export const envelopeHeader = style({ width: "100%" });
globalStyle(`${envelopeHeader} > div:last-child`, {
  marginLeft: "auto",
  justifyContent: "flex-end",
});
export const grow = style({ flex: 1, minWidth: 0 });
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
});
export const checklist = style({ display: "flex", flexDirection: "column", gap: tokens["spacing/space-6"] });
export const checkRow = style([
  row,
  { padding: "6px 12px", minHeight: 40, boxSizing: "border-box" },
]);
export const notes = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
});
export const note = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  padding: tokens["spacing/space-12"],
  borderRadius: tokens["radius/radius-22"],
  background: tokens["color/glass-panel"],
  selectors: {
    '&[data-location="envelope"]': {
      padding: "12px 14px",
      gap: 3,
      background: tokens["color/card"],
      outline: `1px solid ${tokens["color/card-border"]}`,
      outlineOffset: -1,
      borderRadius: tokens["radius/radius-16"],
    },
  },
});
export const noteTitle = style({ margin: 0, fontSize: tokens["typography/sans/caption/fontSize"], fontWeight: 600 });
export const noteBody = style({
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
globalStyle(`${note}[data-location="envelope"] ${noteTitle}`, {
  fontSize: 13.5,
  lineHeight: "18px",
});
globalStyle(`${note}[data-location="envelope"] ${noteBody}`, {
  fontSize: 12.5,
  lineHeight: "19px",
  color: tokens["color/ink-2"],
});
export const envelopeNoteAction = style({
  fontSize: 12,
  lineHeight: "16px",
  height: 18,
  color: tokens["color/ink-3"],
  fontWeight: 400,
});
export const storedNotePreview = style([
  noteBody,
  {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
]);
export const textArea = style({
  width: "100%",
  minHeight: 104,
  resize: "vertical",
  boxSizing: "border-box",
  padding: tokens["spacing/space-8"],
  borderRadius: tokens["radius/radius-9"],
  border: `1px solid ${tokens["color/input-border"]}`,
  background: tokens["color/sky"],
  color: tokens["color/ink"],
  font: "inherit",
  lineHeight: "1.462",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const disclosure = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const resourceAdd = style({ minWidth: 0 });
globalStyle(`${resourceAdd} > summary`, {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "8px 12px",
  boxSizing: "border-box",
  borderTop: `1px solid ${tokens["color/divider"]}`,
  color: tokens["color/selected-icon"],
  fontSize: 13,
  lineHeight: "18px",
  cursor: "pointer",
  listStyle: "none",
});
globalStyle(`${resourceAdd} > form`, { padding: 12 });
export const error = style({
  margin: 0,
  color: tokens["color/danger"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});
export const linkList = style({
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-6"],
});
export const dateBanner = style([
  row,
  {
    padding: "18px 16px",
    minHeight: 68,
    borderRadius: tokens["radius/radius-12"],
    background: tokens["color/card-2"],
  },
]);
export const columns = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
  gap: 18,
  "@media": { "(max-width: 980px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const column = style({ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 });
export const related = style([section, { gap: 4 }]);
export const footer = style([row, { justifyContent: "space-between", paddingTop: 12 }]);

export const itemTitle = style({
  flex: 1,
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  padding: `${tokens["spacing/space-6"]} 0`,
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const memoPreview = style([
  caption,
  { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
]);

export const desktopMemoPreview = style({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  justifyContent: "flex-start",
});

export const listCard = style({
  padding: 0,
  overflow: "hidden",
  boxShadow: "none",
  borderRadius: tokens["radius/radius-16"],
});
export const listItem = style({
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const archivePrompt = style({
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  boxShadow: "none",
});
export const envelopeGroups = style({ display: "flex", flexDirection: "column", gap: 10 });
export const envelopeGroup = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  scrollMarginTop: 8,
});
export const envelopeCard = style({ width: "100%" });
export const createForm = style({ display: "flex", flexDirection: "column", gap: 10 });
export const createDialog = style({ width: 540, maxWidth: "calc(100vw - 48px)", padding: 0 });
export const createTextarea = style({
  width: "100%",
  height: 73,
  minHeight: 73,
  padding: "6px 9px",
  fontSize: 13,
  lineHeight: "19px",
  resize: "vertical",
});
export const createField = style({
  display: "grid",
  gridTemplateColumns: "76px minmax(0,1fr)",
  alignItems: "center",
  gap: 12,
  minHeight: 34,
});
export const createLabel = style({
  textAlign: "right",
  fontSize: 13,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const createControl = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
});
globalStyle(`${createField} > span`, { minWidth: 0, width: "100%" });
globalStyle(`${createField} > span > input, ${createField} > span > textarea`, { width: "100%" });
globalStyle(`${createDialog} h2`, {
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 16,
  lineHeight: "22px",
  fontWeight: 400,
});
