import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from "react";
import { Icon } from "@comet/icon";
import { tokenNames } from "@comet/token";
import {
  IconButton,
  WidgetBubble,
  WidgetHoverActions,
  WidgetStackSummary,
  widgetHoverHost,
} from "@comet/ui";
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
  hasStackCard,
  opensWidgetWindow,
  StackRowCard,
  useStackAction,
  widgetWindowCommand,
} from "./DesktopWidget";
import {
  DEFAULT_LAYOUT,
  useDesktopState,
  type DesktopLayout,
  type StackStyle,
} from "./desktopState";
import * as s from "./widgetStack.css";

export type { DesktopLayout, DesktopState } from "./desktopState";

/** Matches the root padding; the saved stack position is the window corner without a bubble. */
const STACK_PADDING = 12;

function isControl(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a"));
}

/**
 * Overrides the theme tokens for one stacked widget so every surface inside it follows.
 * The theme fill comes from `--comet-stack-theme-fill`, resolved on the stack container,
 * which keeps the override from referencing itself.
 */
export function stackStyleVars(style: StackStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const fill = style.followTheme ? "var(--comet-stack-theme-fill)" : style.backgroundColor;
  const vars: Record<string, string> = {
    [tokenNames["color/glass-panel"]]: `color-mix(in srgb, ${fill} ${style.opacity}%, transparent)`,
    "--comet-stack-radius": `${style.radius}px`,
  };
  if (!style.followTheme) {
    vars[tokenNames["color/ink"]] = style.textColor;
    vars[tokenNames["color/ink-2"]] = `color-mix(in srgb, ${style.textColor} 74%, transparent)`;
    vars[tokenNames["color/ink-3"]] = `color-mix(in srgb, ${style.textColor} 54%, transparent)`;
  }
  return vars as CSSProperties;
}

/** Bubbles open toward the larger free side of the screen from the capsule bar. */
function bubbleSide(layout: DesktopLayout): { above: boolean; end: boolean } {
  const saved = layout.stackPosition;
  if (!saved) {
    return {
      above: layout.anchor.startsWith("bottom"),
      end: layout.anchor.endsWith("right"),
    };
  }
  const screen = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };
  const top = screen.availTop ?? 0;
  const left = screen.availLeft ?? 0;
  return {
    above: saved.y > top + screen.availHeight / 2,
    end: saved.x > left + screen.availWidth / 2,
  };
}

function RowActions({
  widget,
  label,
  open,
  onCollapse,
  onError,
  handle,
}: {
  widget: WidgetView;
  label: string;
  open: boolean;
  onCollapse?: () => void;
  onError: (message: string) => void;
  handle?: {
    onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
    onDragEnd: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  };
}): ReactElement | null {
  const action = useStackAction(widget);
  useEffect(() => {
    if (action?.error) onError(action.error);
  }, [action?.error, onError]);
  const settings =
    open && action
      ? { label: action.label, onClick: action.open, disabled: action.busy }
      : undefined;
  const collapse = open && hasStackCard(widget.kind) ? onCollapse : undefined;
  if (!settings && !collapse && !handle) return null;
  return (
    <WidgetHoverActions
      aria-label={`${label} 동작`}
      settings={settings}
      onCollapse={collapse}
      collapseLabel={`${label} 접기`}
      handle={handle && { label: `${label} 순서 바꾸기`, draggable: true, ...handle }}
    />
  );
}

export function WidgetStack(): ReactElement {
  const { snapshot, error: widgetError } = useWidgets();
  const desktop = useDesktopState();
  const layout = desktop.state ?? DEFAULT_LAYOUT;
  const editing = desktop.state?.editing ?? false;
  const [expanded, setExpanded] = useState<string[]>([]);
  const [bubble, setBubble] = useState<string | null>(null);
  const [tail, setTail] = useState(28);
  const [now, setNow] = useState(Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const lastFit = useRef("");
  const dragging = useRef<string | null>(null);
  const drag = useWindowDrag(isDesktop(), desktop.setError);
  const widgets = snapshot?.widgets ?? [];
  const available = desktopWidgets(widgets);
  const ordered = layout.order
    .map((id) => available.find((widget) => widget.id === id))
    .filter((widget): widget is WidgetView => Boolean(widget));
  const folded = !editing && ordered.length > 0 && layout.overlapped;
  const bubbled = folded ? ordered.find((widget) => widget.id === bubble) : undefined;
  const side = bubbleSide(layout);
  const isOpen = (id: string): boolean => !editing && expanded.includes(id);
  const name = (widget: WidgetView): string =>
    snapshot?.catalog.find((entry) => entry.id === widget.kind)?.name ??
    desktopSummary(widget, now, widgets).title;
  const styleOf = (id: string): StackStyle | undefined => layout.stackStyles?.[id];

  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      document.documentElement.classList.remove(transparentDocument);
    };
  }, []);
  useEffect(() => {
    if (editing) {
      setExpanded([]);
      setBubble(null);
    }
  }, [editing]);
  useEffect(() => {
    if (!layout.overlapped) setBubble(null);
  }, [layout.overlapped]);
  // A bubble closes on any press outside it or the capsule bar, and when the window loses focus.
  const bubbleOpen = Boolean(bubbled);
  useEffect(() => {
    if (!bubbleOpen) return;
    const close = (): void => setBubble(null);
    const press = (event: globalThis.PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        (bubbleRef.current?.contains(target) || dockRef.current?.contains(target))
      )
        return;
      close();
    };
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [bubbleOpen]);
  // The tail points at the capsule that opened the bubble.
  useLayoutEffect(() => {
    const panel = bubbleRef.current;
    const index = bubbled ? ordered.indexOf(bubbled) : -1;
    const item = dockRef.current?.querySelectorAll("button")[index];
    if (!panel || !item) return;
    const box = panel.getBoundingClientRect();
    const target = item.getBoundingClientRect();
    const center = target.left + target.width / 2 - box.left;
    setTail(Math.round(Math.min(Math.max(center, 22), Math.max(22, box.width - 22))));
  });
  // The window hugs the measured content so empty transparent space never blocks the desktop.
  const loaded = desktop.state !== null;
  const setError = desktop.setError;
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !loaded || !isDesktop()) return;
    const fit = (): void => {
      const bounds = root.getBoundingClientRect();
      const size = {
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height),
      };
      // How far a bubble above or before the capsule bar pushed the usual top-left content.
      const lead = {
        x: Math.max(0, (dockRef.current?.offsetLeft ?? STACK_PADDING) - STACK_PADDING),
        y: Math.max(0, (toolbarRef.current?.offsetTop ?? STACK_PADDING) - STACK_PADDING),
      };
      const key = `${size.width}x${size.height}@${lead.x},${lead.y}`;
      if (!size.width || !size.height || key === lastFit.current) return;
      lastFit.current = key;
      void command("fit_widget_stack", { ...size, lead }).catch((cause: unknown) =>
        setError(errorText(cause)),
      );
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
  function toggle(id: string): void {
    if (editing) {
      desktop.select(id);
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
  function pick(id: string): void {
    const widget = ordered.find((item) => item.id === id);
    if (!widget) return;
    if (opensWidgetWindow(widget.kind)) {
      setBubble(null);
      void command(...widgetWindowCommand(widget)).catch((cause: unknown) =>
        desktop.setError(errorText(cause)),
      );
      return;
    }
    setBubble((current) => (current === id ? null : id));
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
  function handleFor(widget: WidgetView) {
    return {
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        dragging.current = widget.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", widget.id);
        const row = event.currentTarget.closest("[data-desktop-widget]");
        if (row instanceof HTMLElement) {
          const box = row.getBoundingClientRect();
          event.dataTransfer.setDragImage(row, event.clientX - box.left, event.clientY - box.top);
        }
      },
      onDragEnd: () => (dragging.current = null),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          shift(widget.id, event.key === "ArrowUp" ? -1 : 1);
        }
      },
    };
  }

  const dragHandlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!isControl(event.target)) drag.onPointerDown(event);
    },
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.reset,
    onPointerCancel: drag.reset,
  };

  const bubbleView = bubbled && (
    <div
      className={s.bubbleSlot}
      style={{ width: layout.width, ...stackStyleVars(styleOf(bubbled.id)) }}
    >
      <WidgetBubble
        ref={bubbleRef}
        aria-label={name(bubbled)}
        placement={side.above ? "above" : "below"}
        tailOffset={tail}
        className={`${s.bubble} ${widgetHoverHost}`}
        data-styled={styleOf(bubbled.id) ? true : undefined}
        data-desktop-widget={bubbled.id}
        data-widget-kind={bubbled.kind}
      >
        {hasStackCard(bubbled.kind) ? (
          <StackRowCard
            widget={bubbled}
            widgets={widgets}
            now={now}
            onCollapse={() => setBubble(null)}
          />
        ) : (
          <ExpandedDesktopWidget
            widget={bubbled}
            widgets={widgets}
            now={now}
            onCollapse={() => setBubble(null)}
            act={act}
          />
        )}
        <RowActions widget={bubbled} label={name(bubbled)} open onError={desktop.setError} />
      </WidgetBubble>
    </div>
  );

  return (
    <main className={s.window} aria-label="바탕화면 위젯 모아두기">
      <div
        ref={rootRef}
        className={s.root}
        data-editing={editing || undefined}
        data-align={folded && side.end ? "end" : undefined}
      >
        {side.above && bubbleView}
        <header
          ref={toolbarRef}
          className={`${s.toolbar} ${editing ? s.toolbarVisible : ""}`}
          {...dragHandlers}
        >
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
                onClick={() =>
                  void desktop.run("set_widget_desktop_editing", {
                    editing: true,
                  })
                }
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
        {folded ? (
          <div ref={dockRef} className={s.capsuleDock} {...dragHandlers}>
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
                  active: running || widget.id === bubbled?.id,
                  live: running,
                };
              })}
              onSelect={pick}
            />
          </div>
        ) : (
          <div
            className={s.stack}
            style={{ width: layout.width, gap: 10 }}
            onDragOver={(event) => {
              if (dragging.current) event.preventDefault();
            }}
            onDrop={(event) => {
              const id = dragging.current;
              dragging.current = null;
              if (!id || event.defaultPrevented) return;
              event.preventDefault();
              move(id, null);
            }}
          >
            {ordered.map((widget) => {
              const open = isOpen(widget.id);
              const label = name(widget);
              const look = editing ? undefined : styleOf(widget.id);
              return (
                <div
                  key={widget.id}
                  data-desktop-widget={widget.id}
                  data-widget-kind={widget.kind}
                  data-styled={look ? true : undefined}
                  style={stackStyleVars(look)}
                  className={`${s.row} ${editing ? s.editingRow : widgetHoverHost} ${
                    desktop.selected === widget.id ? s.selectedRow : ""
                  }`}
                  draggable={editing}
                  onDragStart={(event) => {
                    if (!editing) return;
                    dragging.current = widget.id;
                    event.dataTransfer.setData("text/plain", widget.id);
                  }}
                  onDragEnd={() => (dragging.current = null)}
                  onDragOver={(event) => {
                    if (dragging.current) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const id = dragging.current;
                    dragging.current = null;
                    if (!id) return;
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
                  ) : (
                    <>
                      {open && hasStackCard(widget.kind) ? (
                        <StackRowCard
                          widget={widget}
                          widgets={widgets}
                          now={now}
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
                      <RowActions
                        widget={widget}
                        label={label}
                        open={open}
                        onCollapse={() => toggle(widget.id)}
                        onError={desktop.setError}
                        handle={handleFor(widget)}
                      />
                    </>
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
        {!side.above && bubbleView}
        {(desktop.error || widgetError) && (
          <p className={s.error} role="alert">
            {desktop.error || widgetError}
          </p>
        )}
      </div>
    </main>
  );
}
