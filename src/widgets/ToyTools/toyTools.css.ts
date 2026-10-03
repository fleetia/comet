import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { token } from "../tools.css";

export const decoration = style([
  token,
  {
    display: "grid",
    placeItems: "center",
    width: vars.dimension.control,
    height: vars.dimension.control,
    padding: 0,
    borderRadius: vars.shape.radius.subtle,
    fontSize: vars.typography.size.headingMd,
  },
]);
