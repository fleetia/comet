import { forwardRef, type InputHTMLAttributes } from "react";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as styles from "./fields.css";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & FieldProps;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      type = "text",
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
        <input
          {...props}
          ref={ref}
          id={field.id}
          type={type}
          className={[styles.input, className].filter(Boolean).join(" ")}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid}
        />
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

TextInput.displayName = "TextInput";
