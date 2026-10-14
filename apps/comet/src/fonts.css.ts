import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

const family = '"Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

export const localFonts = style({
  vars: {
    [vars.typography.family.display]: family,
    [vars.typography.family.ui]: family,
    [vars.typography.family.data]: family,
  },
});
