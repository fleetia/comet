import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import * as common from "../../lagrange.css";
import * as appearance from "../WidgetAppearance/widgetAppearance.css";

export const embedded = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gap: vars.space.sm,
  overflowWrap: "anywhere",
});
export const page = style([
  embedded,
  { padding: vars.space.lg, height: "100dvh", boxSizing: "border-box" },
]);
export const header = style({ minHeight: vars.dimension.control });
export const sectionHeader = style({
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: vars.space.md,
  paddingBottom: vars.space.sm,
  borderBottom: `4px double ${vars.color.border.strong}`,
});
export const workspace = style({
  display: "grid",
  gridTemplateColumns: "minmax(220px, 31%) minmax(0, 1fr)",
  minHeight: 0,
  flex: 1,
  gap: vars.space.lg,
});
export const catalog = style({
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.xs,
  paddingRight: vars.space.lg,
  borderRight: `1px solid ${vars.color.border.subtle}`,
});
export const filters = style({
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: vars.space.sm,
});
export const listHeading = style({
  display: "flex",
  justifyContent: "space-between",
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.typography.size.caption,
  color: vars.color.content.secondary,
  borderBottom: `1px solid ${vars.color.border.strong}`,
});
export const list = style({
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const row = style({
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  paddingLeft: vars.space.xs,
  minHeight: vars.dimension.control,
  borderBottom: `1px dotted ${vars.color.border.subtle}`,
  selectors: {
    '&[data-selected="true"]': {
      background: vars.color.selection.surface,
      boxShadow: `inset 2px 0 ${vars.color.selection.indicator}`,
    },
  },
});
export const selectEntry = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: vars.space.sm,
  width: "100%",
  minHeight: vars.dimension.control,
  padding: `${vars.space.xxs} ${vars.space.xs}`,
  border: 0,
  background: "transparent",
  color: vars.color.content.primary,
  fontFamily: vars.typography.family.ui,
  fontSize: vars.typography.size.label,
  textAlign: "start",
  cursor: "pointer",
  selectors: {
    "&:focus-visible": {
      outline: `1px solid ${vars.color.interaction.focus}`,
      outlineOffset: "-1px",
    },
  },
});
export const detail = style({
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  paddingRight: vars.space.xs,
});
export const detailHeader = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: vars.space.md,
});
export const group = style({
  display: "grid",
  gap: vars.space.sm,
  paddingTop: vars.space.sm,
  marginTop: vars.space.xs,
  borderTop: `1px solid ${vars.color.border.strong}`,
});
export const related = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
  alignItems: "center",
  gap: vars.space.sm,
  minHeight: vars.dimension.control,
});
export const settings = style({
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  display: "grid",
  gap: vars.space.sm,
});
export const metadata = style({
  display: "grid",
  gridTemplateColumns: "auto 1fr auto 1fr",
  gap: vars.space.sm,
  margin: 0,
  fontSize: vars.typography.size.caption,
});
export const remove = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderTop: `1px dotted ${vars.color.border.subtle}`,
  paddingTop: vars.space.sm,
});
export const empty = style({ padding: `${vars.space.md} 0` });
export const footer = style({
  flexShrink: 0,
  display: "grid",
  gap: vars.space.xs,
  paddingTop: vars.space.sm,
  borderTop: `4px double ${vars.color.border.strong}`,
});
export const dialogBody = style({ display: "grid", gap: vars.space.md });
globalStyle(`${settings} h2`, {
  fontSize: vars.typography.size.label,
  fontWeight: 600,
  color: vars.color.content.accent,
});
globalStyle(`${settings} p`, { fontSize: vars.typography.size.caption });
globalStyle(`${settings} section`, { minWidth: 0 });
globalStyle(`${metadata} dd`, { margin: 0, color: vars.color.content.secondary });

globalStyle(`${settings} .${common.field}`, { gap: vars.space.xxs, marginBottom: 0 });

globalStyle(`${settings} .${appearance.settings}`, { gap: vars.space.sm, padding: 0 });
globalStyle(`${settings} .${appearance.preview}`, {
  minHeight: 72,
  maxHeight: 100,
  padding: vars.space.sm,
});

export const catalogSummary = style({ display: "flex", justifyContent: "flex-end", minHeight: 0 });
