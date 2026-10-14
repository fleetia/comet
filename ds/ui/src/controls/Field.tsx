import { useId, type AriaAttributes, type ReactElement, type ReactNode } from "react";

import * as styles from "./fields.css";

export type FieldProps = {
  /** A visible, programmatically associated field label. */
  label?: ReactNode;
  description?: ReactNode;
  /** Displayed error text also marks the native control invalid. */
  error?: ReactNode;
};

type FieldStateProps = FieldProps & {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

type FieldState = {
  id: string;
  describedBy: string | undefined;
  invalid: AriaAttributes["aria-invalid"];
  descriptionId: string;
  errorId: string;
};

export function useField(props: FieldStateProps): FieldState {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [
      props["aria-describedby"],
      props.description ? descriptionId : undefined,
      props.error ? errorId : undefined,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return {
    id,
    describedBy,
    invalid: props.error ? true : props["aria-invalid"],
    descriptionId,
    errorId,
  };
}

export function FieldMessages({
  description,
  error,
  descriptionId,
  errorId,
}: Pick<FieldState, "descriptionId" | "errorId"> & FieldProps): ReactElement {
  return (
    <>
      {description && (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
    </>
  );
}
