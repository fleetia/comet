import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { useFieldContext } from "../../ui";
import { normalizeColor } from "./colorValue";
import * as styles from "./controls.css";

export type ColorFieldProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "defaultValue" | "onChange" | "type" | "value"
> & {
  value: string;
  onValueChange: (value: string) => void;
  swatchLabel?: string;
};

/** Hex color text input with a native swatch; typed values commit on blur or Enter. */
export function ColorField({
  value,
  onValueChange,
  swatchLabel = "색상 선택",
  disabled = false,
  className,
  id,
  onBlur,
  onFocus,
  onKeyDown,
  "aria-describedby": ariaDescribedBy,
  ...props
}: ColorFieldProps): ReactElement {
  const field = useFieldContext();
  const committed = normalizeColor(value) ?? "#000000";
  const [draft, setDraft] = useState(committed);
  const [focused, setFocused] = useState(false);
  const previous = useRef(committed);
  const invalid = normalizeColor(draft) === null || Boolean(field?.isInvalid);

  useEffect(() => {
    if (!focused || previous.current !== committed) setDraft(committed);
    previous.current = committed;
  }, [committed, focused]);

  function commit(next: string): void {
    const normalized = normalizeColor(next);
    setDraft(committed);
    if (normalized && normalized !== committed) onValueChange(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(committed);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
    }
  }

  return (
    <span
      className={[styles.colorField, className].filter(Boolean).join(" ")}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
    >
      <input
        type="color"
        aria-label={swatchLabel}
        className={styles.swatch}
        disabled={disabled}
        value={normalizeColor(draft) ?? committed}
        onChange={(event) => commit(event.currentTarget.value)}
      />
      <input
        {...props}
        type="text"
        id={field?.controlId ?? id}
        className={styles.colorInput}
        disabled={disabled}
        spellCheck={false}
        required={field?.isRequired}
        aria-invalid={invalid || undefined}
        aria-describedby={
          [field?.describedBy, ariaDescribedBy].filter(Boolean).join(" ") || undefined
        }
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          commit(draft);
          onBlur?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
    </span>
  );
}
