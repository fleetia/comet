import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const workspace = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minHeight: 0,
  maxWidth: 1184,
});
export const namePanel = style({
  width: "100%",
  maxWidth: 792,
  height: 296,
  maxHeight: "100%",
  flexShrink: 0,
  overflowY: "auto",
});
export const nameBody = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minHeight: 264,
});
export const heading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
  minHeight: 28,
});
export const title = style({
  margin: 0,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const identity = style({
  display: "grid",
  gridTemplateColumns: "112px minmax(0,1fr)",
  alignItems: "center",
  width: "min(320px,100%)",
  minHeight: 28,
  gap: vars.space.lg,
});
export const identityName = style({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: vars.typography.size.label,
  fontWeight: 600,
});
export const form = style({
  display: "grid",
  gap: vars.space.md,
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
});
export const nameField = style({ maxWidth: 720 });
export const caption = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  margin: 0,
});
export const actions = style({
  display: "flex",
  gap: vars.space.lg,
  alignItems: "center",
  flexWrap: "wrap",
  minHeight: vars.dimension.control,
});
export const nameAction = style({ width: 112 });
export const memoriesPanel = style({
  minWidth: 0,
  minHeight: 180,
  height: 424,
  maxHeight: "100%",
  flexShrink: 1,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  overflow: "hidden",
});
export const memoriesBody = style({
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const memoryList = style({ flexShrink: 0 });
export const memoryRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 256px",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: 45,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr) 152px" } },
});
export const pagination = style({
  display: "flex",
  gap: vars.space.lg,
  alignItems: "center",
  minHeight: vars.dimension.control,
});
export const pageButton = style({ width: 64 });
export const recipients = style({
  display: "flex",
  gap: vars.space.lg,
  flexWrap: "wrap",
  alignItems: "center",
  minHeight: vars.dimension.control,
});
export const recipientLabel = style({
  width: 160,
  fontSize: vars.typography.size.label,
  fontWeight: 600,
});
export const recipient = style({ width: 192 });
export const assignment = style({
  flexShrink: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.lg,
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
  boxShadow: `0 10px 30px ${tokens["color/surface-shadow"]}`,
});
export const confirmActions = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
});
