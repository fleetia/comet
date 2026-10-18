import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const window = style({
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100dvh",
  minHeight: 0,
  borderRadius: 22,
  backgroundColor: tokens["color/glass-window"],
});
export const header = style({
  flexShrink: 0,
  height: 60,
  boxSizing: "border-box",
  padding: "0 20px",
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
export const title = style({
  display: "flex",
  alignItems: "center",
  height: "100%",
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 17,
  fontWeight: 400,
});
export const search = style({ width: 240 });
export const columns = style({
  display: "grid",
  gridTemplateColumns: "340px minmax(0, 1fr)",
  flex: 1,
  minHeight: 0,
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "280px minmax(0, 1fr)" } },
});
export const sidebar = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 0,
  padding: "16px 14px",
  borderRight: `1px solid ${tokens["color/card-border"]}`,
});
export const filters = style({ flexShrink: 0, overflowX: "auto", maxWidth: "100%" });
export const sessions = style({ overflowY: "auto", minHeight: 0, flex: 1 });
export const day = style({
  margin: 0,
  padding: "12px 12px 4px",
  color: tokens["color/ink-3"],
  fontSize: 12,
  fontWeight: 400,
});
export const session = style({
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  gap: 10,
  width: "100%",
  height: "auto",
  minHeight: 60,
  padding: "10px 12px",
  margin: "2px 0",
  borderRadius: 14,
  textAlign: "left",
  whiteSpace: "normal",
});
export const sessionCopy = style({
  display: "flex",
  flexDirection: "column",
  gap: 3,
  minWidth: 0,
  flex: 1,
});
export const sessionHeading = style({ display: "flex", alignItems: "baseline", gap: 8 });
export const sessionName = style({
  color: tokens["color/ink"],
  fontWeight: 600,
  fontSize: 13.5,
  flex: 1,
});
export const preview = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12.5,
  lineHeight: "17px",
  color: tokens["color/ink-2"],
});
export const avatar = style({
  display: "grid",
  placeItems: "center",
  width: 36,
  height: 36,
  flexShrink: 0,
  borderRadius: 12,
  background: tokens["color/component/cat-rest-alpha-160"],
  color: tokens["color/cat-rest"],
  fontSize: 14,
});
export const avatarImage = style({ width: 31, height: 31, objectFit: "contain" });
export const detail = style({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  minWidth: 0,
});
export const detailHeader = style({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 24px",
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
export const detailHeading = style({ margin: 0, fontSize: 14, fontWeight: 600 });
export const meta = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
});
export const time = style({
  color: tokens["color/ink-3"],
  fontSize: 11,
  whiteSpace: "nowrap",
  flexShrink: 0,
});
export const log = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
  padding: "20px 24px",
});
export const context = style({
  margin: 0,
  padding: "4px 12px",
  border: `1px solid ${tokens["color/chip-border"]}`,
  borderRadius: 12,
  background: tokens["color/chip"],
  color: tokens["color/ink-2"],
  fontSize: 12,
});
export const message = style({ display: "flex", alignItems: "center", gap: 10 });
export const userMessage = style({ justifyContent: "flex-end" });
export const messageContent = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 4,
  maxWidth: "min(460px, 76%)",
  minWidth: 0,
});
export const bubble = style({
  margin: 0,
  padding: "8px 14px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: "16px 16px 16px 6px",
  background: tokens["color/card"],
  color: tokens["color/ink"],
  fontSize: 14,
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const userBubble = style({
  borderRadius: "16px 16px 6px 16px",
  borderColor: tokens["color/selected-border"],
  background: tokens["color/component/primary-alpha-160"],
});
export const messageLabel = style({ color: tokens["color/ink-3"], fontSize: 11 });
export const composer = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 6,
  padding: "12px 24px 16px",
  borderTop: `1px solid ${tokens["color/card-border"]}`,
});
export const capsule = style({
  width: "100%",
  minHeight: 44,
  borderRadius: 22,
  boxSizing: "border-box",
  padding: "6px 6px 6px 16px",
  background: tokens["color/input"],
  borderColor: tokens["color/input-border"],
});
globalStyle(`${capsule} textarea`, { minHeight: 20, maxHeight: 120 });
export const actions = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 });
export const empty = style({ color: tokens["color/ink-2"], padding: 24, margin: 0 });
export const error = style({
  color: tokens["color/danger"],
  margin: 0,
  fontSize: 12,
  whiteSpace: "pre-wrap",
});
export const save = style({ margin: "0 24px 12px", maxHeight: "50vh", overflowY: "auto" });
