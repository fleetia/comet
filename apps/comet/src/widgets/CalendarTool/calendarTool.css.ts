import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { tokens } from "@comet/token";

export const alerts = style({
  minWidth: 0,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const alertsSummary = style({
  cursor: "pointer",
  paddingBlock: vars.space.sm,
  color: vars.color.content.primary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  fontWeight: 600,
});
globalStyle(`${alerts}[open] > summary`, { marginBottom: vars.space.md });

export const root = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
export const connectionSection = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
});
export const connectionHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
});
export const heading = style({
  margin: 0,
  fontSize: 13,
  fontWeight: 400,
  color: tokens["color/ink-2"],
});
export const connectionList = style({
  display: "flex",
  flexDirection: "column",
  gap: 10,
  selectors: { "&[hidden]": { display: "none" } },
});
export const connectionCard = style({
  padding: 14,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
  display: "flex",
  flexDirection: "column",
  gap: 8,
});
export const connectionName = style({ display: "flex", alignItems: "center", gap: 10 });
export const calendarIcon = style({
  display: "grid",
  placeItems: "center",
  width: 38,
  height: 38,
  borderRadius: tokens["radius/radius-12"],
  background: tokens["color/icon-tile"],
  color: tokens["color/icon-tile-ink"],
});
export const name = style({ margin: 0, fontSize: 13, fontWeight: 600 });
export const connectionForm = style({
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: 16,
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  background: tokens["color/card"],
  selectors: { "&[hidden]": { display: "none" } },
});
export const providerChoices = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 8,
  "@media": { "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr)" } },
});
export const readOnlyNotice = style({
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  padding: "10px 12px",
  borderRadius: tokens["radius/radius-12"],
  border: `1px solid ${tokens["color/danger-border"]}`,
  color: tokens["color/ink-2"],
});
