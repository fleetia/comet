import { useEffect, useImperativeHandle, useRef, useState, type MutableRefObject, type ReactElement } from "react";
import { Button, FormField, Slider, Switch } from "@comet/ui";
import { contrast } from "@comet/token/skin";
import { ColorField } from "../WidgetAppearance/ColorField";
import { DEFAULT_STACK_STYLE, STACK_INK_3_PERCENT, STACK_RADIUS, type StackStyle } from "./desktopState";
import * as shape from "./shapeEditor.css";
import * as s from "./widgetEditor.css";

/** Sliders and typed colors change many times a second; save the settled value. */
export const STACK_STYLE_SAVE_DELAY = 250;

function secondaryTextColor(background: string, text: string): string {
  const channels = [1, 3, 5].map((offset) => {
    const base = Number.parseInt(background.slice(offset, offset + 2), 16);
    const ink = Number.parseInt(text.slice(offset, offset + 2), 16);
    return base + (ink - base) * STACK_INK_3_PERCENT / 100;
  });
  return `rgb(${channels.join(" ")})`;
}

/** Stack-only look of one widget. Freeform shapes and colors are edited separately. */
export function StackStyleEditor({
  id,
  value,
  disabled = false,
  controlsRef,
  onPreview,
  onSave,
}: {
  id: string;
  value: StackStyle | undefined;
  disabled?: boolean;
  controlsRef: MutableRefObject<{ flush: () => void; cancel: () => void } | null>;
  onPreview: (id: string, style: StackStyle | null) => void;
  onSave: (id: string, style: StackStyle | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState<StackStyle>(value ?? DEFAULT_STACK_STYLE);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<StackStyle | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const radius = Math.min(draft.radius, STACK_RADIUS.max);

  useImperativeHandle(controlsRef, () => ({
    flush: () => {
      window.clearTimeout(timer.current);
      if (pending.current) {
        const next = pending.current;
        pending.current = null;
        saveRef.current(id, next);
      }
    },
    cancel: () => {
      window.clearTimeout(timer.current);
      pending.current = null;
      setDraft(value ?? DEFAULT_STACK_STYLE);
    },
  }));

  useEffect(() => {
    if (!pending.current) setDraft(value ?? DEFAULT_STACK_STYLE);
  }, [value]);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) saveRef.current(id, pending.current);
      controlsRef.current = null;
    },
    [id],
  );

  function change(patch: Partial<StackStyle>, delay = STACK_STYLE_SAVE_DELAY): void {
    const next = { ...draft, ...patch };
    setDraft(next);
    onPreview(id, next);
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
    onPreview(id, null);
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
      {!draft.followTheme &&
        /^#[0-9a-f]{6}$/i.test(draft.backgroundColor) &&
        /^#[0-9a-f]{6}$/i.test(draft.textColor) &&
        contrast(draft.backgroundColor, secondaryTextColor(draft.backgroundColor, draft.textColor)) < 4.5 && (
          <p className={s.hint}>글자와 배경의 대비가 낮아 읽기 어려울 수 있어요.</p>
        )}
      {draft.opacity < 100 && (
        <p className={s.hint}>투명한 배경에서는 바탕화면에 따라 글자가 읽기 어려울 수 있어요.</p>
      )}
      <label className={shape.row}>
        <span>배경 불투명도</span>
        <span className={shape.range}>
          <Slider
            aria-label="배경 불투명도"
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
            value={radius}
            disabled={disabled}
            onChange={(event) => change({ radius: event.currentTarget.valueAsNumber })}
          />
          <span className={shape.rangeValue} aria-hidden="true">
            {radius}px
          </span>
        </span>
      </label>
      <Button size="small" variant="ghost" disabled={disabled || !value} onClick={reset}>
        기본 모습으로 되돌리기
      </Button>
    </div>
  );
}
