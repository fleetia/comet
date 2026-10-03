import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const panel = style({
  height: 270,
  minHeight: 132,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
});
export const heading = style({
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
  flexShrink: 0,
});
export const title = style({
  margin: 0,
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const caption = style({
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  overflowWrap: "anywhere",
});
export const item = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  flexShrink: 0,
});
export const controls = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 208px 96px 200px",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: 64,
  "@media": {
    "(max-width: 1400px)": { gridTemplateColumns: "minmax(0,1fr) 96px 160px" },
    "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr) 80px 128px", gap: vars.space.md },
  },
});
export const copy = style({ display: "grid", gap: vars.space.xs, minWidth: 0 });
export const itemTitle = style({
  margin: 0,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const status = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  minHeight: vars.dimension.row,
  display: "flex",
  alignItems: "center",
  "@media": {
    "(max-width: 1400px)": {
      gridColumn: 1,
      gridRow: 2,
      marginTop: `calc(-1 * ${vars.space.md})`,
    },
  },
});
export const checkbox = style({
  width: 96,
  "@media": {
    "(max-width: 1400px)": { gridColumn: 2, gridRow: "1 / 3" },
    "(max-width: 1000px)": { width: 80 },
  },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.sm,
  "@media": { "(max-width: 1400px)": { gridColumn: 3, gridRow: "1 / 3" } },
});
export const action = style({ width: "100%" });
export const boundary = style({ height: 1, flexShrink: 0, background: vars.color.border.subtle });
export const queue = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
  minHeight: vars.dimension.control,
  flexShrink: 0,
});
export const retry = style({ width: 264, "@media": { "(max-width: 1400px)": { width: 200 } } });
export const confirmation = style({ display: "flex", flexDirection: "column", gap: vars.space.sm });
export const confirmationActions = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.lg,
});
