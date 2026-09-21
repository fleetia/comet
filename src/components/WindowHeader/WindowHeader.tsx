import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { IconButton } from "@fleetia/lagrange";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorText, isDesktop } from "../../hooks/useSnapshot";
import cometIcon from "../../../src-tauri/icons/source.svg";
import * as s from "./windowHeader.css";
import * as ui from "../../lagrange.css";

type Props = {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  label: string;
  preview?: boolean;
  onClose?: () => Promise<void>;
  title?: string;
};

export function WindowHeader({
  children,
  actions,
  className = "",
  label,
  preview = false,
  onClose,
  title,
}: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const enabled = isDesktop() && !preview;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cursorTarget: Element | null = null;
    function getDragTarget(event: MouseEvent): Element | null {
      const header = headerRef.current;
      const target = event.target;
      if (
        !header ||
        event.clientX < 0 ||
        event.clientX >= document.documentElement.clientWidth ||
        event.clientY < 0 ||
        event.clientY >= header.getBoundingClientRect().bottom ||
        !(target instanceof Element) ||
        actionsRef.current?.contains(target) ||
        target.closest("button, a, input, select, textarea, label, summary, [contenteditable]") ||
        document.querySelector("dialog[open]")
      ) {
        return null;
      }
      return target;
    }
    function clearCursor(): void {
      cursorTarget?.classList.remove(s.grabTarget);
      cursorTarget = null;
    }
    function updateCursor(event: MouseEvent): void {
      const target = getDragTarget(event);
      if (target === cursorTarget) {
        return;
      }
      clearCursor();
      cursorTarget = target;
      cursorTarget?.classList.add(s.grabTarget);
    }
    function drag(event: MouseEvent): void {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.detail > 1 ||
        !getDragTarget(event)
      ) {
        return;
      }
      event.preventDefault();
      void getCurrentWindow()
        .startDragging()
        .catch((cause: unknown) => setError(errorText(cause)));
    }
    document.addEventListener("mousedown", drag);
    document.addEventListener("mousemove", updateCursor);
    document.addEventListener("scroll", clearCursor, true);
    document.addEventListener("focusin", clearCursor);
    document.addEventListener("keydown", clearCursor);
    document.documentElement.addEventListener("mouseleave", clearCursor);
    window.addEventListener("resize", clearCursor);
    window.addEventListener("blur", clearCursor);
    return () => {
      clearCursor();
      document.removeEventListener("mousedown", drag);
      document.removeEventListener("mousemove", updateCursor);
      document.removeEventListener("scroll", clearCursor, true);
      document.removeEventListener("focusin", clearCursor);
      document.removeEventListener("keydown", clearCursor);
      document.documentElement.removeEventListener("mouseleave", clearCursor);
      window.removeEventListener("resize", clearCursor);
      window.removeEventListener("blur", clearCursor);
    };
  }, [enabled]);
  async function close(): Promise<void> {
    setError(null);
    try {
      await (onClose ? onClose() : getCurrentWindow().close());
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <>
      <header ref={headerRef} className={className}>
        <div className={s.header}>
          <div className={s.title}>
            {title ? (
              <div className={s.brand} title={title}>
                <img
                  className={s.icon}
                  src={cometIcon}
                  alt=""
                  width={16}
                  height={16}
                  draggable={false}
                />
                <span className={s.brandName}>comet</span>
                <span className={s.windowName}>{title}</span>
              </div>
            ) : (
              children
            )}
          </div>
          <div ref={actionsRef} className={s.actions}>
            {actions}
            <IconButton
              className={s.close}
              variant="quiet"
              size="compact"
              label={label}
              disabled={!enabled}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => void close()}
            >
              ×
            </IconButton>
          </div>
        </div>
      </header>
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
