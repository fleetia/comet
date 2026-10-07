import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const page = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  gap: v.space.xl,
  paddingBottom: v.space.xl,
});

export const log = style({
  listStyle: "none",
  padding: 0,
  margin: 0,
});

export const heading = style({
  margin: `0 0 ${v.space.lg}`,
  fontSize: v.typography.size.headingSm,
  fontWeight: 600,
  lineHeight: v.typography.lineHeight.compact,
});

export const appointments = style({ display: "grid", gap: v.space.sm });
export const appointment = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: v.space.md,
  minHeight: 64,
});
export const records = style({ minWidth: 0 });

export const line = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  minWidth: 0,
  padding: `${v.space.xs} 0`,
  minHeight: 45,
});

export const rowActions = style({
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
  gap: v.space.xs,
  opacity: 0,
  selectors: {
    [`${line}:hover &`]: { opacity: 1 },
    [`${line}:focus-within &`]: { opacity: 1 },
  },
  "@media": { "(hover: none)": { opacity: 1 } },
});

export const entryText = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  minWidth: 0,
});
export const moved = style({
  display: "flex",
  flex: 1,
  minWidth: 0,
  alignItems: "center",
  flexWrap: "wrap",
  gap: v.space.lg,
});

export const bullet = style({
  flex: "0 0 18px",
  textAlign: "center",
  lineHeight: "28px",
  color: v.color.content.secondary,
});

export const content = style({ minWidth: 0, flex: 1 });

export const row = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: v.space.sm,
  minWidth: 0,
});

export const title = style({
  fontSize: v.typography.size.body,
  lineHeight: v.typography.lineHeight.body,
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
});

export const task = style({ minWidth: 0, flex: 1 });
globalStyle(`${task} label`, { overflowWrap: "anywhere" });

export const completed = style({
  textDecoration: "line-through",
  color: v.color.content.secondary,
});

export const meta = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});

export const controls = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: v.space.sm,
  marginTop: v.space.xs,
});

export const writing = style({
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  minHeight: 32,
  padding: `${v.space.xs} ${v.space.xs}`,
  border: "1px solid transparent",
  borderRadius: v.shape.radius.subtle,
  background: "transparent",
  color: v.color.content.primary,
  fontFamily: v.typography.family.ui,
  fontSize: v.typography.size.body,
  lineHeight: 1.75,
  resize: "none",
  overflow: "hidden",
  selectors: {
    "&:hover:not(:disabled)": { background: v.color.surface.muted },
    "&:focus": {
      outline: `1px solid ${v.color.interaction.focus}`,
      outlineOffset: 1,
      background: v.color.surface.raised,
    },
    "&::placeholder": { color: v.color.content.secondary },
    "&:disabled": { color: v.color.content.secondary },
  },
});

export const time = style({ width: 100, minWidth: 100 });
export const date = style({ width: 152, minWidth: 130 });

export const composer = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  minWidth: 0,
  paddingTop: v.space.md,
});

export const composerBody = style({ minHeight: 76 });

export const kinds = style({
  display: "flex",
  flexWrap: "wrap",
  gap: v.space.xs,
});

export const spacer = style({ flex: 1 });

export const error = style({
  color: v.color.status.critical,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});

export const empty = style({
  color: v.color.content.secondary,
  fontSize: v.typography.size.body,
  lineHeight: 1.75,
  margin: `${v.space.lg} 0`,
});

export const envelope = style({ textAlign: "left", whiteSpace: "normal", maxWidth: "100%" });

export const addLine = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.md,
  width: "100%",
  minHeight: 52,
  background: "transparent",
  border: 0,
  borderRadius: v.shape.radius.subtle,
  padding: `${v.space.sm} 0`,
  color: v.color.content.secondary,
  font: "inherit",
  fontSize: v.typography.size.body,
  textAlign: "left",
  cursor: "text",
  selectors: {
    "&:hover": { background: v.color.surface.muted },
    "&:focus-visible": { outline: `1px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});

export const footer = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: v.space.md,
  marginTop: v.space.lg,
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
});

export const taskTitle = style({
  flex: 1,
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  padding: `${v.space.xs} 0`,
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});
export const memoPreview = style([
  meta,
  { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 },
]);
