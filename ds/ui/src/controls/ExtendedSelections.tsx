import { forwardRef, type CSSProperties, type JSX, type ReactNode } from "react";
import { Checkbox, type CheckboxProps } from "./Checkbox";
import { Radio, type RadioProps } from "./Radio";
import { Select, type SelectProps } from "./Select";
import * as styles from "./rows.css";

export type CheckboxRowProps = CheckboxProps & {
  layout?: "compact" | "export" | "inline" | "friend" | "description" | "control";
  leading?: ReactNode;
};
export const CheckboxRow = forwardRef<HTMLInputElement, CheckboxRowProps>(
  ({ layout = "compact", leading, label, className, ...props }, ref): JSX.Element => (
    <span
      className={[styles.row, styles.checkboxLayouts[layout], className].filter(Boolean).join(" ")}
    >
      <Checkbox
        {...props}
        ref={ref}
        label={
          <span className={styles.content}>
            {leading && <span aria-hidden>{leading}</span>}
            {label}
          </span>
        }
      />
    </span>
  ),
);
CheckboxRow.displayName = "CheckboxRow";
export type RadioRowProps = RadioProps & {
  layout?: "compact" | "app-usage" | "date" | "option";
  leading?: ReactNode;
};
export const RadioRow = forwardRef<HTMLInputElement, RadioRowProps>(
  ({ layout = "compact", leading, label, className, ...props }, ref): JSX.Element => (
    <span
      className={[styles.row, styles.radioLayouts[layout], className].filter(Boolean).join(" ")}
    >
      <Radio
        {...props}
        ref={ref}
        label={
          <span className={styles.content}>
            {leading && (
              <span aria-hidden className={styles.leading}>
                {leading}
              </span>
            )}
            {layout === "option" && !leading && <span aria-hidden className={styles.leading} />}
            {label}
          </span>
        }
      />
    </span>
  ),
);
RadioRow.displayName = "RadioRow";
export type SelectFieldProps = SelectProps & {
  layout?: "inline" | "compact" | "fill" | "spaced";
  controlSize?: 30 | 32 | 34 | 36;
  leading?: ReactNode;
};
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  (
    { layout = "inline", controlSize = 32, leading, className, style, ...props },
    ref,
  ): JSX.Element => (
    <span
      className={[styles.selectField, styles.selectLayouts[layout], className]
        .filter(Boolean)
        .join(" ")}
      style={{ "--comet-select-height": `${controlSize}px`, ...style } as CSSProperties}
    >
      <Select {...props} ref={ref} leading={leading} />
    </span>
  ),
);
SelectField.displayName = "SelectField";
