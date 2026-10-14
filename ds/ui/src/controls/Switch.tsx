import { forwardRef, type InputHTMLAttributes } from "react";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as fields from "./fields.css";
import * as styles from "./selection.css";

export type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "role" | "children"
> &
  FieldProps;

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      disabled,
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
      ...props
    },
    ref,
  ) => {
    const field = useField({
      id,
      description,
      error,
      "aria-describedby": describedBy,
      "aria-invalid": invalid,
    });

    return (
      <span className={fields.field}>
        <label htmlFor={field.id} className={styles.row} data-disabled={disabled || undefined}>
          <span className={styles.control}>
            <input
              {...props}
              ref={ref}
              id={field.id}
              type="checkbox"
              role="switch"
              disabled={disabled}
              className={[styles.input, className].filter(Boolean).join(" ")}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid}
            />
            <span aria-hidden="true" className={styles.switchTrack}>
              <span className={styles.switchKnob} />
            </span>
          </span>
          {label && <span>{label}</span>}
        </label>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Switch.displayName = "Switch";
