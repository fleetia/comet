import { Button, IconButton } from "@fleetia/lagrange";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { number, record, rows, text, type DataRecord } from "../toolData";
import { useWidgets } from "../useWidgets";
import { useMemoDraft } from "../useMemoDraft";
import * as c from "../../lagrange.css";
import * as s from "../memo.css";

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
    <WidgetFrame
      variant="note"
      title={text(note.title) || "메모"}
      closeLabel="메모 넣기"
      onClose={putAway}
      footer={
        <div className={s.footer}>
          <span role="status">
            {!isDesktop()
              ? "미리보기 · 저장하지 않아요"
              : {
                  saved: "저장됨",
                  unsaved: "저장 대기 중",
                  saving: "저장 중…",
                  error: "저장하지 못했어요",
                }[status]}
          </span>
          <div className={s.footerRow}>
            <div className={s.fontControls}>
              <IconButton
                label="글자 크기 줄이기"
                variant="quiet"
                size="compact"
                disabled={busy || draft.fontSize <= 12}
                onClick={() => edit({ fontSize: draft.fontSize - 2 })}
              >
                A−
              </IconButton>
              <span aria-label="글자 크기">{draft.fontSize}px</span>
              <IconButton
                label="글자 크기 키우기"
                variant="quiet"
                size="compact"
                disabled={busy || draft.fontSize >= 24}
                onClick={() => edit({ fontSize: draft.fontSize + 2 })}
              >
                A+
              </IconButton>
            </div>
            <Button
              aria-label="새 메모 꺼내기"
              variant="quiet"
              size="compact"
              disabled={busy || !isDesktop()}
              onClick={() => void create()}
            >
              + 새 메모
            </Button>
          </div>
        </div>
      }
    >
      <textarea
        ref={input}
        className={s.editor}
        aria-label="메모 본문"
        placeholder="메모를 적어 보세요."
        maxLength={50000}
        value={draft.body}
        readOnly={busy}
        style={{ fontSize: draft.fontSize }}
        onChange={(event) => edit({ body: event.target.value })}
        onBlur={() => void flush()}
      />
      {(error || failure) && (
        <div className={s.failure}>
          <p role="alert" className={c.error}>
            {error || failure}
          </p>
          {error && (
            <Button variant="quiet" size="compact" disabled={busy} onClick={() => void flush()}>
              다시 저장
            </Button>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}

export function MemoNote({ id, noteId }: { id: string; noteId: string }): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const widget = snapshot?.widgets.find((item) => item.id === id);
  const note = rows(record(widget?.data).notes).find((item) => item.id === noteId);
  if (widget?.installed && widget.enabled && note) {
    return <NoteEditor key={noteId} id={id} note={note} />;
  }
  return (
    <WidgetFrame
      variant="note"
      title="메모"
      closeLabel="메모 넣기"
      onClose={async () => {
        await command("close_memo_note", { id, noteId });
      }}
    >
      <div className={s.failure}>
        {error ? (
          <>
            <p role="alert" className={c.error}>
              {error}
            </p>
            <Button variant="secondary" onClick={reload}>
              다시 불러오기
            </Button>
          </>
        ) : (
          <p role="status">{snapshot ? "사용할 수 없는 메모예요." : "메모를 불러오고 있어요."}</p>
        )}
      </div>
    </WidgetFrame>
  );
}
