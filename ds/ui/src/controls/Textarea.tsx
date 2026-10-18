import { forwardRef, type TextareaHTMLAttributes } from "react";

import { FieldMessages, fieldClassName, useField, type FieldProps, type FillProps } from "./Field";
import * as styles from "./fields.css";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldProps &
  FillProps & {
    layout?: "compact" | "fixed" | "flexible" | "code-compact" | "plain" | "code-padded";
  };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      layout = "compact",
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
        <textarea
          {...props}
          ref={ref}
          id={field.id}
          className={[
            styles.input,
            styles.textareaLayouts[layout],
            fill && styles.fillTextarea,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid}
        />
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Textarea.displayName = "Textarea";
