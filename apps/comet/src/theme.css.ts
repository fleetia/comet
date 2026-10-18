import { style } from "@vanilla-extract/css";
import { themes, tokenNames } from "@comet/token";

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

export const conversationTheme = style({
  vars: {
    [tokenNames["color/glass-window"]]: themes.dark["color/glass-window"],
    [tokenNames["color/glass-panel"]]: themes.dark["color/glass-panel"],
    [tokenNames["color/glass-capsule"]]: themes.dark["color/glass-capsule"],
    [tokenNames["color/glass-pill"]]: themes.dark["color/glass-pill"],
    [tokenNames["color/glass-tail"]]: themes.dark["color/glass-tail"],
  },
});
