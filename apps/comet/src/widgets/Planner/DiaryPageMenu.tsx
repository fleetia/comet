import { Button, Dialog, FormField, TextField } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { DiaryAction, DiaryPage } from "./diaryTypes";
import * as s from "./diaryEnvelope.css";

type DiaryPageMenuProps = {
  page: DiaryPage;
  onAction: DiaryAction;
  busy: boolean;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function pageVersion(page: DiaryPage): string {
  return JSON.stringify([
    page.id,
    page.date,
    page.title,
    page.entries.map((entry) => [
      entry.id,
      entry.kind,
      entry.text,
      entry.refId ?? null,
      entry.itemId ?? null,
      entry.time ?? null,
    ]),
  ]);
}

export function DiaryPageMenu({
  page,
  onAction,
  busy,
  onDeleted,
  onDirtyChange,
}: DiaryPageMenuProps): ReactElement {
  const [opened, setOpened] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [baseline, setBaseline] = useState({ version: pageVersion(page), title: page.title });
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty = opened && page.date === null && title !== baseline.title;
  const disabled = busy || working;
  const conflict = opened && baseline.version !== pageVersion(page);
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );

  function reset(): void {
    setBaseline({ version: pageVersion(page), title: page.title });
    setTitle(page.title);
    setError("");
    setDeleting(false);
  }

  async function submit(action: "page-update" | "page-delete"): Promise<void> {
    if (pending.current || busy) return;
    if (baseline.version !== pageVersion(page)) {
      setError("다른 곳에서 이 페이지가 바뀌었어요. 최신 내용을 확인한 뒤 다시 시도해 주세요.");
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    try {
      const success = await onAction(action, {
        id: page.id,
        ...(action === "page-update" ? { title } : {}),
      });
      if (!success) {
        setError(
          action === "page-delete"
            ? "페이지를 삭제하지 못했어요. 다시 시도해 주세요."
            : "제목을 저장하지 못했어요. 입력한 내용은 남아 있어요.",
        );
        return;
      }
      setOpened(false);
      setDeleting(false);
      if (action === "page-delete") onDeleted();
    } catch {
      setError("변경을 저장하지 못했어요. 입력한 내용은 남아 있어요.");
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }

  return (
    <>
      <Button
        variant="quiet"
        size="compact"
        aria-label="페이지 메뉴"
        disabled={disabled}
        onClick={() => {
          reset();
          setOpened(true);
        }}
      >
        ···
      </Button>
      <Dialog
        isOpen={opened}
        title={deleting ? "이 페이지를 삭제할까요?" : "페이지 관리"}
        closeLabel="닫기"
        size="small"
        onOpenChange={(open) => {
          if (!disabled) {
            setOpened(open);
            if (!open) setDeleting(false);
          }
        }}
      >
        <div className={s.form}>
          {deleting ? (
            <>
              <p>
                이 페이지에 적은 기록을 삭제해요. 연결한 할 일, 계속 쓸 메모, 준비 봉투 자체는
                남아요.
              </p>
              <div className={s.actions}>
                <Button variant="secondary" disabled={disabled} onClick={() => setDeleting(false)}>
                  취소
                </Button>
                <Button
                  variant="critical"
                  disabled={disabled || conflict}
                  onClick={() => void submit("page-delete")}
                >
                  페이지 삭제
                </Button>
              </div>
            </>
          ) : (
            <>
              {page.date === null && (
                <form
                  className={s.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit("page-update");
                  }}
                >
                  <FormField label="페이지 제목">
                    <TextField
                      value={title}
                      maxLength={500}
                      disabled={disabled}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </FormField>
                  <div className={s.actions}>
                    <Button type="submit" variant="primary" disabled={disabled || conflict}>
                      제목 저장
                    </Button>
                  </div>
                </form>
              )}
              {page.date !== null && <p className={s.caption}>{page.date}의 기록을 관리해요.</p>}
              <Button
                variant="quiet"
                disabled={disabled || conflict}
                onClick={() => setDeleting(true)}
              >
                페이지 삭제…
              </Button>
            </>
          )}
          {(error || conflict) && (
            <p className={s.error} role="alert">
              {error || "다른 곳에서 이 페이지가 바뀌었어요. 최신 내용을 확인해 주세요."}
            </p>
          )}
          {conflict && (
            <Button variant="secondary" disabled={disabled} onClick={reset}>
              최신 내용 다시 불러오기
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
