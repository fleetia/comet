import { globalFontFace, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

globalFontFace("Comet Eulyoo1945", {
  src: 'local("Eulyoo1945-Regular")',
  fontStyle: "normal",
  fontWeight: 400,
  fontDisplay: "swap",
});

globalFontFace("Comet Eulyoo1945", {
  src: 'local("Eulyoo1945-SemiBold")',
  fontStyle: "normal",
  fontWeight: 600,
  fontDisplay: "swap",
});

// A separate family keeps an unavailable local face from trying Lagrange's CDN.
const family = '"Comet Eulyoo1945", serif';

export const localFonts = style({
  vars: {
    [vars.typography.family.display]: family,
    [vars.typography.family.ui]: family,
    [vars.typography.family.data]: family,
  },
});
