import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorText, isDesktop } from "../../hooks/useSnapshot";
import cometIcon from "../../../src-tauri/icons/source.svg";
import * as s from "./windowHeader.css";
import * as ui from "../../common.css";

type Props = {
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  label: string;
  preview?: boolean;
  onClose?: () => Promise<void>;
  title?: string;
  nativeControls?: boolean;
};

export function WindowHeader({
  children,
  actions,
  className = "",
  label,
  preview = false,
  onClose,
  title,
  nativeControls = false,
}: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const enabled = isDesktop() && !preview;
  const isMac = /Mac/i.test(navigator.platform);
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
        document.querySelector('dialog[open], [data-window-resizing="true"]')
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
        <div
          className={`${s.header} ${!isMac && (title || children || actions) ? (nativeControls ? s.captionSpaceAll : s.captionSpaceClose) : ""}`}
        >
          {isMac && (
            <div className={s.trafficControls} aria-label="창 제어">
              <button
                type="button"
                className={s.trafficClose}
                aria-label={label}
                disabled={!enabled}
                onClick={() => void close()}
              />
              {nativeControls ? (
                <>
                  <button
                    type="button"
                    className={s.trafficMinimize}
                    aria-label="최소화"
                    disabled={!enabled}
                    onClick={() =>
                      void getCurrentWindow()
                        .minimize()
                        .catch((cause: unknown) => setError(errorText(cause)))
                    }
                  />
                  <button
                    type="button"
                    className={s.trafficMaximize}
                    aria-label="창 크기 전환"
                    disabled={!enabled}
                    onClick={() =>
                      void getCurrentWindow()
                        .toggleMaximize()
                        .catch((cause: unknown) => setError(errorText(cause)))
                    }
                  />
                </>
              ) : (
                <>
                  <span className={s.trafficInactive} aria-hidden="true" />
                  <span className={s.trafficInactive} aria-hidden="true" />
                </>
              )}
            </div>
          )}
          <div className={`${s.title} ${isMac && title ? s.macTitle : ""}`}>
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
          </div>
          {!isMac && (
            <div className={s.captionControls} aria-label="창 제어">
              {nativeControls && (
                <>
                  <button
                    type="button"
                    className={s.captionButton}
                    aria-label="최소화"
                    disabled={!enabled}
                    onClick={() =>
                      void getCurrentWindow()
                        .minimize()
                        .catch((cause: unknown) => setError(errorText(cause)))
                    }
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M0 5h10" stroke="currentColor" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={s.captionButton}
                    aria-label="창 크기 전환"
                    disabled={!enabled}
                    onClick={() =>
                      void getCurrentWindow()
                        .toggleMaximize()
                        .catch((cause: unknown) => setError(errorText(cause)))
                    }
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
                    </svg>
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${s.captionButton} ${s.captionClose}`}
                aria-label={label}
                disabled={!enabled}
                onClick={() => void close()}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M0.5 0.5l9 9m0-9l-9 9" stroke="currentColor" />
                </svg>
              </button>
            </div>
          )}
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
