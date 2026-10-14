import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { MinusIcon, PlusIcon } from "@comet/icon";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as fields from "./fields.css";
import * as styles from "./stepper.css";

export type StepperProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "children" | "value" | "defaultValue" | "min" | "max" | "step"
> &
  FieldProps & {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    /** Receives numeric edits and +/- actions. Empty input remains editable. */
    onValueChange?: (value: number) => void;
    unit?: ReactNode;
    decreaseLabel?: string;
    increaseLabel?: string;
  };

export const Stepper = forwardRef<HTMLInputElement, StepperProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      value,
      defaultValue = 0,
      min,
      max,
      step = 1,
      onChange,
      onValueChange,
      unit,
      disabled,
      readOnly,
      decreaseLabel = "값 줄이기",
      increaseLabel = "값 늘리기",
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
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
    const currentValue = value ?? uncontrolledValue;

    useEffect(() => {
      const form = inputRef.current?.form;
      if (!form) {
        return;
      }
      const reset = (): void => {
        setUncontrolledValue(defaultValue);
      };
      form.addEventListener("reset", reset);
      return () => {
        form.removeEventListener("reset", reset);
      };
    }, [defaultValue]);

    function changeValue(direction: "up" | "down"): void {
      const input = inputRef.current;
      if (!input || disabled || readOnly) {
        return;
      }
      if (direction === "up") {
        input.stepUp();
      } else {
        input.stepDown();
      }
      const nextValue = input.valueAsNumber;
      if (!Number.isFinite(nextValue) || nextValue === currentValue) {
        return;
      }
      if (value !== undefined) {
        input.value = String(value);
      }
      setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    }

    return (
      <span className={fields.field}>
        {label && (
          <label htmlFor={field.id} className={fields.label}>
            {label}
          </label>
        )}
        <span className={styles.row}>
          <span className={styles.group}>
            <button
              type="button"
              className={styles.button}
              aria-label={decreaseLabel}
              aria-controls={field.id}
              disabled={disabled || readOnly || (min !== undefined && currentValue <= min)}
              onClick={() => {
                changeValue("down");
              }}
            >
              <MinusIcon size={17} />
            </button>
            <input
              {...props}
              ref={(node) => {
                inputRef.current = node;
                if (typeof ref === "function") {
                  ref(node);
                } else if (ref) {
                  ref.current = node;
                }
              }}
              id={field.id}
              type="number"
              min={min}
              max={max}
              step={step}
              value={value}
              defaultValue={value === undefined ? defaultValue : undefined}
              disabled={disabled}
              readOnly={readOnly}
              className={[styles.input, className].filter(Boolean).join(" ")}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid}
              onChange={(event) => {
                const nextValue = event.currentTarget.valueAsNumber;
                setUncontrolledValue(nextValue);
                onChange?.(event);
                if (Number.isFinite(nextValue)) {
                  onValueChange?.(nextValue);
                }
              }}
            />
            <button
              type="button"
              className={styles.button}
              aria-label={increaseLabel}
              aria-controls={field.id}
              disabled={disabled || readOnly || (max !== undefined && currentValue >= max)}
              onClick={() => {
                changeValue("up");
              }}
            >
              <PlusIcon size={17} />
            </button>
          </span>
          {unit && <span className={styles.unit}>{unit}</span>}
        </span>
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Stepper.displayName = "Stepper";
