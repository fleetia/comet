import {
  cloneElement,
  createContext,
  forwardRef,
  useContext,
  useId,
  type AriaAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

import { Checkbox } from "./Checkbox";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { TextInput } from "./TextInput";
import * as styles from "./formField.css";

export type FormFieldContextValue = {
  controlId: string;
  describedBy?: string;
  isInvalid: boolean;
  isRequired: boolean;
};

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/** Field state for custom controls rendered inside a FormField. */
export function useFormField(): FormFieldContextValue | null {
  return useContext(FormFieldContext);
}

export type FormFieldProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** One control. Comet text, select and checkbox controls and native fields are wired automatically. */
  children: ReactElement;
  label: ReactNode;
  description?: ReactNode;
  /** Displayed error text also marks the control invalid. */
  error?: ReactNode;
  id?: string;
  required?: boolean;
};

type ControlProps = {
  id?: string;
  required?: boolean;
  "aria-required"?: AriaAttributes["aria-required"];
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
};

const wiredControls: unknown[] = [
  TextInput,
  Textarea,
  Select,
  Checkbox,
  "input",
  "textarea",
  "select",
];

function invalidState(
  isInvalid: boolean,
  invalid: AriaAttributes["aria-invalid"],
): AriaAttributes["aria-invalid"] {
  if (invalid === "grammar" || invalid === "spelling") {
    return invalid;
  }
  return isInvalid || (invalid !== undefined && invalid !== false && invalid !== "false")
    ? true
    : undefined;
}

export const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  (
    { children, id, label, description, error, required = false, className, ...props },
    ref,
  ): ReactElement => {
    const generatedId = useId();
    const child = children as ReactElement<ControlProps>;
    const controlId = id ?? child.props.id ?? `comet-field-${generatedId}`;
    const isRequired = required || child.props.required === true;
    const descriptionId = description ? `${controlId}-description` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const fieldDescribedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
    const describedBy =
      [fieldDescribedBy, child.props["aria-describedby"]].filter(Boolean).join(" ") || undefined;

    return (
      <FormFieldContext.Provider
        value={{
          controlId,
          describedBy: fieldDescribedBy,
          isInvalid: Boolean(error),
          isRequired: required,
        }}
      >
        <div
          {...props}
          ref={ref}
          className={[styles.formField, className].filter(Boolean).join(" ")}
        >
          <label className={styles.label} htmlFor={controlId}>
            {label}
            {required && (
              <span aria-hidden="true" className={styles.required}>
                *
              </span>
            )}
          </label>
          {wiredControls.includes(children.type)
            ? cloneElement(child, {
                id: controlId,
                required: isRequired,
                "aria-required": isRequired || child.props["aria-required"],
                "aria-describedby": describedBy,
                "aria-invalid": invalidState(Boolean(error), child.props["aria-invalid"]),
              })
            : children}
          {description && (
            <p id={descriptionId} className={`${styles.feedback} ${styles.description}`}>
              {description}
            </p>
          )}
          {error && (
            <p id={errorId} role="alert" className={`${styles.feedback} ${styles.error}`}>
              {error}
            </p>
          )}
        </div>
      </FormFieldContext.Provider>
    );
  },
);

FormField.displayName = "FormField";
