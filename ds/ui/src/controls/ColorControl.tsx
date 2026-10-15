import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type JSX,
} from "react";
import * as styles from "./color-control.css";
export type ColorControlProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "size" | "children"
> & {
  label: string;
  appearance?: "hue" | "lightness";
  hue?: number;
};
export const ColorControl = forwardRef<HTMLInputElement, ColorControlProps>(
  (
    {
      label,
      appearance = "hue",
      hue = 168,
      min = 0,
      max = appearance === "hue" ? 360 : 100,
      value,
      defaultValue,
      onChange,
      className,
      style,
      ...props
    },
    ref,
  ): JSX.Element => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [currentValue, setCurrentValue] = useState(
      Number(value ?? defaultValue ?? (Number(min) + Number(max)) / 2),
    );
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
    const thumbHue = appearance === "hue" ? currentValue : hue;
    return (
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
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          setCurrentValue(event.currentTarget.valueAsNumber);
          onChange?.(event);
        }}
        className={[styles.control, styles.appearances[appearance], className]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            "--comet-color-control-hue": String(
              Number.isFinite(thumbHue) ? Math.max(0, Math.min(360, thumbHue)) : 168,
            ),
            ...style,
          } as CSSProperties
        }
      />
    );
  },
);
ColorControl.displayName = "ColorControl";
