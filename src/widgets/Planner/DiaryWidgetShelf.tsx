import { Button } from "@fleetia/lagrange";
import type { ReactElement } from "react";
import { record, rows, text } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";
import { WidgetDragHandle } from "../WidgetDragHandle";
import type { WidgetDragPayload } from "../widgetDrag";
import * as s from "./diaryWidgetShelf.css";

type Props = {
  snapshot: WidgetSnapshot;
  busy: boolean;
  onOpenWidget: (widget: WidgetView) => void;
  onAdd: (payload: WidgetDragPayload) => void;
};

function sourceItems(widget: WidgetView): { payload: WidgetDragPayload; title: string }[] {
  const data = record(widget.data);
  switch (widget.kind) {
    case "todo":
      return rows(data.items)
        .filter((item) => typeof item.completedAt !== "number")
        .map((item) => ({
          payload: { v: 1, kind: "todo", widgetId: widget.id, itemId: text(item.id) },
          title: text(item.title),
        }));
    case "preparation":
      return rows(data.envelopes)
        .filter((item) => item.archived !== true)
        .map((item) => ({
          payload: { v: 1, kind: "envelope", widgetId: widget.id, itemId: text(item.id) },
          title: text(item.title) || text(item.eventLabel) || "준비 봉투",
        }));
    default:
      return [];
  }
}

export function DiaryWidgetShelf({ snapshot, busy, onOpenWidget, onAdd }: Props): ReactElement {
  const widgets = snapshot.widgets.filter((widget) => widget.installed && widget.enabled);
  return (
    <details className={s.shelf}>
      <summary className={s.heading}>위젯</summary>
      <p className={s.hint}>끌어 놓거나 +를 눌러 펼친 페이지에 연결하세요.</p>
      {widgets.length === 0 && <p className={s.hint}>켜 둔 위젯이 없어요.</p>}
      {widgets.map((widget) => {
        const name =
          snapshot.catalog.find((entry) => entry.id === widget.kind)?.name || widget.kind;
        const payload: WidgetDragPayload = { v: 1, kind: "widget", widgetId: widget.id };
        const items = sourceItems(widget);
        return (
          <div className={s.group} key={widget.id}>
            <div className={s.row}>
              <WidgetDragHandle payload={payload} title={name} disabled={busy} />
              <button
                className={s.name}
                type="button"
                disabled={busy}
                onClick={() => onOpenWidget(widget)}
                title={`${name} 열기`}
              >
                {name} ↗
              </button>
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                aria-label={`${name} 위젯 연결`}
                onClick={() => onAdd(payload)}
              >
                +
              </Button>
            </div>
            {items.length > 0 && (
              <details className={s.items}>
                <summary className={s.hint}>내용 {items.length}개</summary>
                <div className={s.list}>
                  {items.map((item) => (
                    <div className={s.row} key={item.payload.itemId}>
                      <WidgetDragHandle payload={item.payload} title={item.title} disabled={busy} />
                      <button
                        type="button"
                        className={s.itemName}
                        disabled={busy}
                        title={item.title}
                        onClick={() => onOpenWidget(widget)}
                      >
                        {item.title}
                      </button>
                      <Button
                        variant="quiet"
                        size="compact"
                        disabled={busy}
                        aria-label={`${item.title} 연결`}
                        onClick={() => onAdd(item.payload)}
                      >
                        +
                      </Button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </details>
  );
}
