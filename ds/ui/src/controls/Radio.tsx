import { forwardRef, type InputHTMLAttributes } from "react";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as fields from "./fields.css";
import * as styles from "./selection.css";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type" | "children"> &
  FieldProps;

export const Radio = forwardRef<HTMLInputElement, RadioProps>(
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
        <label
          htmlFor={field.id}
          className={[styles.row, styles.radioRow].join(" ")}
          data-disabled={disabled || undefined}
        >
          <span className={styles.control}>
            <input
              {...props}
              ref={ref}
              id={field.id}
              type="radio"
              disabled={disabled}
              className={[styles.input, className].filter(Boolean).join(" ")}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid}
            />
            <span aria-hidden="true" className={styles.radioIndicator} />
          </span>
          {label && <span>{label}</span>}
        </label>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Radio.displayName = "Radio";
