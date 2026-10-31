import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const dialog = style({
  boxSizing: "border-box",
  width: "calc(100% - 32px)",
  maxHeight: "calc(100dvh - 32px)",
  margin: "auto",
  padding: 0,
  overflow: "hidden",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
  border: `1px solid ${tokens["color/glass-border"]}`,
  background: tokens["color/glass-panel"],
  backdropFilter: "blur(24px)",
  boxShadow: `inset 0 1px 0 ${tokens["color/surface-highlight"]}, 0 4px 12px -2px ${tokens["color/surface-shadow"]}`,
  selectors: {
    "&:not([open])": { display: "none" },
    "&::backdrop": { background: tokens["color/scrim"] },
  },
});
globalStyle(`${dialog} *, ${dialog} *::before, ${dialog} *::after`, { boxSizing: "border-box" });

export const variants = styleVariants({
  sheet: { borderRadius: tokens["radius/radius-9"] },
  confirm: { maxWidth: 320, borderRadius: tokens["radius/radius-9"] },
});

export const sizes = styleVariants({
  small: { maxWidth: 400 },
  medium: { maxWidth: 480 },
  large: { maxWidth: 600 },
});

export const layout = style({
  display: "flex",
  flexDirection: "column",
  maxHeight: "inherit",
});
export const confirmLayout = style({ gap: 8, padding: "14px 16px" });

export const header = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexShrink: 0,
  padding: "18px 22px 12px",
});
export const title = style({
  minWidth: 0,
  margin: 0,
  color: tokens["color/ink"],
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: tokens["typography/display/title/fontSize"],
  fontWeight: tokens["typography/display/title/fontWeight"],
  lineHeight: tokens["typography/display/title/lineHeight"],
});
export const confirmTitle = style({
  margin: 0,
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body-lg/fontFamily"],
  fontSize: tokens["typography/sans/body-lg/fontSize"],
  fontWeight: 600,
  lineHeight: tokens["typography/sans/body-lg/lineHeight"],
});

export const body = style({
  minHeight: 0,
  padding: "0 22px 18px",
  overflowY: "auto",
});
export const confirmBody = style({
  minHeight: 0,
  overflowY: "auto",
  color: tokens["color/ink-2"],
});

export const footer = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexShrink: 0,
  padding: "14px 22px 18px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
});
export const confirmFooter = style({
  display: "flex",
  gap: 8,
  flexShrink: 0,
  paddingTop: 2,
});
// Equal widths for short labels; a long action label takes the room it needs.
globalStyle(`${confirmFooter} > *`, { flex: "1 1 auto" });
