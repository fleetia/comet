import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import { IconButton } from "../controls";
import * as styles from "./dialog.css";

export type DialogProps = Omit<ComponentPropsWithoutRef<"dialog">, "children" | "open" | "title"> & {
  children: ReactNode;
  title: ReactNode;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** `sheet` is an editing panel with a close button; `confirm` is a short question with actions. */
  variant?: "sheet" | "confirm";
  /** Maximum width of a sheet. Confirm dialogs keep one compact width. */
  size?: "small" | "medium" | "large";
  footer?: ReactNode;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

const scrollLocks = new WeakMap<HTMLElement, { count: number; overflow: string }>();

function useBodyScrollLock(dialog: RefObject<HTMLDialogElement | null>, isOpen: boolean): void {
  useEffect(() => {
    const body = dialog.current?.ownerDocument.body;
    if (!isOpen || !body) return;
    const lock = scrollLocks.get(body) ?? { count: 0, overflow: body.style.overflow };
    if (lock.count === 0) body.style.overflow = "hidden";
    lock.count += 1;
    scrollLocks.set(body, lock);
    return () => {
      lock.count -= 1;
      if (lock.count > 0) return;
      body.style.overflow = lock.overflow;
      scrollLocks.delete(body);
    };
  }, [dialog, isOpen]);
}

export const Dialog = forwardRef<HTMLDialogElement, DialogProps>(
  (
    {
      children,
      title,
      isOpen,
      onOpenChange,
      variant = "sheet",
      size = "medium",
      footer,
      closeLabel = "닫기",
      initialFocusRef,
      className,
      onCancel,
      onClick,
      onClose,
      "aria-labelledby": labelledBy,
      ...props
    },
    ref,
  ) => {
    const element = useRef<HTMLDialogElement | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    const shown = useRef(false);
    // Closes requested by this component must not be reported back as user dismissals.
    const ownCloses = useRef(0);
    const titleId = `comet-dialog-${useId()}-title`;
    const confirm = variant === "confirm";
    useBodyScrollLock(element, isOpen);

    function setRef(node: HTMLDialogElement | null): void {
      element.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }

    function hide(node: HTMLDialogElement): void {
      if (typeof node.close === "function") {
        ownCloses.current += 1;
        node.close();
      } else {
        node.removeAttribute("open");
      }
    }

    function restoreFocus(): void {
      if (shown.current && opener.current?.isConnected) opener.current.focus();
      shown.current = false;
    }

    useEffect(() => {
      const node = element.current;
      if (!node) return;
      if (isOpen) {
        if (!shown.current) {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        if (!node.open) {
          if (typeof node.showModal === "function") node.showModal();
          else node.setAttribute("open", "");
        }
        shown.current = true;
        initialFocusRef?.current?.focus();
        return;
      }
      if (node.open) hide(node);
      restoreFocus();
    }, [initialFocusRef, isOpen]);

    useEffect(
      () => () => {
        const node = element.current;
        if (node?.open) hide(node);
        restoreFocus();
      },
      [],
    );

    return (
      <dialog
        {...props}
        ref={setRef}
        aria-labelledby={labelledBy ?? titleId}
        aria-modal="true"
        data-variant={variant}
        data-size={confirm ? undefined : size}
        className={[
          styles.dialog,
          styles.variants[variant],
          !confirm && styles.sizes[size],
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        onCancel={(event) => {
          onCancel?.(event);
          const prevented = event.defaultPrevented;
          event.preventDefault();
          if (!prevented) onOpenChange(false);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && event.target === event.currentTarget) onOpenChange(false);
        }}
        onClose={(event) => {
          onClose?.(event);
          if (ownCloses.current > 0) {
            ownCloses.current -= 1;
            return;
          }
          if (isOpen) onOpenChange(false);
        }}
      >
        <div className={[styles.layout, confirm && styles.confirmLayout].filter(Boolean).join(" ")}>
          {confirm ? (
            <h2 id={titleId} className={styles.confirmTitle}>
              {title}
            </h2>
          ) : (
            <header className={styles.header}>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              <IconButton icon="close" aria-label={closeLabel} onClick={() => onOpenChange(false)} />
            </header>
          )}
          <div className={confirm ? styles.confirmBody : styles.body}>{children}</div>
          {footer ? (
            <footer className={confirm ? styles.confirmFooter : styles.footer}>{footer}</footer>
          ) : null}
        </div>
      </dialog>
    );
  },
);

Dialog.displayName = "Dialog";
