import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import "../motion/motion.css";

export const root = style({
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: tokens["typography/sans/body/fontWeight"],
  lineHeight: tokens["typography/sans/body/lineHeight"],
  color: tokens["color/ink"],
  selectors: {
    '&[data-comet-theme="dark"]': { colorScheme: "dark" },
    '&[data-comet-theme="light"]': { colorScheme: "light" },
  },
});

globalStyle(`${root}, ${root} *, ${root} *::before, ${root} *::after`, { boxSizing: "border-box" });
