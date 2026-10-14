import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars, vnextVars } from "@fleetia/lagrange/theme";
import * as appearanceStyles from "../WidgetAppearance/widgetAppearance.css";

export const settings = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  maxWidth: 840,
  height: "100%",
  padding: 0,
  overflow: "hidden",
  borderRadius: vnextVars.radius.parent,
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  gap: vars.space.lg,
  padding: vars.space.lg,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
globalStyle(`${body} > *`, { flexShrink: 0 });

export const primary = style({ display: "grid", minWidth: 0, gap: vars.space.md });
export const fields = style({ border: 0, margin: 0, padding: 0, minWidth: 0 });
export const secondary = style({
  display: "grid",
  minWidth: 0,
  gap: vars.space.md,
  paddingTop: vars.space.lg,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const disclosure = style({
  display: "flex",
  width: "100%",
  justifyContent: "flex-start",
  gap: vars.space.sm,
  paddingInline: 0,
  textAlign: "left",
});
export const disclosureHint = style({ marginLeft: "auto", fontWeight: 400 });
export const appearance = style({ minWidth: 0 });
globalStyle(`${appearance}[hidden]`, { display: "none" });
globalStyle(`${appearance} .${appearanceStyles.settings}`, { flex: "none" });
globalStyle(`${appearance} .${appearanceStyles.body}`, { flex: "none", overflow: "visible" });

export const observation = style({
  minWidth: 0,
  paddingTop: vars.space.md,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
export const observationSummary = style({
  cursor: "pointer",
  color: vars.color.content.secondary,
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  paddingBlock: vars.space.sm,
});
export const actions = style({
  flexShrink: 0,
  minWidth: 0,
  padding: vars.space.lg,
  borderTop: `${vars.border.width.hairline} solid ${vars.color.border.subtle}`,
});
globalStyle(`${actions}[hidden]`, { display: "none" });
