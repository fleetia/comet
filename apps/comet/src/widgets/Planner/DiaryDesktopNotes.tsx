import { Button as CometButton, Select, StatusChip } from "@comet/ui";
import { DiaryNoteDetail } from "./DiaryNoteDetail";
import * as ns from "./diaryNotes.css";
import type { ReactElement } from "react";
import { WidgetDragHandle } from "../WidgetDragHandle";
import { record, rows, text, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import type { WidgetDragPayload } from "../widgetDrag";

export type DesktopNotesProps = {
  widgets: WidgetView[];
  busy: boolean;
  act: ToolAction;
  onCreate: () => Promise<boolean>;
  onOpenNote: (widget: WidgetView, noteId: string, putAway?: boolean) => Promise<boolean>;
  linkTarget?: string;
  onAdd: (payload: WidgetDragPayload) => void;
};

export type DesktopNoteItem = { key: string; widget: WidgetView; note: ReturnType<typeof record> };
export function desktopNotes(widgets: WidgetView[]): DesktopNoteItem[] {
  return widgets.flatMap((widget) =>
    rows(record(widget.data).notes).map((note) => ({
      key: `desktop:${widget.id}:${text(note.id)}`,
      widget,
      note,
    })),
  );
}

export function DiaryDesktopNoteDetail({
  item,
  onDirtyChange,
  ...props
}: DesktopNotesProps & {
  item: DesktopNoteItem;
  onDirtyChange: (id: string, dirty: boolean) => void;
}): ReactElement {
  const { widget, note, key } = item;
  const id = text(note.id);
  const unavailable = props.busy || !widget.installed || !widget.enabled;
  const payload: WidgetDragPayload = { v: 1, kind: "memo", widgetId: widget.id, itemId: id };
  return (
    <DiaryNoteDetail
      id={key}
      note={{ title: text(note.title), body: text(note.body) }}
      storageKey={`comet.diary.note-draft:${key}`}
      busy={unavailable}
      maxLength={50000}
      onDirtyChange={onDirtyChange}
      onSave={(draft, base) =>
        props.act(
          "update",
          {
            id,
            ...(draft.title !== base.title ? { title: draft.title } : {}),
            body: draft.body,
            expectedBody: base.body,
            expectedTitle: base.title,
          },
          widget,
        )
      }
      onDelete={() => props.act("delete", { id }, widget)}
      header={(disabled) => (
        <>
          {Boolean(note.isOpen) && <StatusChip>바탕화면에 있어요</StatusChip>}
          <CometButton
            variant="ghost"
            size="small"
            disabled={disabled}
            onClick={() => void props.onOpenNote(widget, id, Boolean(note.isOpen))}
          >
            {note.isOpen ? "넣어두기" : "바탕화면에 꺼내기"}
          </CometButton>
        </>
      )}
      details={(disabled) => (
        <div className={ns.metadata}>
          <div className={ns.metadataRow}>
            <div className={ns.metadataCopy}>
              <span className={ns.metadataLabel}>연결</span>
              <span className={ns.caption}>
                {props.linkTarget ?? "내 페이지에 붙이면 거기서도 함께 보여요."}
              </span>
            </div>
            <CometButton
              variant="ghost"
              size="small"
              disabled={disabled}
              onClick={() => props.onAdd(payload)}
            >
              페이지에 연결
            </CometButton>
          </div>
          <div className={ns.metadataRow}>
            <div className={ns.metadataCopy}>
              <span className={ns.metadataLabel}>바탕화면</span>
              <span className={ns.caption}>
                {!widget.installed || !widget.enabled
                  ? "위젯 설정에서 메모를 켜면 다시 꺼낼 수 있어요."
                  : "낱장으로 꺼내 두고 고쳐도 여기에 함께 반영돼요."}
              </span>
            </div>
            <Select
              aria-label="바탕화면 메모 글자 크기"
              value={String(note.fontSize || 16)}
              disabled={disabled}
              onChange={(event) =>
                void props.act(
                  "update",
                  { id, fontSize: Number(event.target.value), expectedBody: text(note.body) },
                  widget,
                )
              }
            >
              {[12, 14, 16, 18, 20, 22, 24].map((value) => (
                <option key={value} value={value}>
                  글자 {value}
                </option>
              ))}
            </Select>
            <WidgetDragHandle
              payload={payload}
              title={text(note.title) || "메모"}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    />
  );
}
