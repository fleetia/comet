import { useRef, useState, type DragEvent } from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetSnapshot } from "../types";
import { hasWidgetDrag, readWidgetDrag, type WidgetDragPayload } from "../widgetDrag";
import type { DiaryAction, DiaryPage, DiaryState } from "./diaryTypes";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";

export type DiaryWidgetDrop = {
  addingWidget: boolean;
  dropActive: boolean;
  addWidgetItem: (payload: WidgetDragPayload, targetDate?: string) => Promise<void>;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: ((event: DragEvent<HTMLElement>) => void) | undefined;
};

export function useDiaryWidgetDrop({
  actions: { latestWidgets },
  otherBusy,
  mutate,
  diaryAction,
  planTask,
  pages,
  pageId,
  envelopeId,
  day,
  view,
  tool,
  reload,
  setFailure,
  setNotice,
}: {
  actions: DiaryWidgetActions;
  /** Saving work other than this drop; together with the drop it blocks a new drop. */
  otherBusy: boolean;
  mutate: (action: string, input?: DataRecord) => Promise<DiaryState | null>;
  diaryAction: DiaryAction;
  planTask: (item: DataRecord, toDate: string) => Promise<boolean>;
  pages: DiaryPage[];
  pageId: string;
  envelopeId: string;
  day: string;
  view: string;
  tool: string | null;
  reload: () => void;
  setFailure: (failure: string | null) => void;
  setNotice: (notice: string) => void;
}): DiaryWidgetDrop {
  const [dropActive, setDropActive] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  const dropping = useRef(false);

  async function addWidgetItem(payload: WidgetDragPayload, targetDate?: string): Promise<void> {
    if (dropping.current || otherBusy || addingWidget) return;
    setNotice("");
    if (envelopeId && !targetDate) {
      setFailure("날짜나 내 페이지를 펼친 다음 연결해 주세요.");
      return;
    }
    dropping.current = true;
    setAddingWidget(true);
    setFailure(null);
    try {
      const fresh = await command<WidgetSnapshot>("get_widgets");
      latestWidgets.current = fresh.widgets;
      const widget = fresh.widgets.find(
        (value) => value.id === payload.widgetId && value.installed,
      );
      if (!widget) throw new Error("원본 위젯을 찾을 수 없어요.");
      const date = targetDate ?? (pageId ? null : day);
      const data = record(widget.data);
      const collection =
        payload.kind === "todo"
          ? rows(data.items)
          : payload.kind === "memo"
            ? rows(data.notes)
            : rows(data.envelopes);
      const source =
        payload.kind === "widget" ? null : collection.find((value) => value.id === payload.itemId);
      const expectedKind = payload.kind === "envelope" ? "preparation" : payload.kind;
      if (payload.kind !== "widget" && (!source || widget.kind !== expectedKind)) {
        throw new Error("연결할 원본 항목을 찾을 수 없어요.");
      }
      if (payload.kind === "todo" && source && date) {
        if (!widget.enabled) throw new Error("할 일 위젯을 먼저 켜 주세요.");
        if (!(await planTask(source, date))) return;
      } else {
        let target =
          !targetDate && pageId
            ? pages.find((value) => value.id === pageId)
            : pages.find((value) => value.date === date);
        if (!target && date) {
          const saved = await mutate("page-create", { date, title: "" });
          target = saved?.pages.find((value) => value.date === date);
        }
        if (!target) throw new Error("연결할 페이지를 만들지 못했어요.");
        const label = source
          ? text(source.title) || text(source.body) || text(source.eventLabel) || "메모"
          : fresh.catalog.find((value) => value.id === widget.kind)?.name || widget.kind;
        if (
          !(await diaryAction("entry-add", {
            pageId: target.id,
            kind:
              payload.kind === "todo"
                ? "todo"
                : payload.kind === "envelope"
                  ? "envelope"
                  : "widget",
            refId:
              payload.kind === "todo" || payload.kind === "envelope" ? payload.itemId : widget.id,
            ...(payload.kind === "memo" ? { itemId: payload.itemId } : {}),
            text: label.slice(0, 20000),
          }))
        )
          return;
      }
      setNotice(date ? `${date}에 연결했어요.` : "이 페이지에 연결했어요.");
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      dropping.current = false;
      setAddingWidget(false);
      reload();
    }
  }
  function dropOnPage(event: DragEvent<HTMLElement>): void {
    const payload = readWidgetDrag(event.dataTransfer);
    if (!payload || view !== "day" || envelopeId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    void addWidgetItem(payload);
  }
  return {
    addingWidget,
    dropActive,
    addWidgetItem,
    onDragOver: (event) => {
      if (!tool && view === "day" && !envelopeId && hasWidgetDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "link";
        setDropActive(true);
      }
    },
    onDragLeave: (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !event.currentTarget.contains(event.relatedTarget)
      )
        setDropActive(false);
    },
    onDrop: tool ? undefined : dropOnPage,
  };
}
