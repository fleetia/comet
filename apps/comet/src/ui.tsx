import {
  cloneElement,
  forwardRef,
  useId,
  type AriaAttributes,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Button as CometButton,
  Checkbox as CometCheckbox,
  Select as CometSelect,
  Surface as CometSurface,
  Textarea as CometTextarea,
  TextInput as CometTextInput,
  type ButtonProps as CometButtonProps,
} from "@comet/ui";

import { FieldContext } from "./primitives";
import * as fieldStyles from "./primitives.css";
import * as styles from "./ui.css";

export * from "./primitives";
export { Dialog, type DialogProps } from "@comet/ui";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  isPending?: boolean;
  size?: "compact" | "default";
  variant?: "primary" | "secondary" | "quiet" | "critical";
};
export type IconButtonProps = Omit<ComponentPropsWithoutRef<"button">, "aria-label" | "children"> & {
  children: ReactNode;
  label: string;
  size?: "compact" | "default";
  variant?: "default" | "quiet" | "critical";
};
export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "children" | "className" | "type"
> & { children: ReactNode; className?: string; description?: ReactNode; isInvalid?: boolean };
export type TextFieldProps = ComponentPropsWithoutRef<"input"> & { isInvalid?: boolean };
export type DateFieldProps = Omit<TextFieldProps, "type">;
export type TextAreaProps = ComponentPropsWithoutRef<"textarea"> & {
  isInvalid?: boolean;
  resize?: "none" | "vertical" | "both";
};
export type SelectProps = ComponentPropsWithoutRef<"select"> & { isInvalid?: boolean };
export type SurfaceProps = ComponentPropsWithoutRef<"div"> & {
  tone?: "parent" | "inset" | "inverse" | "accent";
  padding?: "default" | "compact" | "flush" | "inline";
};
export type FormFieldProps = Omit<ComponentPropsWithoutRef<"div">, "children"> & {
  children: ReactElement;
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  id?: string;
  marker?: ReactNode;
  required?: boolean;
};

const buttonVariants: Record<NonNullable<ButtonProps["variant"]>, CometButtonProps["variant"]> = {
  primary: "primary",
  secondary: "ghost",
  quiet: "ghost",
  critical: "danger",
};

function invalidState(
  isInvalid: boolean | undefined,
  invalid: AriaAttributes["aria-invalid"],
): AriaAttributes["aria-invalid"] {
  if (invalid === "grammar" || invalid === "spelling") {
    return invalid;
  }
  return isInvalid || (invalid !== undefined && invalid !== false && invalid !== "false")
    ? true
    : undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "default",
      isPending = false,
      disabled,
      "aria-busy": busy,
      "aria-disabled": ariaDisabled,
      ...props
    },
    ref,
  ): ReactElement => (
    <CometButton
      {...props}
      ref={ref}
      variant={buttonVariants[variant]}
      size={size === "compact" ? "small" : "regular"}
      disabled={disabled || isPending}
      aria-disabled={disabled || isPending || ariaDisabled || undefined}
      aria-busy={isPending || busy || undefined}
      data-pending={isPending || undefined}
      data-size={size}
      data-variant={variant}
    />
  ),
);
Button.displayName = "Button";

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = "default", size = "default", className, ...props }, ref): ReactElement => (
    <CometButton
      {...props}
      ref={ref}
      aria-label={label}
      variant={variant === "critical" ? "danger" : "ghost"}
      size={size === "compact" ? "small" : "regular"}
      className={[styles.iconButton, size === "compact" && styles.compactIconButton, className]
        .filter(Boolean)
        .join(" ")}
      data-size={size}
      data-variant={variant}
    />
  ),
);
IconButton.displayName = "IconButton";

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ children, isInvalid, "aria-invalid": invalid, ...props }, ref): ReactElement => (
    <CometCheckbox
      {...props}
      ref={ref}
      label={children}
      aria-invalid={invalidState(isInvalid, invalid)}
    />
  ),
);
Checkbox.displayName = "Checkbox";

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      isInvalid,
      className,
      required,
      "aria-required": ariaRequired,
      "aria-invalid": invalid,
      ...props
    },
    ref,
  ): ReactElement => (
    <CometTextInput
      {...props}
      ref={ref}
      className={[styles.fieldControl, className].filter(Boolean).join(" ")}
      required={required}
      aria-required={required || ariaRequired || undefined}
      aria-invalid={invalidState(isInvalid, invalid)}
    />
  ),
);
TextField.displayName = "TextField";

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(
  (props, ref): ReactElement => <TextField {...props} ref={ref} type="date" />,
);
DateField.displayName = "DateField";

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      isInvalid,
      className,
      required,
      resize = "vertical",
      rows = 3,
      style,
      "aria-required": ariaRequired,
      "aria-invalid": invalid,
      ...props
    },
    ref,
  ): ReactElement => (
    <CometTextarea
      {...props}
      ref={ref}
      rows={rows}
      layout="flexible"
      className={[styles.fieldControl, styles.textarea, className].filter(Boolean).join(" ")}
      style={{ resize, ...style }}
      required={required}
      aria-required={required || ariaRequired || undefined}
      aria-invalid={invalidState(isInvalid, invalid)}
    />
  ),
);
TextArea.displayName = "TextArea";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      isInvalid,
      className,
      required,
      "aria-required": ariaRequired,
      "aria-invalid": invalid,
      ...props
    },
    ref,
  ): ReactElement => (
    <CometSelect
      {...props}
      ref={ref}
      className={[styles.fieldControl, styles.selectControl, className].filter(Boolean).join(" ")}
      required={required}
      aria-required={required || ariaRequired || undefined}
      aria-invalid={invalidState(isInvalid, invalid)}
    />
  ),
);
Select.displayName = "Select";

type FieldControlProps = Pick<
  TextFieldProps,
  "id" | "required" | "aria-required" | "aria-describedby" | "aria-invalid"
>;

export const FormField = forwardRef<HTMLDivElement, FormFieldProps>(
  (
    { children, id, label, marker, description, error, required = false, className, ...props },
    ref,
  ): ReactElement => {
    const generatedId = useId();
    const child = children as ReactElement<FieldControlProps>;
    const controlId = id ?? child.props.id ?? `comet-field-${generatedId}`;
    const isRequired = required || child.props.required === true;
    const isAdaptedControl =
      children.type === TextField ||
      children.type === TextArea ||
      children.type === DateField ||
      children.type === Select ||
      children.type === Checkbox ||
      children.type === "input" ||
      children.type === "textarea" ||
      children.type === "select";
    const descriptionId = description ? `${controlId}-description` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy =
      [descriptionId, errorId, child.props["aria-describedby"]].filter(Boolean).join(" ") ||
      undefined;

    return (
      <FieldContext.Provider
        value={{
          controlId,
          describedBy: [descriptionId, errorId].filter(Boolean).join(" ") || undefined,
          isInvalid: Boolean(error),
          isRequired: required,
        }}
      >
        <div
          {...props}
          ref={ref}
          className={[fieldStyles.field, styles.fieldGroup, className].filter(Boolean).join(" ")}
        >
          <div className={fieldStyles.fieldLabelRow}>
            <label className={fieldStyles.fieldLabel} htmlFor={controlId}>
              {label}
              {required && (
                <span aria-hidden="true" className={fieldStyles.fieldRequired}>
                  *
                </span>
              )}
            </label>
            {marker && <span className={fieldStyles.fieldMarker}>{marker}</span>}
          </div>
          {isAdaptedControl
            ? cloneElement(child, {
                id: controlId,
                required: isRequired,
                "aria-required": isRequired || child.props["aria-required"],
                "aria-describedby": describedBy,
                "aria-invalid": invalidState(Boolean(error), child.props["aria-invalid"]),
              })
            : children}
          {description && (
            <p
              id={descriptionId}
              className={`${fieldStyles.fieldFeedback} ${fieldStyles.fieldDescription}`}
            >
              {description}
            </p>
          )}
          {error && (
            <p
              id={errorId}
              role="alert"
              className={`${fieldStyles.fieldFeedback} ${fieldStyles.fieldError}`}
            >
              {error}
            </p>
          )}
        </div>
      </FieldContext.Provider>
    );
  },
);
FormField.displayName = "FormField";

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ tone = "parent", padding = "default", className, ...props }, ref): ReactElement => (
    <CometSurface
      {...props}
      ref={ref}
      variant="sheet"
      className={[
        styles.surface,
        styles.surfaceTones[tone],
        styles.surfacePaddings[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  ),
);
Surface.displayName = "Surface";
