import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const window = style([
  {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100dvh",
    minHeight: 0,
    borderRadius: 9,
    backgroundColor: tokens["color/glass-window"],
  },
]);
export const header = style({
  flexShrink: 0,
  height: 60,
  boxSizing: "border-box",
  padding: "0 20px",
  borderBottom: `1px solid ${tokens["color/card-border"]}`,
});
globalStyle(`${header} > div`, { gap: 16 });
export const title = style({
  display: "flex",
  alignItems: "center",
  height: "100%",
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 17,
  fontWeight: 400,
  lineHeight: "22px",
});
export const search = style({ width: 240 });
globalStyle(`${search} > span`, { width: "100%" });
export const searchInput = style({
  width: "100%",
  padding: "0 12px",
  borderColor: tokens["color/input-border"],
  background: tokens["color/input"],
});
globalStyle(`${searchInput} > svg`, { width: 15, height: 15 });
globalStyle(`${searchInput} input::placeholder`, { color: tokens["color/ink"] });
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
export const filters = style({
  flexShrink: 0,
  overflowX: "auto",
  maxWidth: "100%",
  borderRadius: 17,
});
globalStyle(`${filters} > label`, { fontSize: 12 });
export const sessions = style({
  display: "flex",
  flexDirection: "column",
  gap: 2,
  overflowY: "auto",
  minHeight: 0,
  flex: 1,
  margin: "0 -6px",
  padding: "0 6px",
});
export const day = style({
  margin: 0,
  padding: "10px 12px 2px",
  color: tokens["color/ink-3"],
  fontSize: 12,
  fontWeight: 400,
  flexShrink: 0,
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
  margin: 0,
  flexShrink: 0,
  borderRadius: 9,
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
export const listAvatar = style({ width: 34, height: 34, borderRadius: 11 });
globalStyle(`${listAvatar} img`, { width: 29, height: 29 });
export const headerAvatar = style({ width: 40, height: 40, borderRadius: 13 });
globalStyle(`${headerAvatar} img`, { width: 34, height: 34 });
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
export const detailHeading = style({
  margin: 0,
  fontSize: 15,
  lineHeight: "19px",
  fontWeight: 600,
});
export const detailCopy = style({ gap: 2 });
export const settingsButton = style({ fontWeight: 400 });
export const meta = style({
  margin: 0,
  color: tokens["color/ink-3"],
  fontSize: 12,
  lineHeight: "16px",
});
export const time = style({
  color: tokens["color/ink-3"],
  fontSize: 11,
  lineHeight: "14px",
  whiteSpace: "nowrap",
  flexShrink: 0,
});
export const sessionTime = style({ fontSize: 11.5, lineHeight: "normal" });
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
  borderRadius: 9,
  background: tokens["color/chip"],
  color: tokens["color/ink-2"],
  fontSize: 12,
});
export const message = style({ display: "flex", alignItems: "center", gap: 10 });
export const messageBlock = style({
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: "100%",
  flexShrink: 0,
});
export const followUps = style({ paddingLeft: 46, maxWidth: "100%", overflowX: "auto" });
export const memoryReceipts = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  paddingLeft: 46,
});
export const userMemoryReceipts = style({ alignItems: "flex-end", paddingLeft: 0 });
export const memoryReceipt = style({
  minHeight: 28,
  height: "auto",
  maxWidth: "100%",
  padding: "4px 10px",
  borderRadius: 13,
  gap: 6,
  fontSize: 12,
  fontWeight: 400,
  lineHeight: "18px",
  textAlign: "left",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  color: tokens["color/document/live-chip-label"],
  borderColor: tokens["color/document/live-chip-border"],
  background: tokens["color/document/live-chip-background"],
});
export const userMessage = style({ justifyContent: "flex-end" });
export const messageContent = style({
  position: "relative",
  maxWidth: 460,
  minWidth: 0,
});
export const userMessageContent = style({ maxWidth: 420 });
export const bubble = style({
  margin: 0,
  padding: "8px 14px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: "9px 9px 9px 6px",
  background: tokens["color/card"],
  color: tokens["color/ink"],
  fontSize: 14,
  lineHeight: "20px",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const userBubble = style({
  borderRadius: "9px 9px 6px 9px",
  borderColor: "rgb(255 204 51 / 0.35)",
  background: tokens["color/component/primary-alpha-160"],
});
export const messageLabel = style({ color: tokens["color/ink-3"], fontSize: 11 });
export const messageTools = style({
  position: "absolute",
  zIndex: 2,
  top: "calc(100% + 4px)",
  left: 0,
  width: "max-content",
  maxWidth: 300,
  overflowWrap: "anywhere",
  padding: "6px 10px",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 10,
  background: tokens["color/glass-window"],
  opacity: 0,
  pointerEvents: "none",
  selectors: {
    [`${message}:hover &, ${message}:focus-within &, &:has(details[open])`]: {
      opacity: 1,
      pointerEvents: "auto",
    },
  },
  "::before": { content: '""', position: "absolute", top: -5, left: 0, right: 0, height: 5 },
});
export const userMessageTools = style({ left: "auto", right: 0 });
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
  margin: 0,
  minHeight: 44,
  borderRadius: 22,
  boxSizing: "border-box",
  padding: "5px 5px 5px 15px",
  background: tokens["color/input"],
  borderColor: tokens["color/input-border"],
  gap: 8,
  boxShadow: "none",
  backdropFilter: "none",
});
globalStyle(`${capsule} textarea`, { minHeight: 20, maxHeight: 120 });
globalStyle(`${capsule} textarea::placeholder`, { color: tokens["color/ink"] });
export const actions = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 });
export const empty = style({ color: tokens["color/ink-2"], padding: 24, margin: 0 });
export const error = style({
  color: tokens["color/danger"],
  margin: 0,
  fontSize: 12,
  whiteSpace: "pre-wrap",
});
export const save = style({ margin: "0 24px 12px", maxHeight: "50vh", overflowY: "auto" });
