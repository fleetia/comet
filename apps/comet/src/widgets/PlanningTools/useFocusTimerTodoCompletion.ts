import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { errorText } from "../../hooks/useSnapshot";
import { text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";

export type FocusTimerTodoCompletion = {
  completingTodo: boolean;
  completingTodoLock: RefObject<string | null>;
  completeTodo: (
    event: ChangeEvent<HTMLInputElement>,
    linked: DataRecord,
    todo: WidgetView,
    todoCompletionKey: string,
  ) => Promise<void>;
};

export function useFocusTimerTodoCompletion(
  act: ToolAction,
  setError: Dispatch<SetStateAction<string>>,
): FocusTimerTodoCompletion {
  const [completingTodo, setCompletingTodo] = useState(false);
  const completingTodoLock = useRef<string | null>(null);
  async function completeTodo(
    event: ChangeEvent<HTMLInputElement>,
    linked: DataRecord,
    todo: WidgetView,
    todoCompletionKey: string,
  ): Promise<void> {
    if (
      !event.currentTarget.checked ||
      event.currentTarget.disabled ||
      typeof linked.completedAt === "number" ||
      completingTodoLock.current === todoCompletionKey
    ) {
      return;
    }
    completingTodoLock.current = todoCompletionKey;
    setCompletingTodo(true);
    setError("");
    let saved = false;
    try {
      saved = await act("complete", { id: text(linked.id) }, todo);
      if (!saved) {
        setError("할 일을 완료로 표시하지 못했어요. 다시 시도해 주세요.");
      }
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      if (!saved && completingTodoLock.current === todoCompletionKey) {
        completingTodoLock.current = null;
      }
      setCompletingTodo(false);
    }
  }
  return { completingTodo, completingTodoLock, completeTodo };
}
