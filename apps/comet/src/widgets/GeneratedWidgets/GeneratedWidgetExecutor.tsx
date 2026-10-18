import { useEffect } from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import type { WidgetValue } from "../types";
import { runWidget, type WidgetResult } from "./sandbox";

type ExecutionInput = {
  source: string;
  state: WidgetValue;
  action: WidgetValue;
  now: number;
};

// StrictMode remounts effects; a host nonce must still claim and execute only once.
const executions = new Map<string, Promise<void>>();

export async function executeGeneratedRequest(token: string): Promise<void> {
  const existing = executions.get(token);
  if (existing) {
    return existing;
  }
  const execution = completeRequest(token);
  executions.set(token, execution);
  return execution;
}

async function completeRequest(token: string): Promise<void> {
  let result: WidgetResult | null = null;
  let error: { kind: "hostFailure" | "interpreterFailure"; message: string } | null = null;
  try {
    const input = await command<ExecutionInput>("get_generated_execution", { token });
    try {
      result = await runWidget(input.source, input.state, input.action, input.now);
    } catch (cause) {
      error = {
        kind: "interpreterFailure",
        message: errorText(cause).slice(0, 300) || "위젯을 실행하지 못했어요.",
      };
    }
  } catch (cause) {
    error = {
      kind: "hostFailure",
      message: errorText(cause).slice(0, 300) || "위젯 요청을 받지 못했어요.",
    };
  }
  try {
    await command("complete_generated_execution", { token, result, error });
  } catch {
    // Expired or cancelled host requests own cleanup; never resubmit a reducer.
  }
}

export function GeneratedWidgetExecutor({ token }: { token: string }): null {
  useEffect(() => {
    if (token) {
      void executeGeneratedRequest(token);
    }
  }, [token]);
  return null;
}
