import { IconButton, type WidgetShape } from "@comet/ui";
import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { useWidgets } from "../useWidgets";
import type { WidgetView } from "../types";
import { useTravelWidgets } from "../Travel/useTravelWidgets";
import {
  DEFAULT_APPEARANCE,
  backgroundPosition,
  getWidgetAppearance,
  placementAlignment,
  widgetBackgroundUrl,
} from "../widgetAppearance";
import { FreeformWidget } from "./DesktopWidget";
import { defaultShape, resizeShape } from "./desktopShape";
import { useDesktopState } from "./desktopState";
import { transparentDocument } from "../../components/companion.css";
import * as s from "./widgetDisplay.css";

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const RESIZE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-8, 0],
  ArrowRight: [8, 0],
  ArrowUp: [0, -8],
  ArrowDown: [0, 8],
};

function isControl(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a"));
}

const EMPTY: WidgetView[] = [];

export function WidgetDisplay({ id }: { id: string }): ReactElement {
  const { snapshot, error } = useWidgets();
  const desktop = useDesktopState();
  const [preview, setPreview] = useState<WidgetShape | null>(null);
  const resizing = useRef<{ pointerId: number; x: number; y: number; shape: WidgetShape } | null>(
    null,
  );
  const now = useNow();
  const all = useTravelWidgets(snapshot?.widgets ?? EMPTY);
  const widget = all.find((item) => item.id === id);
  const entry = snapshot?.catalog.find((item) => item.id === widget?.kind);
  const editing = desktop.state?.editing ?? false;
  const selected = desktop.selected === id;
  const appearance = getWidgetAppearance(widget?.data ?? {});
  const imageUrl = widget ? widgetBackgroundUrl(widget) : null;
  const alignment = placementAlignment(appearance.textPosition);
  const drag = useWindowDrag(isDesktop(), desktop.setError);
  const savedShape = desktop.state?.shapes?.[id];
  const shape = preview ?? savedShape;
  const name = entry?.name ?? "바탕화면 위젯";

  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    return () => document.documentElement.classList.remove(transparentDocument);
  }, []);
  useEffect(() => {
    if (!editing) setPreview(null);
  }, [editing]);

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    if (!widget || event.button !== 0 || desktop.busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      shape: savedShape ?? defaultShape(widget),
    };
  }
  function moveResize(event: PointerEvent<HTMLButtonElement>): void {
    const start = resizing.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPreview(resizeShape(start.shape, event.clientX - start.x, event.clientY - start.y));
  }
  function endResize(event: PointerEvent<HTMLButtonElement>): void {
    const start = resizing.current;
    if (!start || start.pointerId !== event.pointerId) return;
    resizing.current = null;
    const next = resizeShape(start.shape, event.clientX - start.x, event.clientY - start.y);
    if (next.width === start.shape.width && next.height === start.shape.height) {
      setPreview(null);
      return;
    }
    setPreview(next);
    void desktop
      .run("set_widget_desktop_shape", { id, shape: next })
      .finally(() => setPreview(null));
  }

  return (
    <main
      className={s.frame}
      aria-label={name}
      data-editing={editing || undefined}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={(event) => {
        if (editing && event.button === 0 && !drag.dragged() && !isControl(event.target))
          desktop.select(id);
        drag.reset();
      }}
      onPointerCancel={drag.reset}
    >
      {widget ? (
        <div className={s.content} role="region" aria-label={`${name} 내용`}>
          <FreeformWidget
            widget={widget}
            widgets={all}
            now={now}
            interactive={!editing}
            shape={shape}
            backgroundImage={imageUrl ?? undefined}
            backgroundColor={
              appearance.backgroundColor !== DEFAULT_APPEARANCE.backgroundColor
                ? appearance.backgroundColor
                : undefined
            }
            textColor={
              appearance.textColor !== DEFAULT_APPEARANCE.textColor
                ? appearance.textColor
                : undefined
            }
            imagePosition={backgroundPosition(appearance.backgroundPosition)}
            contentStyle={
              appearance.textPosition !== DEFAULT_APPEARANCE.textPosition
                ? { alignItems: alignment.justifyContent, justifyContent: alignment.alignItems }
                : undefined
            }
          />
        </div>
      ) : (
        <div className={s.unavailable} role={error ? "alert" : "status"}>
          <p>
            {error ||
              (snapshot ? "바탕화면에 놓을 수 없는 위젯이에요." : "위젯을 불러오고 있어요.")}
          </p>
          {snapshot && (
            <IconButton
              icon="close"
              aria-label="바탕화면 위젯 닫기"
              disabled={!isDesktop()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() =>
                void command("remove_widget_desktop_item", { id }).catch((cause: unknown) =>
                  desktop.setError(errorText(cause)),
                )
              }
            />
          )}
        </div>
      )}
      {editing && widget && (
        <>
          <span
            aria-hidden
            data-selected={selected || undefined}
            className={`${s.outline} ${selected ? s.selectedOutline : ""}`}
          />
          <IconButton
            className={s.remove}
            icon="minus"
            aria-label={`${name} 바탕화면에서 빼기`}
            disabled={desktop.busy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void desktop.run("remove_widget_desktop_item", { id })}
          />
          <button
            type="button"
            className={s.resize}
            aria-label={`${name} 크기 조절`}
            disabled={desktop.busy}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={() => {
              resizing.current = null;
              setPreview(null);
            }}
            onKeyDown={(event) => {
              const step = RESIZE_KEYS[event.key];
              if (!step || desktop.busy) return;
              event.preventDefault();
              void desktop.run("set_widget_desktop_shape", {
                id,
                shape: resizeShape(savedShape ?? defaultShape(widget), step[0], step[1]),
              });
            }}
          />
          {preview && (
            <span className={s.sizeBadge} role="status">
              {preview.width} × {preview.height}
            </span>
          )}
        </>
      )}
      {(desktop.error || (widget && error)) && (
        <p role="alert" className={s.error}>
          {desktop.error || error}
        </p>
      )}
    </main>
  );
}
