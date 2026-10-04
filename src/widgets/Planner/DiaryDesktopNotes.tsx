import { Button, Dialog } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { WidgetDragHandle } from "../WidgetDragHandle";
import { record, rows, text, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import type { WidgetDragPayload } from "../widgetDrag";
import * as s from "./diaryEnvelope.css";

export type DesktopNotesProps = {
  widgets: WidgetView[];
  busy: boolean;
  act: ToolAction;
  onCreate: () => Promise<boolean>;
  onOpenNote: (widget: WidgetView, noteId: string, putAway?: boolean) => Promise<boolean>;
  onAdd: (payload: WidgetDragPayload) => void;
};

export function DiaryDesktopNotes({
  widgets,
  busy,
  act,
  onCreate,
  onOpenNote,
  onAdd,
  search = "",
}: DesktopNotesProps & { search?: string }): ReactElement {
  const [deleting, setDeleting] = useState<{ widget: WidgetView; id: string } | null>(null);
  const notes = widgets
    .flatMap((widget) => rows(record(widget.data).notes).map((note) => ({ widget, note })))
    .filter(({ note }) =>
      `${text(note.title)} ${text(note.body)}`.toLocaleLowerCase().includes(search),
    );
  return (
    <section className={s.notes} aria-label="바탕화면 메모">
      <div className={s.row}>
        <h3 className={s.subheading}>바탕화면 메모</h3>
        <Button variant="quiet" size="compact" disabled={busy} onClick={() => void onCreate()}>
          + 새 메모
        </Button>
      </div>
      <p className={s.caption}>메모를 누르면 바탕화면에 다시 꺼내요. 넣어도 내용은 남아 있어요.</p>
      {notes.length === 0 && (
        <p className={s.caption}>
          {search ? "검색한 바탕화면 메모가 없어요." : "아직 바탕화면 메모가 없어요."}
        </p>
      )}
      {notes.map(({ widget, note }) => {
        const id = text(note.id);
        const preview =
          text(note.body).replace(/\s+/g, " ").trim() || text(note.title) || "빈 메모";
        const unavailable = busy || !widget.installed || !widget.enabled;
        const payload: WidgetDragPayload = { v: 1, kind: "memo", widgetId: widget.id, itemId: id };
        return (
          <article key={`${widget.id}:${id}`} className={s.note}>
            <div className={s.row}>
              <WidgetDragHandle payload={payload} title={preview} disabled={unavailable} />
              <Button
                variant="quiet"
                size="compact"
                className={s.desktopMemoPreview}
                disabled={unavailable}
                onClick={() => void onOpenNote(widget, id)}
                title={preview}
              >
                {preview}
              </Button>
            </div>
            {(!widget.installed || !widget.enabled) && (
              <p className={s.caption}>위젯 설정에서 메모를 켜면 다시 꺼낼 수 있어요.</p>
            )}
            <div className={s.row}>
              <Button
                variant="quiet"
                size="compact"
                disabled={unavailable}
                onClick={() => void onOpenNote(widget, id, Boolean(note.isOpen))}
              >
                {note.isOpen ? "넣기" : "꺼내기"}
              </Button>
              <Button
                variant="quiet"
                size="compact"
                disabled={unavailable}
                aria-label={`${preview} 연결`}
                onClick={() => onAdd(payload)}
              >
                페이지에 연결
              </Button>
              <Button
                variant="quiet"
                size="compact"
                disabled={unavailable}
                onClick={() => setDeleting({ widget, id })}
              >
                삭제
              </Button>
            </div>
          </article>
        );
      })}
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
        <div className={s.actions}>
          <Button
            variant="critical"
            disabled={busy}
            onClick={async () => {
              if (deleting && (await act("delete", { id: deleting.id }, deleting.widget)))
                setDeleting(null);
            }}
          >
            메모 삭제
          </Button>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            취소
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
