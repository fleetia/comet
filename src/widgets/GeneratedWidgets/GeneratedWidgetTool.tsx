import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, TextField } from "@fleetia/lagrange";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import type { GeneratedWidget } from "./types";
import type { WidgetValue } from "../types";
import { runWidget, type WidgetNode } from "./sandbox";
import * as s from "./generatedWidgets.css";
import * as common from "../../lagrange.css";

export function GeneratedWidgetTool({ id }: { id: string }): ReactElement {
  const [widget, setWidget] = useState<GeneratedWidget | null>(null);
  const [view, setView] = useState<WidgetNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef<GeneratedWidget | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const repairs = useRef(0);
  const loadGeneration = useRef(0);
  const reloadNeeded = useRef(false);
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const suspended = useRef(false);
  const loading = useRef(false);
  const pendingActions = useRef<WidgetValue[]>([]);
  function accept(value: GeneratedWidget): void {
    if (
      !value.installed ||
      !value.enabled ||
      value.definition.source !== current.current?.definition.source
    ) {
      pendingActions.current = [];
      if (mounted.current) {
        setView([]);
      }
    }
    current.current = value;
    if (mounted.current) {
      setWidget(value);
    }
  }
  function advance(): void {
    if (!mounted.current || running.current || loading.current) {
      return;
    }
    if (reloadNeeded.current) {
      reloadNeeded.current = false;
      void reloadRef.current();
    } else if (!suspended.current) {
      const action = pendingActions.current.shift();
      if (action !== undefined) {
        void executeRef.current(action);
      }
    }
  }
  async function execute(action: WidgetValue | null, userAction = false): Promise<void> {
    const before = current.current;
    if (!mounted.current || !before || !before.installed || !before.enabled || suspended.current) {
      return;
    }
    if (running.current || loading.current || reloadNeeded.current) {
      if (userAction && action !== null) {
        pendingActions.current.push(action);
      }
      advance();
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    const abort = new AbortController();
    controller.current = abort;
    let interpreterFailed = false;
    let failed = false;
    try {
      const result = await runWidget(
        before.definition.source,
        before.state,
        action,
        Date.now(),
        abort.signal,
      ).catch((cause) => {
        interpreterFailed = true;
        throw cause;
      });
      if (
        !mounted.current ||
        abort.signal.aborted ||
        current.current?.revision !== before.revision
      ) {
        return;
      }
      let after = before;
      if (before.status !== "ready") {
        after = await command<GeneratedWidget>("report_generated_result", {
          id,
          expectedRevision: before.revision,
          error: null,
        });
      }
      if (!mounted.current || abort.signal.aborted) {
        return;
      }
      if (JSON.stringify(result.state) !== JSON.stringify(after.state)) {
        after = await command<GeneratedWidget>("update_generated_state", {
          id,
          expectedRevision: after.revision,
          value: result.state,
        });
      }
      if (!mounted.current || abort.signal.aborted) {
        return;
      }
      accept(after);
      setView(result.view);
    } catch (cause) {
      failed = true;
      if (!mounted.current || abort.signal.aborted) {
        return;
      }
      pendingActions.current = [];
      const message = errorText(cause);
      setError(message);
      // Only interpreter failures qualify for AI repair. Storage conflicts never regenerate code.
      if (interpreterFailed && current.current?.revision === before.revision) {
        try {
          const failed = await command<GeneratedWidget>("report_generated_result", {
            id,
            expectedRevision: before.revision,
            error: message,
          });
          if (!mounted.current || abort.signal.aborted) {
            return;
          }
          accept(failed);
          if (repairs.current < 2) {
            repairs.current += 1;
            setError(`실행 오류를 AI가 수정하고 있어요 (${repairs.current}/2)…`);
            const repaired = await command<GeneratedWidget>("generate_widget", {
              id,
              expectedRevision: failed.revision,
              request: `기존 기능과 사용자 상태를 유지하며 실행 오류를 수정해 주세요: ${message}`,
            });
            if (mounted.current && !abort.signal.aborted) {
              accept(repaired);
              setError(null);
            }
          }
        } catch (repairError) {
          if (mounted.current && !abort.signal.aborted) {
            setError(`${message}\n자동 수정: ${errorText(repairError)}`);
          }
        }
      } else {
        suspended.current = true;
        reloadNeeded.current = true;
      }
    } finally {
      if (controller.current === abort) {
        if (failed) {
          pendingActions.current = [];
        }
        running.current = false;
        if (mounted.current) {
          setBusy(false);
          advance();
        }
      }
    }
  }
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    mounted.current = true;
    current.current = null;
    pendingActions.current = [];
    running.current = false;
    loading.current = false;
    suspended.current = false;
    reloadNeeded.current = false;
    repairs.current = 0;
    setWidget(null);
    setView([]);
    setError(null);
    setBusy(false);
    if (!isDesktop()) {
      setError("실제 위젯 실행은 데스크톱 앱에서 확인해 주세요.");
      return;
    }
    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function reload(): Promise<void> {
      if (disposed) {
        return;
      }
      if (running.current || loading.current) {
        reloadNeeded.current = true;
        return;
      }
      loading.current = true;
      const generation = ++loadGeneration.current;
      try {
        const value = await command<GeneratedWidget>("get_generated_widget", { id });
        if (!disposed && generation === loadGeneration.current) {
          const changed = value.revision !== current.current?.revision;
          accept(value);
          loading.current = false;
          if (value.status !== "error" && (!suspended.current || changed)) {
            suspended.current = false;
            if (!reloadNeeded.current) {
              await executeRef.current(null);
            }
          } else if (value.status === "error") {
            pendingActions.current = [];
            if (value.error) {
              setError(value.error);
            }
          }
        }
      } catch (cause) {
        if (!disposed) {
          suspended.current = true;
          pendingActions.current = [];
          setError(errorText(cause));
        }
      } finally {
        if (!disposed && generation === loadGeneration.current) {
          loading.current = false;
          advance();
        }
      }
    }
    reloadRef.current = reload;
    void listen("generated-widgets-changed", () => void reload()).then((unlisten) => {
      if (!disposed) {
        cleanup = unlisten;
        void reload();
      } else {
        unlisten();
      }
    });
    const timer = window.setInterval(() => {
      if (suspended.current) {
        return;
      }
      if (current.current?.status === "draft") {
        void executeRef.current(null);
      } else if (current.current?.status === "ready") {
        void executeRef.current({ type: "tick" });
      }
    }, 1000);
    return () => {
      disposed = true;
      mounted.current = false;
      pendingActions.current = [];
      loadGeneration.current += 1;
      controller.current?.abort();
      controller.current = null;
      window.clearInterval(timer);
      cleanup?.();
    };
  }, [id]);
  return (
    <WidgetFrame
      title={widget?.definition.name ?? "AI 위젯"}
      closeLabel="위젯 닫기"
      onClose={() => command("close_generated_widget", { id })}
      footer={
        <div className={s.actions}>
          <Button
            variant="secondary"
            onClick={() =>
              void command("open_widget_state_rules", { id }).catch((cause) =>
                setError(errorText(cause)),
              )
            }
          >
            상태별 대사
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void command("open_widgets").catch((cause) => setError(errorText(cause)))
            }
          >
            위젯 목록에서 고치기
          </Button>
        </div>
      }
    >
      <div className={s.body}>
        {error && (
          <div>
            <p role="alert" className={common.error}>
              {error}
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                suspended.current = false;
                void execute(null);
              }}
            >
              다시 확인
            </Button>
          </div>
        )}
        {busy && widget?.status !== "ready" && <p role="status">만든 위젯을 확인하고 있어요…</p>}
        {view.map((node, index) => {
          switch (node.type) {
            case "button":
              return (
                <Button
                  key={index}
                  variant="primary"
                  disabled={
                    widget?.status !== "ready" ||
                    !widget.enabled ||
                    suspended.current ||
                    (busy && error !== null)
                  }
                  onClick={() => void execute({ type: node.action ?? "" }, true)}
                >
                  {node.label}
                </Button>
              );
            case "input":
              return (
                <WidgetInput
                  key={index}
                  node={node}
                  submit={(value) => execute({ type: node.action ?? "", value }, true)}
                />
              );
            case "progress":
              return (
                <label key={index} className={s.field}>
                  {node.label}
                  <progress
                    value={Number(node.value ?? 0) - Number(node.min ?? 0)}
                    max={Number(node.max ?? 100) - Number(node.min ?? 0)}
                  />
                </label>
              );
            case "number":
              return (
                <div key={index}>
                  <span>{node.label}</span>
                  <p className={s.number}>{node.value}</p>
                </div>
              );
            default:
              return (
                <p key={index}>
                  {node.label}
                  {node.value != null ? ` ${node.value}` : ""}
                </p>
              );
          }
        })}
      </div>
    </WidgetFrame>
  );
}

function WidgetInput({
  node,
  submit,
}: {
  node: WidgetNode;
  submit: (value: string) => Promise<void>;
}): ReactElement {
  const [draft, setDraft] = useState(String(node.value ?? ""));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(String(node.value ?? ""));
    }
  }, [node.value]);
  return (
    <label className={s.field}>
      {node.label}
      <TextField
        aria-label={node.label}
        value={draft}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          editing.current = false;
          if (draft !== String(node.value ?? "")) {
            void submit(draft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
