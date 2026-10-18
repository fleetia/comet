import { useEffect, useState, type ReactElement } from "react";
import { Dialog } from "@comet/ui";
import { Button, TextField } from "../../ui";
import { text, type DataRecord, type ToolAction } from "../toolData";
import * as s from "./planner.css";

export function PlannerListManager({
  isOpen,
  lists,
  items,
  act,
  busy,
  failure,
  onClose,
}: {
  isOpen: boolean;
  lists: DataRecord[];
  items: DataRecord[];
  act: ToolAction;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setRenames({});
    }
  }, [isOpen]);
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
        <form
          className={s.quick}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("list-add", { name })) setName("");
          }}
        >
          <TextField
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
            onSubmit={(e) => {
              e.preventDefault();
              void act("list-rename", {
                id: text(list.id),
                name: renames[text(list.id)] ?? text(list.name),
              });
            }}
          >
            <TextField
              className={s.grow}
              aria-label={`${text(list.name)} 이름`}
              required
              maxLength={100}
              value={renames[text(list.id)] ?? text(list.name)}
              onChange={(e) => setRenames((old) => ({ ...old, [text(list.id)]: e.target.value }))}
            />
            <Button type="submit" variant="secondary" size="compact" disabled={busy}>
              이름 저장
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="compact"
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
