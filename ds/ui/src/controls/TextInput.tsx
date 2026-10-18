import { forwardRef, type InputHTMLAttributes } from "react";

import { FieldMessages, fieldClassName, useField, type FieldProps, type FillProps } from "./Field";
import * as styles from "./fields.css";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  FieldProps &
  FillProps;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      type = "text",
      fill,
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
      <span className={fieldClassName(fill, { label, description, error })}>
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
          className={[styles.input, fill && styles.fillInput, className].filter(Boolean).join(" ")}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid}
        />
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

TextInput.displayName = "TextInput";
