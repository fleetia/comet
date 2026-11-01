import { Dialog, Button, TextInput } from "@comet/ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { record, text, type DataRecord, type ToolAction } from "../toolData";
import * as s from "./planner.css";

export const PLANNER_LIST_DRAFT_KEY = "comet:diary:planner-list-draft";

function readDraft(): DataRecord {
  try {
    return record(JSON.parse(localStorage.getItem(PLANNER_LIST_DRAFT_KEY) || "null"));
  } catch {
    return {};
  }
}

function stringValues(value: DataRecord[string]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function PlannerListManager({
  isOpen,
  lists,
  items,
  act,
  busy,
  failure,
  onClose,
  persistDraft = false,
}: {
  isOpen: boolean;
  lists: DataRecord[];
  items: DataRecord[];
  act: ToolAction;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
  persistDraft?: boolean;
}): ReactElement {
  const [draft] = useState(() => (persistDraft ? readDraft() : {}));
  const [name, setName] = useState(() => text(draft.name));
  const [renames, setRenames] = useState<Record<string, string>>(() => stringValues(draft.renames));
  const [originalNames, setOriginalNames] = useState<Record<string, string>>(() =>
    stringValues(draft.originalNames),
  );
  const [conflict, setConflict] = useState("");
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (!isOpen && wasOpen.current) {
      setName("");
      setRenames({});
      setOriginalNames({});
      setConflict("");
      if (persistDraft) {
        try {
          localStorage.removeItem(PLANNER_LIST_DRAFT_KEY);
        } catch {
          /* Keep the in-memory state usable. */
        }
      }
    }
    wasOpen.current = isOpen;
  }, [isOpen, persistDraft]);
  useEffect(() => {
    if (!persistDraft || !isOpen) return;
    try {
      if (name || Object.keys(renames).length)
        localStorage.setItem(
          PLANNER_LIST_DRAFT_KEY,
          JSON.stringify({ name, renames, originalNames }),
        );
      else localStorage.removeItem(PLANNER_LIST_DRAFT_KEY);
    } catch {
      /* Keep the in-memory draft if browser storage is unavailable. */
    }
  }, [persistDraft, isOpen, name, renames, originalNames]);
  return (
    <Dialog
      isOpen={isOpen}
      title="목록 관리"
      size="small"
      closeLabel="목록 관리 닫기"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <div className={s.form}>
        {failure && (
          <p role="alert" className={s.error}>
            {failure}
          </p>
        )}
        {conflict && (
          <div role="alert" className={s.error}>
            <p>
              목록 이름이 다른 곳에서 바뀌었어요. 최신 이름:{" "}
              {text(lists.find((list) => list.id === conflict)?.name)}
            </p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const latest = lists.find((list) => list.id === conflict);
                if (!latest) return;
                setOriginalNames((old) => ({ ...old, [conflict]: text(latest.name) }));
                setConflict("");
              }}
            >
              최신 이름 확인하고 계속 편집
            </Button>
          </div>
        )}
        <form
          className={s.quick}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("list-add", { name })) setName("");
          }}
        >
          <TextInput
            fill
            className={s.grow}
            aria-label="새 목록 이름"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            목록 추가
          </Button>
        </form>
        {lists.map((list) => (
          <form
            key={text(list.id)}
            className={s.quick}
            onSubmit={async (e) => {
              e.preventDefault();
              const id = text(list.id);
              if (originalNames[id] !== undefined && originalNames[id] !== text(list.name)) {
                setConflict(id);
                return;
              }
              if (await act("list-rename", { id, name: renames[id] ?? text(list.name) })) {
                setRenames((old) =>
                  Object.fromEntries(Object.entries(old).filter(([key]) => key !== id)),
                );
                setOriginalNames((old) =>
                  Object.fromEntries(Object.entries(old).filter(([key]) => key !== id)),
                );
                setConflict("");
              }
            }}
          >
            <TextInput
              fill
              className={s.grow}
              aria-label={`${text(list.name)} 이름`}
              required
              maxLength={100}
              value={renames[text(list.id)] ?? text(list.name)}
              onChange={(e) => {
                const id = text(list.id);
                setOriginalNames((old) => ({ ...old, [id]: old[id] ?? text(list.name) }));
                setRenames((old) => ({ ...old, [id]: e.target.value }));
              }}
            />
            <Button type="submit" variant="ghost" size="small" disabled={busy}>
              이름 저장
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="small"
              disabled={
                busy || list.id === "default" || items.some((item) => item.listId === list.id)
              }
              onClick={() => void act("list-delete", { id: text(list.id) })}
            >
              빈 목록 삭제
            </Button>
          </form>
        ))}
      </div>
    </Dialog>
  );
}
