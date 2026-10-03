import { style } from "@vanilla-extract/css";
import { semanticVars as v, vnextVars } from "@fleetia/lagrange/theme";

export const page = style({
  display: "flex",
  flexDirection: "column",
  gap: 28,
  minWidth: 0,
  padding: "0 0 24px",
  minHeight: "100%",
  color: v.color.content.primary,
});
export const section = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  minWidth: 0,
  paddingTop: 0,
});
export const heading = style({
  margin: 0,
  fontSize: v.typography.size.headingLg,
  fontWeight: 600,
  lineHeight: v.typography.lineHeight.tight,
});
export const subheading = style({ margin: 0, fontSize: v.typography.size.label, fontWeight: 600 });
export const caption = style({
  margin: 0,
  color: v.color.content.secondary,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: v.space.sm,
  minWidth: 0,
  flexWrap: "wrap",
});
export const actions = style([row, { justifyContent: "flex-end" }]);
export const grow = style({ flex: 1, minWidth: 0 });
export const form = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  minWidth: 0,
});
export const checklist = style({ display: "flex", flexDirection: "column", gap: v.space.xs });
export const checkRow = style([row, { padding: `${v.space.xs} 0`, minHeight: 34 }]);
export const notes = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.md,
  minWidth: 0,
});
export const note = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  minWidth: 0,
  padding: v.space.md,
  borderRadius: vnextVars.radius.parent,
  background: v.color.surface.raised,
  selectors: {
    '&[data-location="envelope"]': {
      background: v.color.surface.muted,
      borderRadius: vnextVars.radius.inset,
    },
  },
});
export const noteTitle = style({ margin: 0, fontSize: v.typography.size.caption, fontWeight: 600 });
export const noteBody = style({
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});
export const textArea = style({
  width: "100%",
  minHeight: 104,
  resize: "vertical",
  boxSizing: "border-box",
  padding: v.space.sm,
  borderRadius: vnextVars.radius.control,
  border: `1px solid ${v.color.border.strong}`,
  background: v.color.surface.canvas,
  color: v.color.content.primary,
  font: "inherit",
  lineHeight: v.typography.lineHeight.body,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 2 },
  },
});
export const disclosure = style({
  display: "flex",
  flexDirection: "column",
  gap: v.space.sm,
  fontSize: v.typography.size.label,
});
export const error = style({
  margin: 0,
  color: v.color.status.critical,
  fontSize: v.typography.size.caption,
  lineHeight: v.typography.lineHeight.body,
});
export const linkList = style({
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: v.space.xs,
});
export const dateBanner = style([
  row,
  {
    padding: "18px 16px",
    minHeight: 68,
    borderRadius: vnextVars.radius.inset,
    background: v.color.surface.muted,
  },
]);
export const columns = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
  gap: 32,
  minHeight: 390,
  "@media": { "(max-width: 1080px)": { gridTemplateColumns: "minmax(0,1fr)", gap: 24 } },
});
export const column = style({ display: "flex", flexDirection: "column", gap: 28, minWidth: 0 });
export const related = style([
  section,
  { paddingTop: 20, borderTop: `1px solid ${v.color.border.subtle}`, marginTop: "auto" },
]);
export const footer = style([row, { justifyContent: "space-between", paddingTop: 12 }]);
