import { style } from "@vanilla-extract/css";
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
