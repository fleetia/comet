import { useRef, type CompositionEvent, type KeyboardEvent } from "react";

export function useCompositionGuard() {
  const composing = useRef(false);
  return {
    onCompositionStart: (_event: CompositionEvent<HTMLFormElement>) => {
      composing.current = true;
    },
    onCompositionEnd: (_event: CompositionEvent<HTMLFormElement>) => {
      composing.current = false;
    },
    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => {
      if (
        event.key === "Enter" &&
        (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
      ) {
        event.preventDefault();
      }
    },
  };
}
