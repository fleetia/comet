import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const row = style({
  display: "inline-flex",
  flexDirection: "column",
  maxWidth: "100%",
  verticalAlign: "top",
});
export const content = style({ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 });
export const leading = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 6,
  background: tokens["color/icon-tile"],
});
export const checkboxLayouts = styleVariants({
  compact: { padding: "0 4px", minHeight: 32, justifyContent: "center" },
  export: { width: 339 },
  inline: {},
  friend: { minHeight: 32, justifyContent: "center" },
  description: { width: 332 },
  control: { minHeight: 32, justifyContent: "center" },
  "inline-padded": { minHeight: 32, justifyContent: "center" },
});
export const radioLayouts = styleVariants({
  compact: { minHeight: 32, justifyContent: "center" },
  "app-usage": { width: 278 },
  date: { width: 242 },
  "date-light": { width: 242 },
  option: { width: 278 },
});
globalStyle(`${row} > span`, { width: "100%" });
globalStyle(`${row} label`, { width: "100%", boxSizing: "border-box" });
globalStyle(`${row} > span > span:last-child`, { marginLeft: 28 });
for (const layout of [radioLayouts["app-usage"], radioLayouts.option]) {
  globalStyle(`${layout} label`, { padding: "0 10px", height: 34, borderRadius: 0 });
}
for (const layout of [radioLayouts.date, radioLayouts["date-light"]]) {
  globalStyle(`${layout} label`, { height: 32, padding: "0 10px", borderRadius: 10 });
}
globalStyle(`${radioLayouts["app-usage"]} label:has(input:checked)`, {
  background: tokens["color/document-accent-soft-10"],
});
globalStyle(`${radioLayouts.date} label:has(input:checked)`, {
  background: tokens["color/component/selected-icon-alpha-140"],
});
globalStyle(`${radioLayouts["date-light"]} label:has(input:checked)`, {
  background: tokens["color/component/nav-badge"],
  boxShadow: "0 2px 4px rgba(32, 44, 96, 0.08)",
  color: tokens["color/component/calendar-block-ink"],
});
globalStyle(`${radioLayouts["date-light"]} input:checked + span[aria-hidden="true"]`, {
  borderColor: tokens["color/comet"],
});
export const selectField = style({
  display: "inline-flex",
  position: "relative",
  maxWidth: "100%",
});
export const selectLayouts = styleVariants({
  inline: {},
  compact: { minWidth: 116 },
  fill: { width: 322 },
  spaced: { width: 104 },
});
globalStyle(`${selectField} > span`, { width: "100%" });
globalStyle(`${selectField} select`, {
  height: "var(--comet-select-height)",
  width: "100%",
  minWidth: 0,
  borderRadius: 10,
});
