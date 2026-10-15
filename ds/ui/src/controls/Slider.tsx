import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
} from "react";

import { FieldMessages, useField, type FieldProps } from "./Field";
import * as fields from "./fields.css";
import * as styles from "./slider.css";

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "children"
> &
  FieldProps;

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      label,
      description,
      error,
      id,
      className,
      style,
      min = 0,
      max = 100,
      value,
      defaultValue,
      onChange,
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
    const initialValue = Number(value ?? defaultValue ?? (Number(min) + Number(max)) / 2);
    const [currentValue, setCurrentValue] = useState(initialValue);
    const progress =
      Number(max) > Number(min)
        ? Math.min(
            100,
            Math.max(0, ((currentValue - Number(min)) / (Number(max) - Number(min))) * 100),
          )
        : 0;
    const sliderStyle: CSSProperties & { "--comet-slider-progress": string } = {
      ...style,
      "--comet-slider-progress": `${progress}%`,
    };

    useLayoutEffect(() => {
      if (inputRef.current) {
        setCurrentValue(inputRef.current.valueAsNumber);
      }
    });

    useEffect(() => {
      const form = inputRef.current?.form;
      if (!form) {
        return;
      }
      const reset = (): void => {
        queueMicrotask(() => {
          if (inputRef.current) {
            setCurrentValue(inputRef.current.valueAsNumber);
          }
        });
      };
      form.addEventListener("reset", reset);
      return () => {
        form.removeEventListener("reset", reset);
      };
    }, []);

    return (
      <span className={fields.field}>
        {label && (
          <label htmlFor={field.id} className={fields.label}>
            {label}
          </label>
        )}
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
          type="range"
          min={min}
          max={max}
          value={value}
          defaultValue={defaultValue}
          style={sliderStyle}
          className={[styles.slider, className].filter(Boolean).join(" ")}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid}
          onChange={(event) => {
            setCurrentValue(event.currentTarget.valueAsNumber);
            onChange?.(event);
          }}
        />
        <FieldMessages {...field} description={description} error={error} />
      </span>
    );
  },
);

Slider.displayName = "Slider";
