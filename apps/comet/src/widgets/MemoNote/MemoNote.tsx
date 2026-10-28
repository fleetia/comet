import { Button, IconButton, MemoWidget } from "@comet/ui";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { transparentDocument } from "../../components/companion.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { number, record, rows, text, type DataRecord } from "../toolData";
import { useWidgets } from "../useWidgets";
import { useMemoDraft } from "../useMemoDraft";
import { WidgetDragHandle } from "../WidgetDragHandle";
import * as c from "../../common.css";
import * as s from "../memo.css";
import * as paper from "./memoNote.css";

function NoteEditor({ id, note }: { id: string; note: DataRecord }): ReactElement {
  const noteId = text(note.id);
  const { draft, status, error, edit, flush } = useMemoDraft({
    id,
    noteId,
    body: text(note.body),
    fontSize: number(note.fontSize) || 16,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const flushRequest = useRef<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const drag = useWindowDrag(isDesktop(), setFailure);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const putAway = useCallback(async (): Promise<void> => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (await flush()) {
        await command("close_memo_note", { id, noteId });
      }
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [flush, id, noteId]);

  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    const options = { target: getCurrentWindow().label };
    const cleanups: (() => void)[] = [];
    function keep(cleanup: () => void): void {
      if (active) cleanups.push(cleanup);
      else cleanup();
    }
    void Promise.all([
      listen(
        "memo-close-request",
        () => {
          if (active) void putAway();
        },
        options,
      ).then(keep),
      listen<{ requestId: string }>(
        "memo-flush-request",
        async ({ payload }) => {
          if (!active) return;
          const windowLabel = getCurrentWindow().label;
          let success = false;
          if (!pending.current) {
            pending.current = true;
            flushRequest.current = payload.requestId;
            setBusy(true);
            success = await flush();
          }
          try {
            await emitTo(windowLabel, "memo-flush-result", {
              requestId: payload.requestId,
              windowLabel,
              success,
              ...(success
                ? {}
                : { error: "메모를 저장하지 못했어요. 메모 창에서 다시 저장해 주세요." }),
            });
          } catch (cause: unknown) {
            setFailure(errorText(cause));
          }
        },
        options,
      ).then(keep),
      listen<{ requestId: string }>(
        "memo-flush-release",
        ({ payload }) => {
          if (active && flushRequest.current === payload.requestId) {
            flushRequest.current = null;
            pending.current = false;
            setBusy(false);
          }
        },
        options,
      ).then(keep),
    ]).catch((cause: unknown) => setFailure(errorText(cause)));
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [putAway, flush]);

  async function create(): Promise<void> {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (await flush()) {
        await command("create_memo_note", { id });
      }
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main
      className={paper.stage}
      aria-label={text(note.title) || "메모"}
      onPointerDown={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest("button, textarea, [draggable]")
        )
          drag.onPointerDown(event);
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.reset}
      onPointerCancel={drag.reset}
    >
      <div className={paper.sheet}>
        <MemoWidget title={text(note.title) || "메모"}>
          <textarea
            ref={input}
            className={paper.editor}
            aria-label="메모 본문"
            placeholder="메모를 적어 보세요."
            maxLength={50000}
            value={draft.body}
            readOnly={busy}
            style={{ fontSize: draft.fontSize }}
            onChange={(event) => edit({ body: event.target.value })}
            onBlur={() => void flush()}
          />
        </MemoWidget>
        <IconButton
          className={paper.putAway}
          icon="close"
          aria-label="메모 넣기"
          size="compact"
          disabled={busy}
          onClick={() => void putAway()}
        />
      </div>
      <footer className={paper.controls}>
        <WidgetDragHandle
          payload={{ v: 1, kind: "memo", widgetId: id, itemId: noteId }}
          title={text(note.title) || "메모"}
          disabled={busy || status !== "saved"}
        />
        <Button
          className={paper.fontStep}
          aria-label="글자 크기 줄이기"
          variant="ghost"
          size="small"
          disabled={busy || draft.fontSize <= 12}
          onClick={() => edit({ fontSize: draft.fontSize - 2 })}
        >
          A−
        </Button>
        <span aria-label="글자 크기">{draft.fontSize}px</span>
        <Button
          className={paper.fontStep}
          aria-label="글자 크기 키우기"
          variant="ghost"
          size="small"
          disabled={busy || draft.fontSize >= 24}
          onClick={() => edit({ fontSize: draft.fontSize + 2 })}
        >
          A+
        </Button>
        <Button
          aria-label="새 메모 꺼내기"
          variant="ghost"
          size="small"
          disabled={busy || !isDesktop()}
          onClick={() => void create()}
        >
          +
        </Button>
        <span className={paper.status} role="status">
          {!isDesktop()
            ? "미리보기 · 저장하지 않아요"
            : {
                saved: "저장됨",
                unsaved: "저장 대기 중",
                saving: "저장 중…",
                error: "저장하지 못했어요",
              }[status]}
        </span>
      </footer>
      {(error || failure) && (
        <div className={s.failure}>
          <p role="alert" className={c.error}>
            {error || failure}
          </p>
          {error && (
            <Button variant="ghost" size="small" disabled={busy} onClick={() => void flush()}>
              다시 저장
            </Button>
          )}
        </div>
      )}
    </main>
  );
}

export function MemoNote({ id, noteId }: { id: string; noteId: string }): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const [closeError, setCloseError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    return () => document.documentElement.classList.remove(transparentDocument);
  }, []);
  const widget = snapshot?.widgets.find((item) => item.id === id);
  const note = rows(record(widget?.data).notes).find((item) => item.id === noteId);
  if (widget && note) {
    return <NoteEditor key={noteId} id={id} note={note} />;
  }
  return (
    <main className={paper.stage}>
      <IconButton
        icon="close"
        aria-label="메모 넣기"
        size="compact"
        onClick={() =>
          void command("close_memo_note", { id, noteId }).catch((cause: unknown) =>
            setCloseError(errorText(cause)),
          )
        }
      />
      {closeError && <p role="alert">{closeError}</p>}
      <div className={s.failure}>
        {error ? (
          <>
            <p role="alert" className={c.error}>
              {error}
            </p>
            <Button variant="ghost" onClick={reload}>
              다시 불러오기
            </Button>
          </>
        ) : (
          <p role="status">{snapshot ? "사용할 수 없는 메모예요." : "메모를 불러오고 있어요."}</p>
        )}
      </div>
    </main>
  );
}
