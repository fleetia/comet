import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevDownIcon } from "@comet/icon";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as styles from "./fields.css";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldProps & { leading?: ReactNode };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      multiple,
      children,
      leading,
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
      <span className={styles.field}>
        {label && (
          <label htmlFor={field.id} className={styles.label}>
            {label}
          </label>
        )}
        <span className={styles.selectContainer}>
          {leading && (
            <span aria-hidden className={styles.selectLeading}>
              {leading}
            </span>
          )}
          <select
            {...props}
            ref={ref}
            id={field.id}
            multiple={multiple}
            className={[
              styles.input,
              styles.select,
              multiple && styles.multipleSelect,
              leading && styles.selectWithLeading,
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid}
          >
            {children}
          </select>
          {!multiple && <ChevDownIcon size={13} className={styles.selectIcon} />}
        </span>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Select.displayName = "Select";
