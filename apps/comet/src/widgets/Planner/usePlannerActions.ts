import { useRef, useState } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";

export type PlannerFailure = { message: string; saving: boolean };

export type PlannerActions = {
  failure: PlannerFailure | null;
  setFailure: (failure: PlannerFailure | null) => void;
  notice: string;
  setNotice: (notice: string) => void;
  busy: boolean;
  run: (operation: () => Promise<unknown>, saving?: boolean) => Promise<boolean>;
  act: ToolAction;
};

export function usePlannerActions({
  todo,
  reload,
}: {
  todo: WidgetView | undefined;
  reload: () => void;
}): PlannerActions {
  const [failure, setFailure] = useState<PlannerFailure | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function run(operation: () => Promise<unknown>, saving = false): Promise<boolean> {
    if (!isDesktop()) {
      setFailure({
        message: "미리보기에서는 저장하지 않아요. 실제 조작은 데스크톱 앱에서 할 수 있어요.",
        saving: false,
      });
      return false;
    }
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setNotice("");
    try {
      await operation();
      return true;
    } catch (cause: unknown) {
      setFailure({ message: errorText(cause), saving });
      reload();
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const act: ToolAction = (action, input = {}, target = todo) => {
    if (!target) {
      setFailure({ message: "도구를 찾을 수 없어요. 다시 시도해 주세요.", saving: false });
      return Promise.resolve(false);
    }
    return run(
      () =>
        command("execute_widget", {
          request: {
            requestId: crypto.randomUUID(),
            instanceId: target.id,
            expectedRevision: target.revision,
            action,
            input,
          },
        }),
      target.kind === "todo" && action === "add",
    );
  };
  return { failure, setFailure, notice, setNotice, busy, run, act };
}
