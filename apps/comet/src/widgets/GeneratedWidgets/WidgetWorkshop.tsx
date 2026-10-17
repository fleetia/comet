import { useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { Dialog } from "@comet/ui";
import { Button } from "../../ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import { useWindowCloseGuard } from "../useWindowCloseGuard";
import { useGeneratedWidgets } from "./useGeneratedWidgets";
import * as s from "./generatedWidgets.css";
import * as common from "../../lagrange.css";

export function WidgetWorkshop(): ReactElement {
  const { workshop, error: loadError, reload } = useGeneratedWidgets();
  const [request, setRequest] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const importArea = useRef<HTMLTextAreaElement>(null);
  const [importOpen, setImportOpen] = useState(
    () => new URLSearchParams(location.search).get("mode") === "import",
  );
  const modeSequence = useRef(Number(new URLSearchParams(location.search).get("sequence")) || 0);
  const closeGuard = useWindowCloseGuard(Boolean(request || importText), false, async () => {
    await command("close_widget_workshop");
    generation.current += 1;
  });
  useEffect(() => {
    mounted.current = true;
    let cleanup: (() => void) | undefined;
    function receive(value: { mode: string; sequence: number }): void {
      if (!mounted.current || !value || value.sequence < modeSequence.current) return;
      modeSequence.current = value.sequence;
      setImportOpen(value.mode === "import");
      if (value.mode === "import") importArea.current?.focus();
    }
    if (isDesktop())
      void listen<{ mode: string; sequence: number }>("widget-workshop-mode", (event) =>
        receive(event.payload),
      )
        .then(async (unlisten) => {
          if (!mounted.current) {
            unlisten();
            return;
          }
          cleanup = unlisten;
          receive(await command("get_widget_workshop_mode"));
        })
        .catch((cause) => {
          if (mounted.current) setError(errorText(cause));
        });
    return () => {
      mounted.current = false;
      generation.current += 1;
      cleanup?.();
    };
  }, []);
  async function run(action: () => Promise<unknown>): Promise<void> {
    if (pending.current) {
      return;
    }
    pending.current = true;
    const version = ++generation.current;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current && version === generation.current) setError(errorText(cause));
    } finally {
      pending.current = false;
      if (mounted.current && version === generation.current) {
        setBusy(false);
        reload();
      }
    }
  }
  async function generate(): Promise<void> {
    const submitted = request;
    await run(async () => {
      const version = generation.current;
      await command("generate_widget", {
        request: submitted,
        id: null,
        expectedRevision: null,
      });
      if (!mounted.current || version !== generation.current) return;
      setRequest((current) => (current === submitted ? "" : current));
      setNotice("위젯 창에서 실행을 확인하고 있어요. 오류가 있으면 AI가 이어서 수정해요.");
    });
  }
  async function cancel(): Promise<void> {
    const version = generation.current;
    try {
      await command("cancel_widget_generation");
    } catch (cause) {
      if (mounted.current && version === generation.current) setError(errorText(cause));
    }
  }
  return (
    <WidgetFrame
      title="AI 위젯 만들기"
      closeLabel="위젯 제작 닫기"
      onClose={closeGuard.requestClose}
    >
      <div className={s.body}>
        <p>필요한 도구를 말해 주세요. 지금 선택한 AI가 만들고 사용 중에도 고쳐 줘요.</p>
        <p role="status" className={s.status}>
          {workshop.generationEligibility.reason}
        </p>
        <label className={s.field}>
          어떤 도구가 필요한가요?
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            maxLength={2000}
            placeholder="뜨개질 단수를 세고 목표까지 얼마나 남았는지 보여 줘"
            disabled={busy}
          />
        </label>
        <div className={s.actions}>
          <Button
            variant="primary"
            disabled={
              busy || !request.trim() || !isDesktop() || !workshop.generationEligibility.allowed
            }
            onClick={() => void generate()}
          >
            만들기
          </Button>
          {busy && (
            <Button
              variant="secondary"
              onClick={() => void cancel()}
            >
              제작 중단
            </Button>
          )}
        </div>
        {busy && <p role="status">AI가 제작하고 있어요…</p>}
        {(error || loadError) && (
          <p className={common.error} role="alert">
            {error || loadError}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <p className={s.status}>
          만든 위젯은 위젯 목록에서 실행·수정하고 설치 정보를 확인할 수 있어요.
        </p>
        <Button
          variant="secondary"
          disabled={busy || !isDesktop()}
          onClick={() => void run(() => command("open_widgets"))}
        >
          위젯 목록 열기
        </Button>
        <details
          className={s.item}
          open={importOpen}
          onToggle={(event) => setImportOpen(event.currentTarget.open)}
        >
          <summary>다른 AI가 만든 위젯 가져오기</summary>
          <p className={s.status}>
            같은 형식의 JSON 정의를 붙여 넣으면 격리 실행 검사 후 사용할 수 있어요. 개인 상태는 공유
            정의에 포함되지 않아요.
          </p>
          <textarea
            ref={importArea}
            aria-label="위젯 JSON"
            maxLength={98304}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={busy || !importText.trim() || !isDesktop()}
            onClick={() =>
              void run(async () => {
                const submitted = importText;
                const version = generation.current;
                await command("import_generated_widget", { definition: JSON.parse(submitted) });
                if (mounted.current && version === generation.current)
                  setImportText((current) => (current === submitted ? "" : current));
              })
            }
          >
            가져오기
          </Button>
          <p className={s.status}>
            정의: name, description, source, initialState. 코드는 render(state, now)와 reduce(state,
            action, now)를 정의해요.
          </p>
        </details>
        <Dialog
          isOpen={closeGuard.confirmClose}
          title="작성 중인 내용이 있어요"
          onOpenChange={(open) => {
            if (!open) closeGuard.keepEditing();
          }}
          variant="confirm"
          footer={
            <>
              <Button variant="secondary" onClick={closeGuard.keepEditing}>
                계속 편집
              </Button>
              <Button variant="critical" onClick={() => void closeGuard.discardAndClose()}>
                저장하지 않고 닫기
              </Button>
            </>
          }
        >
          <p>입력한 내용을 버리고 닫을까요? 진행 중인 제작도 중단해요.</p>
          {closeGuard.closeError && <p role="alert">{closeGuard.closeError}</p>}
        </Dialog>
      </div>
    </WidgetFrame>
  );
}
