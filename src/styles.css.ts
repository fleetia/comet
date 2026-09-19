import { globalStyle, style, styleVariants } from "@vanilla-extract/css";

globalStyle("*", { boxSizing: "border-box" });
globalStyle("html, body, #root", { margin: 0, minHeight: "100%", width: "100%" });
globalStyle("body", {
  background: "#f7f5ef",
  color: "#30342f",
  fontFamily: '"Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
  fontSize: 13,
  WebkitFontSmoothing: "antialiased",
});
globalStyle("button, input, textarea, select", { font: "inherit" });
globalStyle("button", { cursor: "pointer" });
globalStyle("button:disabled", { cursor: "default", opacity: 0.45 });
globalStyle(
  "button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible",
  { outline: "2px solid #486d60", outlineOffset: 3 },
);
globalStyle("button", { color: "inherit" });
globalStyle("h1, h2, h3, p", { margin: 0 });
globalStyle("summary", { cursor: "pointer" });
export const preview = style({
  padding: "48px 28px",
  maxWidth: 1040,
  margin: "auto",
  "@media": { "(max-width: 600px)": { padding: "28px 14px" } },
});
export const previewHeader = style({
  marginBottom: 32,
  display: "flex",
  flexDirection: "column",
  gap: 10,
});
export const eyebrow = style({
  fontSize: 10,
  letterSpacing: "0.15em",
  fontWeight: 600,
  color: "#687368",
});
export const previewTitle = style({ fontSize: 30, fontWeight: 500, letterSpacing: "-0.05em" });
export const boxes = style({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  flexWrap: "wrap",
  gap: 24,
  margin: "32px 0 56px",
});
export const box = style({
  width: "100%",
  height: "100dvh",
  minHeight: 330,
  display: "flex",
  flexDirection: "column",
  background: "#fffdf8",
  overflow: "hidden",
  border: "1px solid #dfdfd5",
  borderRadius: 12,
});
export const previewBox = style({ width: 340, height: 440, boxShadow: "0 12px 30px #30342f0b" });
export const accent = styleVariants({
  a: { borderTop: "3px solid #d7a578" },
  b: { borderTop: "3px solid #8caa95" },
});
export const header = style({
  height: 49,
  minHeight: 49,
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "0 17px",
  userSelect: "none",
  borderBottom: "1px solid #ecece4",
  cursor: "grab",
});
export const name = style({ fontSize: 13, fontWeight: 650 });
export const quiet = style({ color: "#6b7269", fontSize: 11, lineHeight: 1.6 });
export const spacer = style({ flex: 1 });
export const iconButton = style({
  background: "transparent",
  border: 0,
  minWidth: 28,
  minHeight: 30,
  fontSize: 17,
  borderRadius: 5,
  ":hover": { background: "#eeeee6" },
});
export const conversation = style({
  padding: "24px 23px 12px",
  flex: 1,
  overflowY: "auto",
  minHeight: 0,
});
export const expression = style({
  color: "#77826e",
  fontSize: 11,
  letterSpacing: "0.03em",
  marginBottom: 13,
});
export const utterance = style({
  fontSize: 20,
  fontWeight: 450,
  lineHeight: 1.65,
  letterSpacing: "-0.035em",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const emptyHint = style({ marginTop: 13, fontSize: 12, color: "#76796d", lineHeight: 1.7 });
export const transcript = style({ marginTop: 20, fontSize: 11, color: "#72796f", lineHeight: 1.8 });
export const historyLine = style({
  marginTop: 10,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  borderLeft: "2px solid #e3e6dd",
  paddingLeft: 10,
});
export const statusRow = style({
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 20px",
  borderBottom: "1px solid #e9eae1",
  fontSize: 10,
  color: "#72786c",
});
export const dot = style({
  width: 5,
  height: 5,
  borderRadius: "50%",
  background: "#879b7c",
  flexShrink: 0,
});
export const composer = style({
  flexShrink: 0,
  padding: "12px 16px 15px",
  background: "#f9f9f2",
});
export const composerControls = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
  fontSize: 11,
});
export const inline = style({ display: "flex", alignItems: "center", gap: 8 });
export const composeRow = style({ display: "flex", gap: 7, alignItems: "flex-end" });
export const input = style({
  width: "100%",
  border: "1px solid #dfe2d8",
  background: "#fffefa",
  borderRadius: 6,
  padding: "9px 10px",
  color: "#30342f",
  minWidth: 0,
});
export const textarea = style([
  input,
  { resize: "vertical", minHeight: 38, maxHeight: 100, lineHeight: 1.5 },
]);
export const select = style({
  border: 0,
  background: "transparent",
  color: "#60685c",
  fontSize: 11,
  maxWidth: 150,
});
export const button = style({
  border: "1px solid #d7ddd0",
  borderRadius: 6,
  background: "#fdfdf7",
  padding: "8px 12px",
  fontSize: 12,
  whiteSpace: "nowrap",
  ":hover": { background: "#f0f2e9" },
});
export const primary = style([
  button,
  {
    background: "#3c5145",
    borderColor: "#3c5145",
    color: "#fffef5",
    ":hover": { background: "#2c4034" },
  },
]);
export const error = style({
  fontSize: 12,
  color: "#934c35",
  background: "#fff1e9",
  borderRadius: 5,
  padding: "9px 11px",
  marginTop: 8,
  lineHeight: 1.6,
  overflowWrap: "anywhere",
});
export const success = style({ fontSize: 12, color: "#416848", padding: "8px 0" });
export const settings = style({
  maxWidth: 680,
  padding: "28px 26px 40px",
  margin: "0 auto",
  background: "#fffdf8",
  minHeight: "100dvh",
});
export const previewSettings = style({
  borderTop: "1px solid #dce1d5",
  minHeight: 0,
  background: "transparent",
});
export const settingsTitle = style({
  fontSize: 24,
  fontWeight: 550,
  letterSpacing: "-0.04em",
  marginBottom: 8,
});
export const section = style({
  border: 0,
  margin: "28px 0 0",
  padding: "24px 0 0",
  borderTop: "1px solid #e4e6db",
});
export const sectionTitle = style({ fontSize: 15, fontWeight: 600, marginBottom: 14 });
export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: 7,
  fontSize: 12,
  marginBottom: 14,
});
export const row = style({
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
  margin: "12px 0",
});
export const tabs = style({ display: "flex", gap: 9, margin: "22px 0 16px" });
export const choice = style([
  button,
  {
    flex: 1,
    padding: "13px 16px",
    textAlign: "left",
    selectors: {
      '&[aria-pressed="true"]': {
        borderColor: "#6c8368",
        background: "#edf1e6",
        boxShadow: "inset 0 0 0 1px #6c8368",
      },
    },
  },
]);
export const memory = style({ padding: "13px 0", borderBottom: "1px solid #eceee4" });
export const progress = style({ width: "100%", accentColor: "#678066", height: 7 });
export const loading = style({
  display: "grid",
  placeContent: "center",
  minHeight: "100dvh",
  gap: 14,
  padding: 24,
});

export const noticeArea = style({
  flexShrink: 0,
  padding: "0 16px 8px",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
});
export const boxError = style([
  error,
  { marginTop: 0, maxHeight: 70, overflowY: "auto", width: "100%" },
]);
