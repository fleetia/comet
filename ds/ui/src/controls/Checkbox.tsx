import { forwardRef, type InputHTMLAttributes } from "react";
import { CheckIcon, MinusIcon } from "@comet/icon";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as fields from "./fields.css";
import * as styles from "./selection.css";

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "children"
> &
  FieldProps & {
    shape?: "square" | "round";
    indeterminate?: boolean;
  };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      shape = "square",
      indeterminate = false,
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
              ref={(node) => {
                if (node) {
                  node.indeterminate = indeterminate;
                }
                if (typeof ref === "function") {
                  ref(node);
                } else if (ref) {
                  ref.current = node;
                }
              }}
              id={field.id}
              type="checkbox"
              disabled={disabled}
              className={[styles.input, className].filter(Boolean).join(" ")}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid}
            />
            <span aria-hidden="true" className={[styles.indicator, styles.shapes[shape]].join(" ")}>
              <CheckIcon size={13} className={styles.checkIcon} />
              <MinusIcon size={13} className={styles.mixedIcon} />
            </span>
          </span>
          {label && <span>{label}</span>}
        </label>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Checkbox.displayName = "Checkbox";
