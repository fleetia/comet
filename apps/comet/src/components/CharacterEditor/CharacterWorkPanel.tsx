import type { ReactNode } from "react";
import { Surface, type SurfaceProps } from "@fleetia/lagrange";
import * as s from "./CharacterEditor.css";

export function CharacterWorkPanel({
  children,
  footer,
  className,
  ...props
}: SurfaceProps & { footer?: ReactNode }): ReactNode {
  return (
    <Surface
      {...props}
      padding="flush"
      className={[s.workPanel, className].filter(Boolean).join(" ")}
    >
      <div className={s.workBody} data-character-scroll="body">
        {children}
      </div>
      {footer && (
        <div className={s.workFooter} data-character-footer="fixed">
          {footer}
        </div>
      )}
    </Surface>
  );
}
