import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";
import { Icon } from "@comet/icon";
import { IconButton, WidgetStackSummary } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { transparentDocument } from "../../components/companion.css";
import { useWidgets } from "../useWidgets";
import type { WidgetView } from "../types";
import { record, type DataRecord } from "../toolData";
import {
  desktopSummary,
  desktopWidgets,
  ExpandedDesktopWidget,
  CollapsedDesktopWidget,
  hasStackFooter,
  StackRowWithFooter,
} from "./DesktopWidget";
import { DEFAULT_LAYOUT, useDesktopState } from "./desktopState";
import * as s from "./widgetStack.css";

export type { DesktopLayout, DesktopState } from "./desktopState";

const STACK_WIDTHS = { narrow: 330, normal: 370, wide: 410 } as const;

function isControl(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a"));
}

export function WidgetStack(): ReactElement {
  const { snapshot, error: widgetError } = useWidgets();
  const desktop = useDesktopState();
  const layout = desktop.state ?? DEFAULT_LAYOUT;
  const editing = desktop.state?.editing ?? false;
  const pinned = layout.pinned ?? [];
  const [expanded, setExpanded] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const lastFit = useRef("");
  const dragging = useRef<string | null>(null);
  const drag = useWindowDrag(isDesktop(), desktop.setError);
  const widgets = snapshot?.widgets ?? [];
  const available = desktopWidgets(widgets);
  const ordered = layout.order
    .map((id) => available.find((widget) => widget.id === id))
    .filter((widget): widget is WidgetView => Boolean(widget));
  const isOpen = (id: string): boolean =>
    !editing && (expanded.includes(id) || pinned.includes(id));
  const collapsed =
    !editing && ordered.length > 0 && layout.overlapped && !ordered.some((w) => isOpen(w.id));
  const name = (widget: WidgetView): string =>
    snapshot?.catalog.find((entry) => entry.id === widget.kind)?.name ??
    desktopSummary(widget, now, widgets).title;

  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      document.documentElement.classList.remove(transparentDocument);
    };
  }, []);
  useEffect(() => {
    if (editing) setExpanded([]);
  }, [editing]);
  // The window hugs the measured content so empty transparent space never blocks the desktop.
  const loaded = desktop.state !== null;
  const setError = desktop.setError;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !loaded || !isDesktop()) return;
    const fit = (): void => {
      const bounds = root.getBoundingClientRect();
      const size = { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
      const key = `${size.width}x${size.height}`;
      if (!size.width || !size.height || key === lastFit.current) return;
      lastFit.current = key;
      void command("fit_widget_stack", size).catch((cause: unknown) => setError(errorText(cause)));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    return () => observer.disconnect();
  }, [loaded, setError]);

  async function act(
    action: string,
    input: DataRecord = {},
    widget?: WidgetView,
  ): Promise<boolean> {
    if (!widget || !isDesktop()) return false;
    try {
      await command("execute_widget", {
        request: {
          requestId: crypto.randomUUID(),
          instanceId: widget.id,
          expectedRevision: widget.revision,
          action,
          input,
        },
      });
      return true;
    } catch (cause: unknown) {
      desktop.setError(errorText(cause));
      return false;
    }
  }
  function pin(id: string, checked: boolean): void {
    void desktop.configure({
      pinned: checked
        ? [...pinned.filter((item) => item !== id), id]
        : pinned.filter((item) => item !== id),
    });
  }
  function toggle(id: string): void {
    if (editing) {
      desktop.select(id);
      return;
    }
    if (pinned.includes(id)) {
      pin(id, false);
      setExpanded((previous) => previous.filter((item) => item !== id));
      return;
    }
    setExpanded((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : layout.oneExpanded
          ? [id]
          : [...previous, id],
    );
  }
  function move(id: string, before: string | null): void {
    const order = layout.order.filter((item) => item !== id);
    const index = before === null ? order.length : order.indexOf(before);
    order.splice(index < 0 ? order.length : index, 0, id);
    if (order.join() !== layout.order.join()) void desktop.configure({ order });
  }
  function shift(id: string, offset: number): void {
    const index = layout.order.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= layout.order.length) return;
    move(id, offset < 0 ? layout.order[target] : (layout.order[target + 1] ?? null));
  }
  function remove(widget: WidgetView): void {
    if (desktop.selected === widget.id) desktop.select(null);
    void desktop.run("remove_widget_desktop_item", { id: widget.id });
  }

  const dragHandlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!isControl(event.target)) drag.onPointerDown(event);
    },
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.reset,
    onPointerCancel: drag.reset,
  };

  return (
    <main className={s.window} aria-label="바탕화면 위젯 모아두기">
      <div ref={rootRef} className={s.root} data-editing={editing || undefined}>
        <header className={`${s.toolbar} ${editing ? s.toolbarVisible : ""}`} {...dragHandlers}>
          {editing ? (
            <span className={s.movePill}>
              <Icon name="move" size={14} />
              끌어서 모아두기 옮기기
            </span>
          ) : (
            <span className={s.grip} aria-hidden />
          )}
          {!editing && (
            <>
              <IconButton
                icon="pen"
                aria-label="바탕화면 위젯 편집"
                disabled={!desktop.state}
                onClick={() => void desktop.run("set_widget_desktop_editing", { editing: true })}
              />
              <IconButton
                icon="close"
                aria-label="모아두기 닫기"
                onClick={() =>
                  void command("close_widget_stack").catch((cause: unknown) =>
                    desktop.setError(errorText(cause)),
                  )
                }
              />
            </>
          )}
        </header>
        {collapsed ? (
          <div className={s.capsuleDock} {...dragHandlers}>
            <WidgetStackSummary
              aria-label="접어 둔 위젯"
              items={ordered.map((widget) => {
                const summary = desktopSummary(widget, now, widgets);
                const running =
                  widget.kind === "focus-timer" && record(widget.data).status === "running";
                return {
                  id: widget.id,
                  icon: summary.icon,
                  label: ["weather", "focus-timer", "preparation"].includes(widget.kind)
                    ? `${summary.title} ${summary.value}`
                    : summary.title,
                  active: running,
                  live: running,
                };
              })}
              onSelect={toggle}
            />
          </div>
        ) : (
          <div
            className={s.stack}
            style={{
              width: STACK_WIDTHS[layout.width],
              gap: 10,
            }}
            onDragOver={(event) => {
              if (editing && dragging.current) event.preventDefault();
            }}
            onDrop={(event) => {
              const id = dragging.current;
              dragging.current = null;
              if (!editing || !id || event.defaultPrevented) return;
              event.preventDefault();
              move(id, null);
            }}
          >
            {ordered.map((widget) => {
              const open = isOpen(widget.id);
              const label = name(widget);
              return (
                <div
                  key={widget.id}
                  data-desktop-widget={widget.id}
                  data-widget-kind={widget.kind}
                  className={`${s.row} ${editing ? s.editingRow : ""} ${
                    desktop.selected === widget.id ? s.selectedRow : ""
                  }`}
                  draggable={editing}
                  onDragStart={(event) => {
                    dragging.current = widget.id;
                    event.dataTransfer.setData("text/plain", widget.id);
                  }}
                  onDragEnd={() => (dragging.current = null)}
                  onDragOver={(event) => {
                    if (editing && dragging.current) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const id = dragging.current;
                    dragging.current = null;
                    if (!editing || !id) return;
                    event.preventDefault();
                    if (id !== widget.id) move(id, widget.id);
                  }}
                  onKeyDown={(event) => {
                    if (!editing || !event.altKey) return;
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      shift(widget.id, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                >
                  {editing ? (
                    <>
                      <CollapsedDesktopWidget
                        widget={widget}
                        widgets={widgets}
                        now={now}
                        editing
                        selected={desktop.selected === widget.id}
                        onExpand={() => desktop.select(widget.id)}
                      />
                      <IconButton
                        className={s.remove}
                        icon="minus"
                        aria-label={`${label} 바탕화면에서 빼기`}
                        disabled={desktop.busy}
                        onClick={() => remove(widget)}
                      />
                    </>
                  ) : open && hasStackFooter(widget.kind) ? (
                    <StackRowWithFooter
                      widget={widget}
                      widgets={widgets}
                      now={now}
                      pinned={pinned.includes(widget.id)}
                      onPinnedChange={(checked) => pin(widget.id, checked)}
                      onCollapse={() => toggle(widget.id)}
                    />
                  ) : open ? (
                    <ExpandedDesktopWidget
                      widget={widget}
                      widgets={widgets}
                      now={now}
                      onCollapse={() => toggle(widget.id)}
                      act={act}
                    />
                  ) : (
                    <CollapsedDesktopWidget
                      widget={widget}
                      widgets={widgets}
                      now={now}
                      onExpand={() => toggle(widget.id)}
                    />
                  )}
                </div>
              );
            })}
            {!desktop.state && <p role="status">바탕화면 위젯을 불러오고 있어요.</p>}
            {desktop.state && ordered.length === 0 && (
              <p role="status" className={s.notice}>
                바탕화면 위젯 편집에서 위젯을 놓아 주세요.
              </p>
            )}
          </div>
        )}
        {(desktop.error || widgetError) && (
          <p className={s.error} role="alert">
            {desktop.error || widgetError}
          </p>
        )}
      </div>
    </main>
  );
}
