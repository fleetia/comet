import { style } from "@vanilla-extract/css";
import { tokenNames } from "@comet/token";

export const theme = style({
  selectors: {
    '&[data-comet-theme="dark"]': {
      // Desktop content behind a native window must not reduce text contrast.
      vars: {
        [tokenNames["color/glass-window"]]: "rgb(16 23 58)",
        [tokenNames["color/glass-panel"]]: "rgb(22 30 68)",
        [tokenNames["color/glass-widget"]]: "rgb(20 28 64)",
        [tokenNames["color/glass-capsule"]]: "rgb(20 28 64)",
        [tokenNames["color/glass-pill"]]: "rgb(24 33 76)",
        [tokenNames["color/glass-tail"]]: "rgb(22 30 68)",
      },
    },
  },
});
