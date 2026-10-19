import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const scene = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "16px 14px 12px",
  borderRadius: 18,
  background: tokens["color/input"],
  border: `1px dashed ${tokens["color/card-border"]}`,
});
export const firstBalloon = style({
  width: 248,
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
});
export const sceneCharacters = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 18px 0",
});
export const byul = style({ position: "relative", display: "block", width: 72, height: 72 });
export const byulBody = style({ position: "absolute", top: "12.5%", left: "20.31%" });
export const byulFace = style({ position: "absolute", top: "23.44%", left: "12.5%" });
export const note = style({
  margin: 0,
  paddingTop: 14,
  borderTop: `1px solid ${tokens["color/divider"]}`,
  color: tokens["color/ink-2"],
  fontSize: 12.5,
  lineHeight: "18px",
});
export const installedCard = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
  minHeight: 74,
  padding: "12px 14px 12px 16px",
  background: tokens["color/card"],
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
});
export const packCopy = style({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 0,
  font: "inherit",
  color: tokens["color/ink"],
  textAlign: "left",
  background: "transparent",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 3,
      borderRadius: 6,
    },
  },
});
