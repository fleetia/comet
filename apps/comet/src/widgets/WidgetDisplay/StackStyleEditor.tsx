import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, FormField, Slider, Switch } from "@comet/ui";
import { ColorField } from "../WidgetAppearance/ColorField";
import { DEFAULT_STACK_STYLE, STACK_RADIUS, type StackStyle } from "./desktopState";
import * as shape from "./shapeEditor.css";
import * as s from "./widgetEditor.css";

/** Sliders and typed colors change many times a second; save the settled value. */
export const STACK_STYLE_SAVE_DELAY = 250;

/** Stack-only look of one widget. Freeform shapes and colors are edited separately. */
export function StackStyleEditor({
  id,
  value,
  disabled = false,
  onSave,
}: {
  id: string;
  value: StackStyle | undefined;
  disabled?: boolean;
  onSave: (id: string, style: StackStyle | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState<StackStyle>(value ?? DEFAULT_STACK_STYLE);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<StackStyle | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (!pending.current) setDraft(value ?? DEFAULT_STACK_STYLE);
  }, [value]);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) saveRef.current(id, pending.current);
    },
    [id],
  );

  function change(patch: Partial<StackStyle>, delay = STACK_STYLE_SAVE_DELAY): void {
    const next = { ...draft, ...patch };
    setDraft(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      pending.current = null;
      onSave(id, next);
    }, delay);
  }
  function reset(): void {
    window.clearTimeout(timer.current);
    pending.current = null;
    setDraft(DEFAULT_STACK_STYLE);
    onSave(id, null);
  }

  return (
    <div className={s.options} aria-label="모아두기 꾸미기" role="group">
      <Switch
        label="테마에 따르기"
        checked={draft.followTheme}
        disabled={disabled}
        onChange={(event) => change({ followTheme: event.currentTarget.checked }, 0)}
      />
      <div className={s.colors}>
        <FormField label="배경 색상">
          <ColorField
            swatchLabel="배경 색상 선택"
            value={draft.backgroundColor}
            disabled={disabled || draft.followTheme}
            onValueChange={(backgroundColor) => change({ backgroundColor })}
          />
        </FormField>
        <FormField label="글자 색상">
          <ColorField
            swatchLabel="글자 색상 선택"
            value={draft.textColor}
            disabled={disabled || draft.followTheme}
            onValueChange={(textColor) => change({ textColor })}
          />
        </FormField>
      </div>
      <label className={shape.row}>
        <span>배경 투명도</span>
        <span className={shape.range}>
          <Slider
            aria-label="배경 투명도"
            min={0}
            max={100}
            value={draft.opacity}
            disabled={disabled}
            onChange={(event) => change({ opacity: event.currentTarget.valueAsNumber })}
          />
          <span className={shape.rangeValue} aria-hidden="true">
            {draft.opacity}%
          </span>
        </span>
      </label>
      <label className={shape.row}>
        <span>모서리</span>
        <span className={shape.range}>
          <Slider
            aria-label="모서리"
            min={STACK_RADIUS.min}
            max={STACK_RADIUS.max}
            value={draft.radius}
            disabled={disabled}
            onChange={(event) => change({ radius: event.currentTarget.valueAsNumber })}
          />
          <span className={shape.rangeValue} aria-hidden="true">
            {draft.radius}px
          </span>
        </span>
      </label>
      <Button size="small" variant="ghost" disabled={disabled || !value} onClick={reset}>
        기본 모습으로 되돌리기
      </Button>
    </div>
  );
}
