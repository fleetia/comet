import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const page = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  minWidth: 0,
  minHeight: "100%",
  color: tokens["color/ink"],
});
export const toolbar = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minHeight: 36,
  flexWrap: "wrap",
});
export const title = style({
  flex: 1,
  margin: 0,
  fontFamily: tokens["typography/display/page/fontFamily"],
  fontSize: 26,
  fontWeight: 400,
  lineHeight: "32px",
});
export const columns = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0, 1fr)",
  gap: 18,
  flex: 1,
  minHeight: 540,
  minWidth: 0,
  "@media": {
    "(max-width: 940px)": { gridTemplateColumns: "250px minmax(0, 1fr)" },
    "(max-width: 720px)": { gridTemplateColumns: "minmax(0, 1fr)", minHeight: 0 },
  },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 12,
  minWidth: 0,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card-2"],
});
export const cards = style({ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 });
export const preview = style({ width: "100%" });
export const previewBody = style({
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
});
export const caption = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "17px",
});
export const listFooter = style([caption, { padding: "6px 4px 0" }]);
export const groupLabel = style([caption, { margin: 0, padding: "6px 12px 0" }]);
export const detailHost = style({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  selectors: { "&[hidden]": { display: "none" } },
});
export const detail = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minWidth: 0,
  minHeight: 540,
  flex: 1,
  padding: "20px 22px 18px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card-2"],
});
export const header = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
  flexWrap: "wrap",
});
export const titleField = style({ flex: "1 1 160px", minWidth: 0 });
export const titleInput = style({ width: "100%" });
export const editorField = style({ flex: 1, display: "flex", minHeight: 260, minWidth: 0 });
export const editor = style({ width: "100%", height: "100%", minHeight: 260, resize: "vertical" });
globalStyle(`${editorField} > span`, { width: "100%", minWidth: 0, flex: 1 });
export const compactDetail = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  padding: 14,
  border: 0,
  outline: `1px solid ${tokens["color/card-border"]}`,
  outlineOffset: -1,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
});
export const compactTitle = style({
  display: "block",
  fontSize: 13.5,
  lineHeight: "18px",
  fontWeight: 600,
});
export const compactTitleField = style([
  titleField,
  { display: "flex", flexDirection: "column", gap: 1 },
]);
export const compactTitleButton = style([
  compactTitle,
  {
    padding: 0,
    border: 0,
    background: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer",
  },
]);
export const compactStatus = style([
  caption,
  { marginLeft: "auto", fontSize: 12, lineHeight: "16px" },
]);
export const compactEditorField = style({ display: "flex", minWidth: 0 });
globalStyle(`${compactEditorField} > span`, { width: "100%", minWidth: 0, flex: 1 });
export const compactEditor = style({
  width: "100%",
  height: 76,
  minHeight: 76,
  padding: "6px 9px",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/input"],
  fontSize: 13,
  lineHeight: "19px",
  resize: "vertical",
});
export const metadata = style({
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-9"],
  background: tokens["color/card"],
});
export const metadataRow = style({
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "9px 16px",
  flexWrap: "wrap",
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const metadataCopy = style({
  flex: 1,
  minWidth: 140,
  display: "flex",
  flexDirection: "column",
  gap: 2,
});
export const metadataLabel = style({ fontSize: 14, lineHeight: "19px" });
export const footer = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
});
export const actions = style({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
export const error = style([caption, { color: tokens["color/danger"] }]);
export const empty = style([
  detail,
  { justifyContent: "center", alignItems: "center", textAlign: "center" },
]);
