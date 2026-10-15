import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { TextInput, type TextInputProps } from "./TextInput";
import { Textarea, type TextareaProps } from "./Textarea";
import { Keycap } from "../display/Indicators";
import * as styles from "./extended.css";

export type TextSurfaceInputProps = TextInputProps & {
  appearance?: "subtle" | "plain-compact" | "plain-fill" | "filled" | "compact-field";
};
export const TextSurfaceInput = forwardRef<HTMLInputElement, TextSurfaceInputProps>(
  ({ appearance = "subtle", className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      className={[styles.inline, styles.appearances[appearance], className]
        .filter(Boolean)
        .join(" ")}
    />
  ),
);
TextSurfaceInput.displayName = "TextSurfaceInput";

export type AmountInputProps = Omit<TextInputProps, "type"> & {
  typography?: "strong" | "regular" | "compact";
};
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(
  ({ typography = "strong", className, inputMode = "decimal", ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      inputMode={inputMode}
      className={[styles.inline, styles.amount, styles.amountTypography[typography], className]
        .filter(Boolean)
        .join(" ")}
    />
  ),
);
AmountInput.displayName = "AmountInput";

export type MessageInputProps = TextInputProps & { layout?: "fill" | "hug" };
export const MessageInput = forwardRef<HTMLInputElement, MessageInputProps>(
  ({ layout = "fill", className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      className={[styles.inline, layout === "fill" ? styles.message : styles.messageHug, className]
        .filter(Boolean)
        .join(" ")}
    />
  ),
);
MessageInput.displayName = "MessageInput";

export const NumberInput = forwardRef<HTMLInputElement, Omit<TextInputProps, "type">>(
  ({ className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      type="number"
      className={[styles.number, className].filter(Boolean).join(" ")}
    />
  ),
);
NumberInput.displayName = "NumberInput";
export const TimeInput = forwardRef<HTMLInputElement, Omit<TextInputProps, "type">>(
  ({ className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      type="time"
      className={[styles.time, className].filter(Boolean).join(" ")}
    />
  ),
);
TimeInput.displayName = "TimeInput";
export const TitleInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      className={[styles.inline, styles.title, className].filter(Boolean).join(" ")}
    />
  ),
);
TitleInput.displayName = "TitleInput";
export const URLInput = forwardRef<HTMLInputElement, Omit<TextInputProps, "type">>(
  ({ className, ...props }, ref): JSX.Element => (
    <TextInput
      {...props}
      ref={ref}
      type="url"
      className={[styles.url, className].filter(Boolean).join(" ")}
    />
  ),
);
URLInput.displayName = "URLInput";
export const MultilineEditor = forwardRef<HTMLTextAreaElement, Omit<TextareaProps, "layout">>(
  ({ className, ...props }, ref): JSX.Element => (
    <Textarea
      {...props}
      ref={ref}
      layout="plain"
      className={[styles.editor, className].filter(Boolean).join(" ")}
    />
  ),
);
MultilineEditor.displayName = "MultilineEditor";

export type ShortcutInputProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "value" | "defaultValue" | "children" | "onChange" | "type"
> & {
  label: string;
  value?: readonly string[];
  defaultValue?: readonly string[];
  onShortcutChange?: (keys: string[]) => void;
  placeholder?: string;
};
const modifierLabels: Record<string, string> = { Meta: "⌘", Control: "Ctrl", Alt: "⌥", Shift: "⇧" };
export function ShortcutInput({
  label,
  value,
  defaultValue = [],
  onShortcutChange,
  placeholder = "단축키 입력",
  onKeyDown,
  className,
  ...props
}: ShortcutInputProps): JSX.Element {
  const [internalValue, setInternalValue] = useState<readonly string[]>(defaultValue);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const form = buttonRef.current?.form;
    if (!form) {
      return;
    }
    const reset = (event: Event): void => {
      queueMicrotask(() => {
        if (!event.defaultPrevented) {
          setInternalValue(defaultValue);
        }
      });
    };
    form.addEventListener("reset", reset);
    return () => {
      form.removeEventListener("reset", reset);
    };
  }, [defaultValue]);
  const keys = value ?? internalValue;
  return (
    <button
      {...props}
      ref={buttonRef}
      type="button"
      aria-label={label}
      className={[styles.shortcut, className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          event.defaultPrevented ||
          event.key === "Tab" ||
          event.key === "Escape" ||
          event.nativeEvent.isComposing ||
          event.key in modifierLabels
        ) {
          return;
        }
        event.preventDefault();
        const next = [
          event.metaKey && "Meta",
          event.ctrlKey && "Control",
          event.altKey && "Alt",
          event.shiftKey && "Shift",
          event.key === " " ? "Space" : event.key,
        ].filter((key): key is string => Boolean(key));
        if (value === undefined) {
          setInternalValue(next);
        }
        onShortcutChange?.(next);
      }}
    >
      {keys.length === 0
        ? placeholder
        : keys.map((key, index) => (
            <Keycap key={`${key}-${index}`}>{modifierLabels[key] ?? key}</Keycap>
          ))}
    </button>
  );
}
export type PropertyItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  label: ReactNode;
  valueLabel?: ReactNode;
  selected?: boolean;
};
export function PropertyItem({
  icon,
  label,
  valueLabel,
  selected = false,
  className,
  type = "button",
  ...props
}: PropertyItemProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={[styles.property, className].filter(Boolean).join(" ")}
    >
      {icon}
      <span>{label}</span>{" "}
      {valueLabel != null && <span className={styles.propertyValue}>{valueLabel}</span>}
    </button>
  );
}
