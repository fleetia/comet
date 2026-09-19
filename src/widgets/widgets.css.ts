import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const page = style({
  maxWidth: 960,
  margin: "0 auto",
  padding: vars.space.xl,
  minHeight: "100dvh",
  "@media": { "(max-width: 480px)": { padding: vars.space.lg } },
});
export const header = style({ marginBottom: vars.space.lg });
export const filters = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.sm,
  margin: `${vars.space.md} 0`,
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.md,
  padding: `${vars.space.md} 0`,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  flexWrap: "wrap",
});
export const details = style({
  flex: "1 1 280px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xxs,
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.sm,
});
export const nameRow = style({
  display: "flex",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: vars.space.sm,
});
export const selection = style({
  display: "flex",
  gap: vars.space.sm,
  alignItems: "center",
  fontSize: vars.typography.size.body,
  fontWeight: 600,
  color: vars.color.content.accent,
});
export const status = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
});
export const footer = style({
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  background: vars.color.surface.canvas,
  paddingBottom: vars.space.sm,
  marginTop: vars.space.lg,
  display: "grid",
  gap: vars.space.sm,
});
export const category = style({ marginTop: vars.space.xl });
export const categoryTitle = style({
  fontFamily: vars.typography.family.display,
  fontSize: vars.typography.size.headingSm,
  color: vars.color.content.accent,
  paddingBottom: vars.space.sm,
  borderBottom: `1px solid ${vars.color.border.strong}`,
});
export const count = style({
  fontFamily: vars.typography.family.data,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
});
export const help = style({
  fontSize: vars.typography.size.label,
  color: vars.color.content.secondary,
  lineHeight: vars.typography.lineHeight.body,
  padding: `${vars.space.sm} 0`,
});
export const empty = style({
  display: "grid",
  justifyItems: "start",
  gap: vars.space.md,
  padding: `${vars.space.xl} 0`,
  color: vars.color.content.secondary,
});
export const previewNote = style({
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  marginBottom: vars.space.md,
});
export const dialogBody = style({ display: "flex", flexDirection: "column", gap: vars.space.md });

export const filterButton = style({
  selectors: {
    '&[aria-pressed="true"]': {
      color: vars.color.content.accent,
      background: vars.color.selection.surface,
      borderBottomColor: vars.color.selection.indicator,
      borderBottomStyle: "solid",
    },
  },
});
