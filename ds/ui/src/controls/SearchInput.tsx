import { forwardRef, type InputHTMLAttributes } from "react";
import { SearchIcon } from "@comet/icon";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as styles from "./fields.css";

export type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> &
  FieldProps & {
    appearance?: "outlined" | "plain" | "large" | "medium";
    containerClassName?: string;
  };

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      containerClassName,
      appearance = "outlined",
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
      <span className={styles.field}>
        {label && (
          <label htmlFor={field.id} className={styles.label}>
            {label}
          </label>
        )}
        <span
          className={[
            styles.searchContainer,
            styles.searchAppearances[appearance],
            containerClassName,
          ]
            .filter(Boolean)
            .join(" ")}
          data-disabled={disabled || undefined}
          data-invalid={field.invalid === true || field.invalid === "true" || undefined}
        >
          <SearchIcon size={appearance === "large" ? 20 : 14} />
          <input
            {...props}
            ref={ref}
            id={field.id}
            type="search"
            disabled={disabled}
            className={[styles.searchInput, styles.searchInputSizes[appearance], className]
              .filter(Boolean)
              .join(" ")}
            aria-describedby={field.describedBy}
            aria-invalid={field.invalid}
          />
        </span>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

SearchInput.displayName = "SearchInput";
