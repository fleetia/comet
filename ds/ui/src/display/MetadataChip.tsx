import type { HTMLAttributes, JSX } from "react";
import { Icon, type IconName } from "@comet/icon";
import { ContextChip } from "./Chips";
import * as styles from "./metadata.css";
export type MetadataChipProps = HTMLAttributes<HTMLSpanElement> & {
  kind?: "list" | "envelope" | "repeat";
  icon?: IconName;
  color?: string;
};
export function MetadataChip({
  kind = "list",
  icon,
  color,
  children,
  className,
  ...props
}: MetadataChipProps): JSX.Element {
  return (
    <ContextChip
      {...props}
      className={[styles.chip, styles.kinds[kind], className].filter(Boolean).join(" ")}
    >
      {kind === "list" ? (
        <span aria-hidden className={styles.dot} style={{ backgroundColor: color }} />
      ) : (
        <Icon name={icon ?? (kind === "envelope" ? "envelope" : "repeat")} size={13} />
      )}
      {children}
    </ContextChip>
  );
}
