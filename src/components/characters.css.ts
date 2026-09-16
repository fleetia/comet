import { style } from "@vanilla-extract/css";
import { semanticVars } from "@fleetia/lagrange/theme";
export const page = style({
  maxWidth: 1100,
  margin: "0 auto",
  padding: `${semanticVars.space.xl} ${semanticVars.space.xl} ${semanticVars.space.xxl}`,
  background: semanticVars.color.surface.canvas,
  minHeight: "100dvh",
});
export const header = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: semanticVars.space.lg,
  marginBottom: semanticVars.space.lg,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "190px minmax(0,1fr)",
  gap: semanticVars.space.xl,
  "@media": { "(max-width: 650px)": { gridTemplateColumns: "1fr" } },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: semanticVars.space.xxs,
  alignSelf: "start",
  position: "sticky",
  top: 16,
  "@media": { "(max-width: 650px)": { position: "static" } },
});
export const item = style({
  width: "100%",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 0,
  padding: `${semanticVars.space.sm} ${semanticVars.space.xs}`,
  border: "1px solid transparent",
  borderRadius: semanticVars.shape.radius.none,
  textAlign: "left",
  background: "transparent",
  overflowWrap: "anywhere",
  selectors: {
    '&[aria-pressed="true"]': {
      color: semanticVars.color.content.primary,
      background: semanticVars.color.selection.surface,
      borderColor: semanticVars.color.selection.indicator,
      borderBottomStyle: "solid",
    },
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      background: semanticVars.color.selection.surface,
    },
  },
});
export const small = style({
  display: "block",
  marginTop: semanticVars.space.xxs,
  color: semanticVars.color.content.secondary,
  fontSize: semanticVars.typography.size.caption,
});
export const section = style({
  margin: `${semanticVars.space.lg} 0`,
  paddingTop: semanticVars.space.md,
  borderTop: `1px solid ${semanticVars.color.border.subtle}`,
});
export const subheading = style({
  fontFamily: semanticVars.typography.family.display,
  color: semanticVars.color.content.accent,
  lineHeight: semanticVars.typography.lineHeight.compact,
  fontSize: semanticVars.typography.size.headingSm,
  fontWeight: 600,
  marginBottom: semanticVars.space.sm,
});
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const textarea = style({ minHeight: 66 });
export const expressions = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: semanticVars.space.md,
  "@media": { "(max-width: 500px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } },
});
export const line = style({ paddingBottom: 12 });
export const workspace = style({
  minWidth: 0,
  marginTop: semanticVars.space.lg,
});
export const tabIntro = style({
  color: semanticVars.color.content.secondary,
  fontSize: semanticVars.typography.size.caption,
  marginBottom: semanticVars.space.md,
});
export const saveBar = style({
  position: "sticky",
  bottom: 0,
  background: semanticVars.color.surface.canvas,
  padding: `0 0 ${semanticVars.space.sm}`,
  display: "grid",
  gap: semanticVars.space.sm,
  marginTop: semanticVars.space.lg,
});
export const saveActions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: semanticVars.space.sm,
});
export const preview = style({
  padding: `${semanticVars.space.md} 0`,
  display: "flex",
  flexDirection: "column",
  gap: semanticVars.space.md,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const notice = style({
  margin: `${semanticVars.space.md} 0`,
  padding: semanticVars.space.md,
  background: semanticVars.color.surface.muted,
  fontSize: semanticVars.typography.size.label,
  lineHeight: semanticVars.typography.lineHeight.body,
});

export const disclosureSummary = style({
  padding: `${semanticVars.space.sm} 0`,
  color: semanticVars.color.content.accent,
  fontSize: semanticVars.typography.size.label,
  fontWeight: 600,
  cursor: "pointer",
  ":focus-visible": {
    outline: `1px solid ${semanticVars.color.interaction.focus}`,
    outlineOffset: 2,
  },
});
