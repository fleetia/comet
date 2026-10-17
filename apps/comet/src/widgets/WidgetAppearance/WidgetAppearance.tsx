import { Button, FormField, Heading, Surface, Text } from "../../ui";
import { ColorField } from "./ColorField";
import { PlacementPicker } from "./PlacementPicker";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import {
  appearanceInput,
  backgroundPosition,
  getWidgetAppearance,
  placementAlignment,
  placementLabel,
  widgetBackgroundUrl,
  type Placement,
  type WidgetAppearance,
} from "../widgetAppearance";
import * as s from "./widgetAppearance.css";

/** Typing in a color field waits this long before saving; picks save immediately. */
export const APPEARANCE_SAVE_DELAY = 400;

export function WidgetAppearance({
  widget,
  disabled = false,
  compact = false,
}: {
  widget: WidgetView;
  disabled?: boolean;
  compact?: boolean;
}): ReactElement {
  const [edited, setEdited] = useState<WidgetAppearance | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseline = getWidgetAppearance(widget.data);
  const draft = edited ?? baseline;
  const revision = useRef(widget.revision);
  revision.current = Math.max(revision.current, widget.revision);
  const queued = useRef<WidgetAppearance | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const widgetId = useRef(widget.id);
  widgetId.current = widget.id;
  const imageUrl = widgetBackgroundUrl(widget);

  async function flush(): Promise<void> {
    window.clearTimeout(timer.current);
    const value = queued.current;
    if (inFlight.current || !value) return;
    if (!isDesktop()) {
      setError("표시 설정 저장은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    queued.current = null;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const expectedRevision = revision.current;
    try {
      await command("configure_widget_appearance", {
        id: widgetId.current,
        expectedRevision,
        input: appearanceInput(value),
      });
      revision.current = Math.max(revision.current, expectedRevision + 1);
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (queued.current) void flush();
    }
  }

  function change(value: Partial<WidgetAppearance>, delay = 0): void {
    if (disabled || imageBusy) return;
    const next = { ...draft, ...value };
    setEdited(next);
    queued.current = next;
    window.clearTimeout(timer.current);
    if (delay > 0) timer.current = window.setTimeout(() => void flush(), delay);
    else void flush();
  }

  // Once the saved widget data matches the local edit, show the stored value again.
  useEffect(() => {
    if (edited && !saving && !queued.current && JSON.stringify(edited) === JSON.stringify(baseline))
      setEdited(null);
  }, [edited, saving, baseline]);

  // Leaving the panel (another widget selected) still saves the last typed color.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      if (queued.current) void flushRef.current();
    },
    [],
  );

  async function changeBackground(
    action: "choose_widget_background" | "remove_widget_background",
  ): Promise<void> {
    if (!isDesktop()) {
      setError("배경 이미지는 데스크톱 앱에서 선택할 수 있어요.");
      return;
    }
    if (imageBusy || saving || disabled) return;
    setImageBusy(true);
    setError(null);
    try {
      await command(action, { id: widget.id, expectedRevision: revision.current });
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setImageBusy(false);
    }
  }

  const locked = disabled || imageBusy;
  const alignment = placementAlignment(draft.textPosition);
  const preview =
    widget.kind === "weather"
      ? { title: "서울", value: "23°C · 맑음" }
      : { title: "시계·기념일", value: "14:20 · D-12" };
  return (
    <section className={s.settings} aria-label="색상·글자">
      <div className={s.body}>
        {!compact && (
          <Surface tone="accent" className={s.previewSurface}>
            <Text variant="caption">미리보기</Text>
            <div
              className={s.preview}
              style={{
                backgroundColor: draft.backgroundColor,
                backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
                backgroundPosition: backgroundPosition(draft.backgroundPosition),
                color: draft.textColor,
                ...alignment,
              }}
            >
              <div className={s.previewText}>
                <strong className={s.previewTitle}>{preview.title}</strong>
                <span className={s.previewValue}>{preview.value}</span>
                <span className={s.previewCaption}>14:20 · 표시 설정 예시</span>
              </div>
            </div>
          </Surface>
        )}
        {!compact && (
          <Heading level={4} variant="subsection" className={s.editHeading}>
            색상·글자
          </Heading>
        )}
        <div className={s.colors}>
          <FormField label="배경 색상">
            <ColorField
              className={s.colorField}
              swatchLabel="배경 색상 선택"
              value={draft.backgroundColor}
              disabled={locked}
              onValueChange={(value) => change({ backgroundColor: value }, APPEARANCE_SAVE_DELAY)}
            />
          </FormField>
          <FormField label="글자 색상">
            <ColorField
              className={s.colorField}
              swatchLabel="글자 색상 선택"
              value={draft.textColor}
              disabled={locked}
              onValueChange={(value) => change({ textColor: value }, APPEARANCE_SAVE_DELAY)}
            />
          </FormField>
        </div>
        {!compact && (
          <div className={s.fileActions}>
            <Button
              variant="secondary"
              disabled={locked || saving}
              onClick={() => void changeBackground("choose_widget_background")}
            >
              {imageUrl ? "배경 이미지 바꾸기" : "배경 이미지 선택"}
            </Button>
            <Button
              variant="secondary"
              disabled={locked || saving || !imageUrl}
              onClick={() => void changeBackground("remove_widget_background")}
            >
              이미지 제거
            </Button>
          </div>
        )}
        <div className={s.positions}>
          {(!compact || imageUrl) && (
            <div className={s.placementField}>
              <strong>이미지 위치</strong>
              <PlacementPicker
                className={s.placementPicker}
                label="배경 이미지 위치"
                value={draft.backgroundPosition}
                disabled={locked}
                getItemLabel={placementLabel}
                onValueChange={(value: Placement) => change({ backgroundPosition: value })}
              />
            </div>
          )}
          <div className={s.placementField}>
            <strong>글자 위치</strong>
            <PlacementPicker
              className={s.placementPicker}
              label="글자 위치"
              value={draft.textPosition}
              disabled={locked}
              getItemLabel={placementLabel}
              onValueChange={(value: Placement) => change({ textPosition: value })}
            />
          </div>
        </div>
        <div className={s.status}>
          {saving && (
            <Text variant="caption" tone="muted" role="status">
              저장하고 있어요.
            </Text>
          )}
          {error && (
            <>
              <p className={s.error} role="alert">
                {error}
              </p>
              <Button
                size="compact"
                variant="secondary"
                disabled={locked || saving}
                onClick={() => {
                  queued.current = draft;
                  void flush();
                }}
              >
                다시 저장
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
