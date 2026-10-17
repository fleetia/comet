import type { ComponentPropsWithoutRef, KeyboardEvent, ReactElement } from "react";
import { PLACEMENTS, type Placement } from "../widgetAppearance";
import * as styles from "./controls.css";

const ARROWS: Record<string, [row: number, column: number]> = {
  ArrowUp: [2, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, 2],
  ArrowRight: [0, 1],
};

export type PlacementPickerProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "defaultValue" | "onChange"
> & {
  label: string;
  value: Placement;
  onValueChange: (placement: Placement) => void;
  getItemLabel: (placement: Placement) => string;
  disabled?: boolean;
};

/** 3×3 radio grid; arrow keys wrap within the row or column. */
export function PlacementPicker({
  label,
  value,
  onValueChange,
  getItemLabel,
  disabled = false,
  className,
  ...props
}: PlacementPickerProps): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, placement: Placement): void {
    const step = ARROWS[event.key];
    if (!step) return;
    event.preventDefault();
    const index = PLACEMENTS.indexOf(placement);
    const row = (Math.floor(index / 3) + step[0]) % 3;
    const column = ((index % 3) + step[1]) % 3;
    const next = PLACEMENTS[row * 3 + column] ?? placement;
    if (next !== value) onValueChange(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-placement="${next}"]`)
      ?.focus();
  }

  return (
    <div
      {...props}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={[styles.placementPicker, className].filter(Boolean).join(" ")}
    >
      {PLACEMENTS.map((placement) => {
        const checked = placement === value;
        return (
          <button
            key={placement}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={getItemLabel(placement)}
            data-checked={checked || undefined}
            data-placement={placement}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className={styles.placementOption}
            onClick={() => {
              if (!checked) onValueChange(placement);
            }}
            onKeyDown={(event) => handleKeyDown(event, placement)}
          />
        );
      })}
    </div>
  );
}
