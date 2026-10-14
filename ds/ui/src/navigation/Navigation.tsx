import {
  useId,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { useSlidingIndicator } from "./useSlidingIndicator";

import * as styles from "./styles.css";

export type TabItem = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  icon?: IconName;
  disabled?: boolean;
};

export type TabsProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> & {
  items: readonly TabItem[];
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function Tabs({
  items,
  label,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TabsProps): ReactElement {
  const id = useId();
  const { containerRef, indicatorRef } = useSlidingIndicator(
    ':scope > button[aria-selected="true"]',
  );
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = value ?? internalValue;
  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const selectedIndex = items.findIndex((item) => item.value === selectedValue && !item.disabled);
  const activeIndex = selectedIndex < 0 ? enabledIndexes[0] : selectedIndex;

  function activate(index: number): void {
    const item = items[index];
    if (!item || item.disabled || activeIndex === index) {
      return;
    }
    if (value === undefined) {
      setInternalValue(item.value);
    }
    onValueChange?.(item.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey || enabledIndexes.length === 0) {
      return;
    }
    const position = enabledIndexes.indexOf(index);
    const direction = event.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl" ? -1 : 1;
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        nextIndex =
          enabledIndexes[(position + direction + enabledIndexes.length) % enabledIndexes.length];
        break;
      case "ArrowLeft":
        nextIndex =
          enabledIndexes[(position - direction + enabledIndexes.length) % enabledIndexes.length];
        break;
      case "Home":
        nextIndex = enabledIndexes[0];
        break;
      case "End":
        nextIndex = enabledIndexes.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextIndex !== undefined) {
      activate(nextIndex);
      buttons.current[nextIndex]?.focus();
    }
  }

  return (
    <div {...props} className={[styles.tabs, className].filter(Boolean).join(" ")}>
      <div ref={containerRef} role="tablist" aria-label={label} className={styles.tabList}>
        <span
          ref={indicatorRef}
          aria-hidden
          hidden
          className={`${styles.indicator} ${styles.tabIndicator}`}
        />
        {items.map((item, index) => {
          const itemId = `${id}-${encodeURIComponent(item.value)}`;
          return (
            <button
              key={item.value}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${itemId}-tab`}
              aria-controls={`${itemId}-panel`}
              aria-selected={activeIndex === index}
              tabIndex={activeIndex === index ? 0 : -1}
              disabled={item.disabled}
              onClick={() => activate(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={styles.tab}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item, index) => {
        const itemId = `${id}-${encodeURIComponent(item.value)}`;
        return (
          <div
            key={item.value}
            role="tabpanel"
            id={`${itemId}-panel`}
            aria-labelledby={`${itemId}-tab`}
            hidden={activeIndex !== index}
            tabIndex={0}
          >
            {item.content}
          </div>
        );
      })}
    </div>
  );
}

export type SegmentOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> & {
  options: readonly SegmentOption[];
  label: string;
  name?: string;
  disabled?: boolean;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

export function SegmentedControl({
  options,
  label,
  name,
  disabled = false,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: SegmentedControlProps): ReactElement {
  const id = useId();
  const { containerRef, indicatorRef } = useSlidingIndicator(":scope > label:has(input:checked)");
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const defaultSelection = defaultValue ?? options.find((option) => !option.disabled)?.value;

  useEffect(() => {
    const form = inputs.current[0]?.form;
    if (!form || value === undefined) {
      return;
    }
    const reset = (): void => {
      // The reset event fires before the browser restores native defaults.
      for (const input of inputs.current) {
        if (input) {
          input.defaultChecked = input.value === value;
        }
      }
    };
    form.addEventListener("reset", reset);
    return () => {
      form.removeEventListener("reset", reset);
    };
  }, [value, options.length]);

  return (
    <div
      {...props}
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={[styles.segmentedControl, className].filter(Boolean).join(" ")}
    >
      <span
        ref={indicatorRef}
        aria-hidden
        hidden
        className={`${styles.indicator} ${styles.segmentIndicator}`}
      />
      {options.map((option, index) => (
        <label key={option.value} className={styles.segment}>
          <input
            type="radio"
            ref={(element) => {
              inputs.current[index] = element;
            }}
            name={name ?? id}
            value={option.value}
            checked={value === undefined ? undefined : value === option.value}
            defaultChecked={value === undefined ? defaultSelection === option.value : undefined}
            disabled={disabled || option.disabled}
            className={styles.segmentInput}
            onChange={() => {
              onValueChange?.(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
