import { Button, Dialog } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { record, rows, text, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../memo.css";

export function MemoTool({
  widget,
  act,
  busy,
  openNote,
}: {
  widget: WidgetView;
  act: ToolAction;
  busy: boolean;
  openNote: (noteId: string, putAway?: boolean) => Promise<boolean>;
}): ReactElement {
  const notes = rows(record(widget.data).notes);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <>
      {notes.length === 0 && <p className={c.quiet}>아직 메모가 없어요. +로 메모를 꺼내 보세요.</p>}
      <ul className={s.list} aria-label="메모 목록">
        {notes.map((note) => {
          const id = text(note.id);
          const preview =
            text(note.body).replace(/\s+/g, " ").trim() || text(note.title) || "빈 메모";
          return (
            <li className={s.listItem} key={id}>
              <button
                type="button"
                className={s.preview}
                title={preview}
                disabled={busy}
                onClick={() => void openNote(id)}
              >
                {preview}
              </button>
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={() => void openNote(id, Boolean(note.isOpen))}
              >
                {note.isOpen ? "넣기" : "꺼내기"}
              </Button>
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={() => setDeleting(id)}
              >
                삭제
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="메모를 삭제할까요?"
        closeLabel="취소"
        size="small"
      >
        <p>메모 내용도 함께 삭제됩니다. 창만 닫으려면 넣기를 사용하세요.</p>
        <div className={s.dialogActions}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (deleting && (await act("delete", { id: deleting }))) {
                setDeleting(null);
              }
            }}
          >
            메모 삭제
          </Button>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            취소
          </Button>
        </div>
      </Dialog>
    </>
  );
}
