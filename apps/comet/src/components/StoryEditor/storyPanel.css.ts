import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const missingTarget = style({ color: tokens["color/danger"] });

export const panel = style({
  position: "absolute",
  zIndex: 6,
  top: 0,
  bottom: 0,
  right: 0,
  width: 400,
  maxWidth: "100%",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box",
  background: tokens["color/glass-window"],
  borderLeft: `1px solid ${tokens["color/card-border"]}`,
  color: tokens["color/ink"],
});
export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "16px 20px",
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
export const content = style({
  padding: "16px 20px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  fontSize: 13,
});
export const notice = style({ padding: "0 20px", color: tokens["color/ink-3"], fontSize: 12 });
export const line = style({
  borderRadius: 10,
  padding: 10,
  background: tokens["color/card"],
  fontSize: 13,
});
export const step = style({
  borderRadius: 10,
  padding: 10,
  border: `1px solid ${tokens["color/card-border"]}`,
  fontSize: 12,
});
export const stepSummary = style({ display: "flex", gap: 8 });
globalStyle(`.${stepSummary} span`, { color: tokens["color/ink-3"] });
export const lineInput = style({ display: "flex", gap: 8, alignItems: "flex-start" });
export const textareaWrapper = style({
  flex: 1,
  minWidth: 0,
  display: "grid",
});
globalStyle(`.${textareaWrapper}::after`, {
  content: 'attr(data-value) " "',
  visibility: "hidden",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  gridArea: "1 / 1",
});
export const textarea = style({
  gridArea: "1 / 1",
  minWidth: 0,
  resize: "none",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  padding: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
});
export const expand = style({
  border: 0,
  padding: "4px 0",
  background: "transparent",
  color: tokens["color/ink-3"],
  cursor: "pointer",
  fontSize: 12,
});
export const fields = style({ display: "flex", flexDirection: "column", gap: 8 });
export const actions = style({ display: "flex", gap: 4 });
export const addRow = style({
  position: "relative",
  display: "flex",
  alignItems: "center",
  minHeight: 18,
});
export const add = style({
  border: 0,
  borderRadius: "50%",
  width: 22,
  height: 22,
  background: "transparent",
  color: tokens["color/ink-3"],
  cursor: "pointer",
});
export const stepRow = style({});
globalStyle(`.${add}, .${expand}`, { opacity: 0 });
globalStyle(
  `.${stepRow}:hover .${add}, .${stepRow}:focus-within .${add}, .${stepRow}:hover .${expand}, .${stepRow}:focus-within .${expand}, .${addRow}:hover .${add}, .${addRow}:focus-within .${add}, .${add}[aria-expanded="true"]`,
  { opacity: 1 },
);
export const menu = style({
  position: "absolute",
  zIndex: 1,
  top: 22,
  left: 0,
  display: "flex",
  flexDirection: "column",
  padding: 6,
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 8,
});
globalStyle(`.${menu} button`, {
  border: 0,
  padding: "6px 12px",
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
});
