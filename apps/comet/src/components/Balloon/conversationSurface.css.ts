import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const inputHost = style({
  width: 340,
  maxHeight: 520,
  overflowY: "auto",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
});
export const inputContents = style({ width: "100%" });
export const inputActions = style({
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "4px 14px 0",
  fontSize: 12,
});
export const more = style({ fontSize: 12 });
export const moreSummary = style({
  width: "max-content",
  margin: "0 auto",
  padding: "4px 8px",
  color: tokens["color/ink-2"],
  cursor: "pointer",
});
export const optionsPanel = style({
  marginTop: 4,
  padding: "8px 0",
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: 18,
  background: tokens["color/glass-panel"],
  backdropFilter: "blur(12px)",
});
export const responseHost = style({
  boxSizing: "border-box",
  width: 340,
  paddingBottom: 12,
  color: tokens["color/ink"],
});
export const responseBubble = style({ width: "100%", minHeight: 78 });
export const responseText = style({
  maxHeight: 360,
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: 1.65,
});
export const responseSource = style({
  display: "block",
  marginTop: 8,
  color: tokens["color/ink-3"],
  fontSize: 11,
  lineHeight: "16px",
});
