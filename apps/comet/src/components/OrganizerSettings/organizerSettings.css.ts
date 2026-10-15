import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({
  display: "flex",
  flexDirection: "column",
  gap: 18,
  height: "100%",
  minHeight: 0,
  minWidth: 0,
});
export const subnavigation = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontSize: 13,
  color: tokens["color/ink-2"],
  flexShrink: 0,
});
export const progressCard = style({
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: 16,
  borderRadius: 18,
  border: `1px dashed ${tokens["color/card-border"]}`,
  background: tokens["color/input"],
});
export const progressRing = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  width: 96,
  height: 96,
  borderRadius: "50%",
  border: 0,
  position: "relative",
  background: tokens["color/track"],
  color: tokens["color/ink"],
  flexShrink: 0,
});
globalStyle(`${progressRing} strong`, {
  fontFamily: tokens["typography/display/stat/fontFamily"],
  fontWeight: 400,
  fontSize: 26,
  lineHeight: "32px",
});
globalStyle(`${progressRing} span`, { fontSize: 12, color: tokens["color/ink-3"] });
export const progressCopy = style({ display: "grid", gap: 7, minWidth: 0, fontSize: 14 });
export const search = style({ display: "grid", gap: 8, minWidth: 0 });
export const path = style({ display: "flex", gap: 8, minWidth: 0, alignItems: "center" });
globalStyle(`${path} > span`, { flex: 1, minWidth: 0 });
export const fullInput = style({ width: "100%" });
export const hits = style({ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 });
globalStyle(`${hits} li`, {
  padding: 12,
  borderRadius: 14,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
  fontSize: 12,
});
export const vaultRow = style({
  display: "flex",
  alignItems: "start",
  gap: 12,
  padding: "12px 16px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const vaultCopy = style({
  display: "grid",
  gap: 5,
  minWidth: 0,
  overflowWrap: "anywhere",
  fontSize: 14,
});
export const fieldset = style({
  border: 0,
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 20,
  minWidth: 0,
});
export const folderPreview = style({
  padding: "16px 18px",
  borderRadius: 18,
  border: `1px dashed ${tokens["color/card-border"]}`,
  background: tokens["color/input"],
  fontSize: 14,
  overflowWrap: "anywhere",
});
export const pathPreview = style({
  display: "grid",
  gap: 8,
  paddingTop: 16,
  fontSize: 12,
  color: tokens["color/ink-2"],
});
globalStyle(`${pathPreview} > span`, { display: "flex", alignItems: "center", gap: 8 });
globalStyle(`${pathPreview} small`, { marginLeft: "auto", color: tokens["color/ink-3"] });
export const folderPath = style({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderRadius: 18,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
});
globalStyle(`${folderPath} > span`, { flex: 1, minWidth: 0 });
export const folderFields = style({
  display: "grid",
  gridTemplateColumns: "repeat(2,minmax(0,1fr))",
  gap: 28,
  padding: 16,
  borderRadius: 18,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
});
globalStyle(`${folderFields} textarea`, { width: "100%", height: 90, resize: "vertical" });
export const connectActions = style({ display: "flex", justifyContent: "flex-end", gap: 8 });
export const save = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  paddingTop: 12,
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const panel = style({ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 });
export const section = style({ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 });
export const heading = style({ margin: 0, fontSize: 16, fontWeight: 600 });
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "18px",
  overflowWrap: "anywhere",
});
export const actions = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 });
export const item = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingBlock: 16,
  borderTop: `1px solid ${tokens["color/divider"]}`,
  overflowWrap: "anywhere",
});
export const text = style({
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: "21px",
  fontSize: 14,
});

export const progressArc = style({
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  background: `conic-gradient(${tokens["color/live"]} var(--organizer-progress), transparent 0)`,
  maskImage: "radial-gradient(circle, transparent 39px, black 40px)",
});
export const ringCopy = style({
  position: "absolute",
  inset: 8,
  borderRadius: "50%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: tokens["color/input"],
});
