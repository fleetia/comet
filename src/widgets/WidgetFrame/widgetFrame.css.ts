import { style, styleVariants } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

const window = style({
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  minWidth: 0,
  overflow: "hidden",
  color: vars.color.content.primary,
});
export const frame = styleVariants({
  tool: [window, { background: vars.color.surface.canvas }],
  note: [window, { background: vars.color.surface.raised }],
});
export const fixedHeader = style({ flexShrink: 0 });
export const header = styleVariants({
  tool: {
    padding: vars.space.lg,
  },
  note: {
    padding: `${vars.space.xs} ${vars.space.sm}`,
    background: vars.color.surface.muted,
    borderBottom: `1px solid ${vars.color.border.subtle}`,
  },
});
export const title = styleVariants({
  tool: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: vars.color.content.accent,
    fontFamily: vars.typography.family.display,
    fontSize: vars.typography.size.headingMd,
    lineHeight: vars.typography.lineHeight.tight,
  },
  note: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: vars.typography.size.caption,
    fontWeight: "normal",
    lineHeight: "28px",
    color: vars.color.content.secondary,
  },
});
export const status = style({
  marginBottom: vars.space.sm,
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
});
const body = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const content = styleVariants({
  tool: [body, { padding: `${vars.space.sm} ${vars.space.lg} ${vars.space.lg}` }],
  note: [body, { display: "flex", flexDirection: "column" }],
});
const actionArea = style({
  display: "flex",
  flexShrink: 0,
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: vars.space.sm,
});
export const footer = styleVariants({
  tool: [actionArea, { padding: `${vars.space.md} ${vars.space.lg} ${vars.space.lg}` }],
  note: [actionArea, { padding: `${vars.space.xs} ${vars.space.sm} ${vars.space.sm}` }],
});
