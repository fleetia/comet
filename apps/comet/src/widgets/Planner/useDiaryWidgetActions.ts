import { useRef, useState, type RefObject } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";

export type DiaryWidgetActions = {
  busy: boolean;
  pending: RefObject<boolean>;
  latestWidgets: RefObject<WidgetView[]>;
  run: <T>(operation: () => Promise<T>) => Promise<{ value: T } | null>;
  execute: (action: string, input: DataRecord, target: WidgetView) => Promise<string | null>;
  act: ToolAction;
  ensureWidget: (kind: string) => Promise<WidgetView>;
};

export function useDiaryWidgetActions({
  snapshot,
  todo,
  reload,
  setFailure,
}: {
  snapshot: WidgetSnapshot | null;
  todo: WidgetView | undefined;
  reload: () => void;
  setFailure: (failure: string | null) => void;
}): DiaryWidgetActions {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const latestWidgets = useRef<WidgetView[]>([]);
  for (const widget of snapshot?.widgets ?? []) {
    const at = latestWidgets.current.findIndex((value) => value.id === widget.id);
    if (at < 0) latestWidgets.current.push(widget);
    else if (widget.revision >= latestWidgets.current[at].revision)
      latestWidgets.current[at] = widget;
  }

  async function run<T>(operation: () => Promise<T>): Promise<{ value: T } | null> {
    if (!isDesktop()) {
      setFailure("예시 미리보기예요. 기록은 데스크톱 앱에서 저장할 수 있어요.");
      return null;
    }
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      return { value: await operation() };
    } catch (cause) {
      setFailure(errorText(cause));
      reload();
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function execute(
    action: string,
    input: DataRecord,
    target: WidgetView,
  ): Promise<string | null> {
    const latest = latestWidgets.current.find((widget) => widget.id === target.id) ?? target;
    const result = await command<string | null>("execute_widget", {
      request: {
        requestId: crypto.randomUUID(),
        instanceId: latest.id,
        expectedRevision: latest.revision,
        action,
        input,
      },
    });
    // Keep sequential actions on the returned revision, even before React receives the event.
    try {
      const fresh = await command<WidgetSnapshot>("get_widgets");
      latestWidgets.current = fresh.widgets;
    } catch {
      reload();
    }
    return result;
  }
  const act: ToolAction = async (action, input = {}, target = todo) => {
    if (!target) {
      setFailure("도구를 찾을 수 없어요. 다시 시도해 주세요.");
      return false;
    }
    return Boolean(await run(() => execute(action, input, target)));
  };
  async function ensureWidget(kind: string): Promise<WidgetView> {
    let widget = latestWidgets.current.find((value) => value.kind === kind);
    if (!widget) {
      const fresh = await command<WidgetSnapshot>("get_widgets");
      latestWidgets.current = fresh.widgets;
      widget = fresh.widgets.find((value) => value.kind === kind);
    }
    if (!widget) throw new Error("도구를 찾을 수 없어요. 다시 시도해 주세요.");
    return widget;
  }
  return { busy, pending, latestWidgets, run, execute, act, ensureWidget };
}
