import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const meta = style({
  marginLeft: "auto",
  color: tokens["color/ink-3"],
  fontSize: 11.5,
  lineHeight: "15px",
  whiteSpace: "nowrap",
});
export const status = style({
  margin: 0,
  color: tokens["color/ink-2"],
  fontSize: 12.5,
  lineHeight: "18px",
});
export const alert = style([status, { color: tokens["color/primary"], fontWeight: 600 }]);
export const headline = style([status, { color: tokens["color/ink"], fontWeight: 600 }]);
export const wide = style({ flex: 1, width: "100%" });
export const art = style({ display: "block", width: "100%", height: "auto" });
export const centered = style({ display: "grid", placeItems: "center" });

export const catches = style({
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 6,
  margin: 0,
  padding: 0,
  listStyle: "none",
});
export const catchCell = style({
  display: "grid",
  justifyItems: "center",
  alignContent: "center",
  gap: 2,
  height: 64,
  borderRadius: tokens["radius/radius-12"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  background: tokens["color/card"],
  color: tokens["color/ink-2"],
  fontSize: 11.5,
  lineHeight: "15px",
});
export const catchIcon = style({ color: tokens["color/cat-record"] });
export const catchCount = style({ color: tokens["color/ink-3"], fontSize: 10.5 });
export const unknownCell = style([
  catchCell,
  { borderStyle: "dashed", background: "transparent", color: tokens["color/ink-3"] },
]);

export const water = style({ display: "flex", alignItems: "center", gap: 8 });
export const waterTrack = style({ display: "flex", gap: 4 });
export const waterDrop = style({
  width: 22,
  height: 6,
  borderRadius: tokens["radius/radius-pill"],
  background: tokens["color/track"],
  selectors: { '&[data-filled="true"]': { background: tokens["color/cat-focus"] } },
});
export const chip = style({
  alignSelf: "flex-start",
  padding: "3px 10px",
  borderRadius: tokens["radius/radius-pill"],
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: tokens["color/chip"],
  color: tokens["color/ink-2"],
  fontSize: 11.5,
  lineHeight: "15px",
});

export const jarHeader = style({ display: "flex", alignItems: "center", gap: 8 });
export const jarCount = style({
  marginLeft: "auto",
  color: tokens["color/ink"],
  fontSize: 22,
  fontWeight: 300,
  lineHeight: "26px",
  fontVariantNumeric: "tabular-nums",
});
export const jarBody = style({ display: "flex", alignItems: "center", gap: 12 });
export const jar = style({ width: 96, height: 86, flexShrink: 0 });
export const recent = style({
  margin: 0,
  minWidth: 0,
  color: tokens["color/ink-2"],
  fontSize: 12,
  lineHeight: "17px",
});

export const battery = style({ display: "flex", alignItems: "center", gap: 14 });
export const batteryValue = style({
  color: tokens["color/ink"],
  fontSize: 28,
  fontWeight: 300,
  lineHeight: "34px",
  fontVariantNumeric: "tabular-nums",
});
export const batteryIcon = style({ width: 44, height: 22, flexShrink: 0 });

export const cups = style({ display: "flex", justifyContent: "center", gap: 26, paddingTop: 14 });
export const cup = style({
  display: "grid",
  justifyItems: "center",
  gap: 6,
  padding: 0,
  border: 0,
  background: "transparent",
  color: tokens["color/ink-2"],
  fontSize: 12,
  cursor: "pointer",
  selectors: {
    "&:disabled": { cursor: "default", opacity: 0.6 },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 4 },
  },
});
export const guessForm = style({ display: "flex", gap: 8, width: "100%" });
globalStyle(`${guessForm} > :first-child`, { flex: 1, minWidth: 0 });
export const guessMeta = style({
  display: "flex",
  justifyContent: "space-between",
  width: "100%",
  color: tokens["color/ink-3"],
  fontSize: 11.5,
  lineHeight: "15px",
});
export const hintChip = style([chip, { alignSelf: "center" }]);
export const companionRow = style({ display: "flex", alignItems: "center", gap: 12 });
