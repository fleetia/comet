import { useRef, useState, type RefObject } from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import type { DataRecord } from "../toolData";
import type { WidgetSnapshot } from "../types";
import type { PreparationCreateResult } from "../PreparationTool/PreparationCreate";
import type { DiaryPage, DiaryState } from "./diaryTypes";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";

type EnvelopeCreateRequest = {
  requestId: string;
  instanceId: string;
  expectedRevision: number;
  action: string;
  input: DataRecord;
};

export type DiaryCreation = {
  creating: "page" | "envelope" | null;
  setCreating: (creating: "page" | "envelope" | null) => void;
  name: string;
  setName: (name: string) => void;
  envelopeCreateDirty: boolean;
  setEnvelopeCreateDirty: (dirty: boolean) => void;
  envelopeCreateRequest: RefObject<EnvelopeCreateRequest | null>;
  start: (kind: "page" | "envelope") => void;
  closePage: () => void;
  closeEnvelope: () => void;
  discard: () => void;
  createPage: () => Promise<string | null>;
  saveNew: () => Promise<void>;
  createEnvelope: (input: DataRecord, requestId: string) => Promise<PreparationCreateResult>;
};

export function useDiaryCreation({
  actions: { latestWidgets, run, ensureWidget },
  mutate,
  page,
  day,
  reload,
  onPageCreated,
  onEnvelopeCreated,
}: {
  actions: DiaryWidgetActions;
  mutate: (action: string, input?: DataRecord) => Promise<DiaryState | null>;
  page: DiaryPage | undefined;
  day: string;
  reload: () => void;
  onPageCreated: (id: string) => void;
  onEnvelopeCreated: (id: string) => void;
}): DiaryCreation {
  const [creating, setCreating] = useState<"page" | "envelope" | null>(null);
  const [name, setName] = useState("");
  const [envelopeCreateDirty, setEnvelopeCreateDirty] = useState(false);
  const envelopeCreateRequest = useRef<EnvelopeCreateRequest | null>(null);

  function start(kind: "page" | "envelope"): void {
    setCreating(kind);
    setName("");
  }
  function closePage(): void {
    setCreating(null);
    setName("");
  }
  function closeEnvelope(): void {
    envelopeCreateRequest.current = null;
    setCreating(null);
  }
  function discard(): void {
    setName("");
    setEnvelopeCreateDirty(false);
    envelopeCreateRequest.current = null;
    setCreating(null);
  }
  async function createPage(): Promise<string | null> {
    if (page) return page.id;
    const result = await mutate("page-create", { date: day, title: "" });
    return result?.pages.find((value) => value.date === day)?.id ?? null;
  }
  async function saveNew(): Promise<void> {
    if (!name.trim()) return;
    if (creating === "page") {
      const result = await mutate("page-create", { date: null, title: name });
      const added = result?.pages.at(-1);
      if (added) {
        setName("");
        setCreating(null);
        onPageCreated(added.id);
      }
    }
  }
  async function createEnvelope(
    input: DataRecord,
    requestId: string,
  ): Promise<PreparationCreateResult> {
    let outcome: PreparationCreateResult = "unknown";
    const result = await run(async () => {
      if (!envelopeCreateRequest.current || envelopeCreateRequest.current.requestId !== requestId) {
        if (Array.isArray(input.tasks) && input.tasks.length) await ensureWidget("todo");
        const target = await ensureWidget("preparation");
        envelopeCreateRequest.current = {
          requestId,
          instanceId: target.id,
          expectedRevision: target.revision,
          action: "create",
          input,
        };
      }
      let createdId: string | null;
      try {
        createdId = await command<string | null>("execute_widget", {
          request: envelopeCreateRequest.current,
        });
      } catch (cause) {
        const message = errorText(cause);
        const prefix = "PREPARATION_CREATE_REJECTED:";
        if (!message.startsWith(prefix)) throw cause;
        outcome = "rejected";
        envelopeCreateRequest.current = null;
        try {
          const fresh = await command<WidgetSnapshot>("get_widgets");
          latestWidgets.current = fresh.widgets;
        } catch {
          reload();
        }
        throw new Error(message.slice(prefix.length).trim());
      }
      if (!createdId)
        throw new Error("만든 봉투를 확인하지 못했어요. 같은 요청으로 다시 시도해 주세요.");
      reload();
      return createdId;
    });
    if (!result?.value) return outcome;
    envelopeCreateRequest.current = null;
    setCreating(null);
    onEnvelopeCreated(result.value);
    return "created";
  }
  return {
    creating,
    setCreating,
    name,
    setName,
    envelopeCreateDirty,
    setEnvelopeCreateDirty,
    envelopeCreateRequest,
    start,
    closePage,
    closeEnvelope,
    discard,
    createPage,
    saveNew,
    createEnvelope,
  };
}
