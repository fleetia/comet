import { style, styleVariants } from "@vanilla-extract/css";

export const body = style({
  width: "100%",
  height: "100dvh",
  minHeight: 60,
  padding: "12px 8px",
  border: "1px solid #d4d9cf",
  borderRadius: 9,
  background: "#fbfaf3",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  userSelect: "none",
  cursor: "grab",
  touchAction: "none",
  selectors: { "&:active": { cursor: "grabbing" } },
});
export const bodyPreview = style({ width: 112, height: 88, boxShadow: "0 6px 20px #3448340c" });
export const tone = styleVariants({
  a: { borderTop: "3px solid #d4a074" },
  b: { borderTop: "3px solid #96ac93" },
});
export const bodyName = style({
  fontSize: 11,
  fontWeight: 650,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  letterSpacing: "0.01em",
  color: "#707769",
});
export const face = style({
  fontSize: 17,
  letterSpacing: "-0.045em",
  fontWeight: 500,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
export const balloon = style({
  width: "100%",
  height: "auto",
  minHeight: 110,
  maxHeight: 520,
  background: "#fffef8",
  border: "1px solid #d8ddce",
  borderRadius: 9,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const balloonPreview = style({
  width: 320,
  maxWidth: "100%",
  boxShadow: "0 9px 28px #3b4c3a0c",
});
export const balloonHeader = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "7px 12px",
  fontSize: 11,
  color: "#6f7867",
  flexShrink: 0,
  borderBottom: "1px solid #ecefe4",
});
export const close = style({
  border: 0,
  background: "transparent",
  width: 28,
  height: 26,
  fontSize: 17,
  borderRadius: 4,
  ":hover": { background: "#eeeee3" },
});
export const speech = style({
  maxHeight: 400,
  padding: "18px 20px",
  fontSize: 19,
  lineHeight: 1.65,
  letterSpacing: "-0.025em",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
export const footer = style({
  padding: "6px 14px 10px",
  fontSize: 10,
  color: "#8b9182",
  display: "flex",
  justifyContent: "space-between",
  flexShrink: 0,
});
export const menu = style({
  padding: "5px 8px",
  display: "flex",
  flexDirection: "column",
  gap: 1,
  flex: 1,
  overflowY: "auto",
});
export const menuItem = style({
  border: 0,
  borderRadius: 4,
  background: "transparent",
  padding: "8px 11px",
  textAlign: "left",
  fontSize: 12,
  ":hover": { background: "#f0f3e8" },
});
export const form = style({
  maxHeight: 290,
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
});
export const input = style({
  width: "100%",
  border: "1px solid #d7dece",
  borderRadius: 5,
  background: "#fffefb",
  padding: 9,
  minHeight: 68,
  resize: "none",
  lineHeight: 1.5,
  color: "#30342f",
});
export const row = style({
  display: "flex",
  gap: 9,
  justifyContent: "space-between",
  alignItems: "center",
});
export const history = style({
  maxHeight: 360,
  padding: "8px 15px 16px",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
});
export const historyMessage = style({
  margin: "12px 0",
  fontSize: 12,
  lineHeight: 1.65,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const historyName = style({
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#85917c",
  marginBottom: 2,
});
export const notice = style({ padding: "0 12px 8px", flexShrink: 0 });
export const error = style({
  padding: "8px 10px",
  background: "#fff1e9",
  color: "#934c35",
  fontSize: 11,
  lineHeight: 1.6,
  borderRadius: 4,
  maxHeight: 65,
  overflowY: "auto",
  overflowWrap: "anywhere",
});
export const preview = style({
  maxWidth: 840,
  margin: "0 auto",
  padding: "46px 24px 32px",
  minHeight: "100dvh",
});
export const previewTitle = style({
  fontSize: 15,
  fontWeight: 550,
  marginBottom: 7,
  letterSpacing: "0.02em",
});
export const stage = style({
  position: "relative",
  minHeight: 430,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "flex-end",
  padding: "24px 0 32px",
  borderBottom: "1px solid #dce2d5",
  marginBottom: 20,
});
export const stageBalloon = style({
  width: 320,
  maxWidth: "100%",
  marginBottom: 18,
  transition: "transform 180ms ease",
  "@media": { "(prefers-reduced-motion: reduce)": { transition: "none" } },
});
export const actors = style({ display: "flex", gap: 32 });
export const demoControls = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
});
export const resting = style({
  height: 260,
  display: "flex",
  alignItems: "center",
  color: "#919987",
  fontSize: 12,
});
