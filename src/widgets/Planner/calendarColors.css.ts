import { style } from "@vanilla-extract/css";
import { semanticVars as v } from "@fleetia/lagrange/theme";

export const list = style({ display: "flex", flexDirection: "column", gap: 3 });
export const row = style({ display: "flex", alignItems: "center", gap: 5, minWidth: 0 });
export const name = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  fontSize: v.typography.size.label,
  lineHeight: v.typography.lineHeight.compact,
  overflowWrap: "anywhere",
});
export const connection = style({
  fontSize: v.typography.size.caption,
  color: v.color.content.secondary,
});
export const trigger = style({
  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",
  flexShrink: 0,
  width: 30,
  height: 30,
  padding: 3,
  border: 0,
  borderRadius: "50%",
  background: "transparent",
  cursor: "pointer",
  selectors: {
    "&:hover:not(:disabled)": { background: v.color.interaction.focusSurface },
    "&:focus-visible": { outline: `2px solid ${v.color.interaction.focus}`, outlineOffset: 1 },
    "&:disabled": { opacity: 0.5, cursor: "default" },
  },
});
export const swatch = style({
  width: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
  color: "#ffffff",
  fontSize: v.typography.size.caption,
  lineHeight: 1,
  fontWeight: 700,
});
export const palette = style({
  display: "flex",
  flexWrap: "wrap",
  gap: v.space.xxs,
  margin: "2px 0 6px 32px",
});
export const choice = style([
  trigger,
  {
    width: 26,
    height: 26,
    selectors: {
      '&[aria-pressed="true"]': {
        outline: `${v.border.width.hairline} solid ${v.color.content.secondary}`,
      },
    },
  },
]);
