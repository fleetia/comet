import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { themes, tokens } from "@comet/token";
import * as styles from "./motion.css";

function milliseconds(value: string, fallback: number): number {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return fallback;
  }
  return value.endsWith("ms") ? amount : amount * 1000;
}

export type MotionProps = HTMLAttributes<HTMLDivElement> & {
  preset?: "pop" | "slide" | "fade";
  open?: boolean;
  staggerIndex?: number;
  onExitComplete?: () => void;
};

export const Motion = forwardRef<HTMLDivElement, MotionProps>(
  (
    { preset = "pop", open = true, staggerIndex = 0, onExitComplete, className, style, ...props },
    ref,
  ) => {
    const [isPresent, setIsPresent] = useState(open);
    const [exitFrom, setExitFrom] = useState<{ opacity: string; transform: string } | null>(null);
    const elementRef = useRef<HTMLDivElement>(null);
    const setElementRef = useCallback(
      (element: HTMLDivElement | null) => {
        elementRef.current = element;
        if (typeof ref === "function") {
          return ref(element);
        } else if (ref) {
          ref.current = element;
        }
      },
      [ref],
    );

    useLayoutEffect(() => {
      if (open) {
        setIsPresent(true);
        setExitFrom(null);
        return;
      }
      const element = elementRef.current;
      if (!isPresent || !element || exitFrom) {
        return;
      }
      const current = getComputedStyle(element);
      setExitFrom({ opacity: current.opacity || "1", transform: current.transform || "none" });
    }, [open, isPresent, exitFrom]);

    useEffect(() => {
      const element = elementRef.current;
      if (open || !isPresent || !element || !exitFrom) {
        return;
      }

      let hasFinished = false;
      function finish(): void {
        if (hasFinished) {
          return;
        }
        hasFinished = true;
        setIsPresent(false);
        onExitComplete?.();
      }
      function handleAnimationEnd(event: AnimationEvent): void {
        if (event.target === element && event.animationName === styles.exit) {
          finish();
        }
      }

      const media = window.matchMedia?.(styles.reducedMotionQuery);
      const animation = getComputedStyle(element);
      const isReduced = media?.matches || element.closest('[data-comet-motion="reduced"]');
      const hasNoAnimation = animation.animationName === "none";
      const duration = milliseconds(
        animation.animationDuration,
        themes.dark["duration/duration-fast"] * 1000,
      );
      const delay = Math.max(0, milliseconds(animation.animationDelay, 0));
      const timeout = window.setTimeout(
        finish,
        isReduced || hasNoAnimation ? 0 : duration + delay + 50,
      );
      function handleMotionChange(event: MediaQueryListEvent): void {
        if (event.matches) {
          finish();
        }
      }
      element.addEventListener("animationend", handleAnimationEnd);
      media?.addEventListener("change", handleMotionChange);
      const observer = new MutationObserver(() => {
        if (element.closest('[data-comet-motion="reduced"]')) {
          finish();
        }
      });
      let motionRoot = element.closest("[data-comet-motion]");
      while (motionRoot) {
        observer.observe(motionRoot, { attributes: true, attributeFilter: ["data-comet-motion"] });
        motionRoot = motionRoot.parentElement?.closest("[data-comet-motion]") ?? null;
      }
      return () => {
        window.clearTimeout(timeout);
        element.removeEventListener("animationend", handleAnimationEnd);
        media?.removeEventListener("change", handleMotionChange);
        observer.disconnect();
      };
    }, [open, isPresent, exitFrom, onExitComplete]);

    if (!isPresent) {
      return null;
    }
    const index = Number.isFinite(staggerIndex) ? Math.max(0, Math.floor(staggerIndex)) : 0;
    const isExiting = !open && exitFrom !== null;
    const motionStyle: CSSProperties &
      Record<"--comet-motion-exit-opacity" | "--comet-motion-exit-transform", string> = {
      ...style,
      animationDelay: isExiting ? "0s" : `calc(${tokens["duration/duration-stagger"]} * ${index})`,
      "--comet-motion-exit-opacity": exitFrom?.opacity ?? "1",
      "--comet-motion-exit-transform": exitFrom?.transform ?? "none",
    };
    return (
      <div
        {...props}
        ref={setElementRef}
        inert={!open || props.inert}
        aria-hidden={open ? props["aria-hidden"] : true}
        data-state={isExiting ? "exiting" : "entering"}
        className={[styles.presence, styles.presets[preset], className].filter(Boolean).join(" ")}
        style={motionStyle}
      />
    );
  },
);

Motion.displayName = "Motion";
