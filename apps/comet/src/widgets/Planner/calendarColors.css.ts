import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const list = style({ display: "flex", flexDirection: "column", gap: 3 });
export const row = style({ display: "flex", alignItems: "center", gap: 5, minWidth: 0 });
export const name = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
  overflowWrap: "anywhere",
});
export const connection = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  color: tokens["color/ink-2"],
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
    "&:hover:not(:disabled)": { background: tokens["color/hover"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
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
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: 1,
  fontWeight: 700,
});
export const palette = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-4"],
  margin: "2px 0 6px 32px",
});
export const choice = style([
  trigger,
  {
    width: 26,
    height: 26,
    selectors: {
      '&[aria-pressed="true"]': {
        outline: `1px solid ${tokens["color/ink-2"]}`,
      },
    },
  },
]);
