import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const workspace = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minHeight: 0,
  maxWidth: 1184,
});
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-16"],
  minHeight: 28,
});
export const title = style({
  margin: 0,
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const identity = style({
  display: "grid",
  gridTemplateColumns: "112px minmax(0,1fr)",
  alignItems: "center",
  width: "min(320px,100%)",
  minHeight: 28,
  gap: tokens["spacing/space-16"],
});
export const form = style({
  display: "grid",
  gap: tokens["spacing/space-12"],
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
});
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  margin: 0,
});
export const actions = style({
  display: "flex",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  flexWrap: "wrap",
  minHeight: tokens["size/control-36"],
});
export const memoriesPanel = style({
  padding: 16,
  minWidth: 0,
  minHeight: 180,
  height: 424,
  maxHeight: "100%",
  flexShrink: 1,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  overflow: "hidden",
});
export const memoriesBody = style({
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
});
export const memoryList = style({ flexShrink: 0 });
export const memoryRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 256px",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: 45,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr) 152px" } },
});
export const pagination = style({
  display: "flex",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: tokens["size/control-36"],
});
export const pageButton = style({ width: 64 });
export const recipients = style({
  display: "flex",
  gap: tokens["spacing/space-16"],
  flexWrap: "wrap",
  alignItems: "center",
  minHeight: tokens["size/control-36"],
});
export const recipientLabel = style({
  width: 160,
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 600,
});
export const recipient = style({ width: 192 });
export const assignment = style({
  flexShrink: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: 44,
});
export const assignButton = style({ width: 168 });

export const profileIdentity = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  gap: 10,
  padding: "8px 0 4px",
});
globalStyle(`${profileIdentity} h1`, {
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 26,
  lineHeight: "32px",
  fontWeight: 400,
});
export const largeAvatar = style({
  width: 104,
  height: 104,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  fontSize: 40,
  background: tokens["color/component/nav-badge"],
  color: tokens["color/ink"],
});
export const preview = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: "16px 20px",
  borderRadius: 18,
  background: tokens["color/input"],
  border: `1px dashed ${tokens["color/input-border"]}`,
});
export const nameForm = style({
  border: 0,
  padding: 16,
  margin: 0,
  minWidth: 0,
  display: "grid",
  gap: 14,
});
export const nameRow = style({ display: "flex", alignItems: "end", gap: 10, minWidth: 0 });
globalStyle(`${nameRow} > span`, { flex: 1, minWidth: 0 });
export const nameInput = style({ width: "100%" });
export const inlineConfirm = style({
  display: "grid",
  gap: 10,
  padding: 14,
  borderRadius: 16,
  background: tokens["color/glass-panel"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  boxShadow: `0 4px 12px -2px ${tokens["color/surface-shadow"]}`,
});
export const confirmActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
});
