import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { semanticVars as v, vnextVars } from "@fleetia/lagrange/theme";

export const page = style({
  display: "flex",
  flexDirection: "column",
  gap: 18,
  minWidth: 0,
  padding: "20px 22px",
  borderRadius: tokens["radius/radius-20"],
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card-2"],
  color: tokens["color/ink"],
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
export const subheading = style({
  margin: 0,
  fontSize: 13,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
  fontWeight: 600,
});
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
export const checkRow = style([
  row,
  { padding: "6px 12px", minHeight: 40, boxSizing: "border-box" },
]);
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
export const storedNotePreview = style([
  noteBody,
  {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
]);
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
  gap: 18,
  "@media": { "(max-width: 980px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const column = style({ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 });
export const related = style([section, { gap: 4 }]);
export const footer = style([row, { justifyContent: "space-between", paddingTop: 12 }]);

export const itemTitle = style({
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
  caption,
  { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
]);

export const desktopMemoPreview = style({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  justifyContent: "flex-start",
});

export const listCard = style({
  padding: 0,
  overflow: "hidden",
  boxShadow: "none",
  borderRadius: tokens["radius/radius-16"],
});
export const listItem = style({
  selectors: { "& + &": { borderTop: `1px solid ${tokens["color/divider"]}` } },
});
export const archivePrompt = style({
  padding: "12px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  boxShadow: "none",
});
export const envelopeGroups = style({ display: "flex", flexDirection: "column", gap: 10 });
export const envelopeGroup = style({
  display: "flex",
  flexDirection: "column",
  gap: 8,
  scrollMarginTop: 8,
});
export const envelopeCard = style({ width: "100%" });
export const createForm = style({ display: "flex", flexDirection: "column", gap: 10 });
export const createField = style({
  display: "grid",
  gridTemplateColumns: "76px minmax(0,1fr)",
  alignItems: "center",
  gap: 12,
  minHeight: 34,
});
export const createLabel = style({
  textAlign: "right",
  fontSize: 13,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
});
export const createControl = style({
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
});
