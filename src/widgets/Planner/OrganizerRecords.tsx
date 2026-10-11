import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Dialog, FormField, TextField } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  OrganizerAction,
  OrganizerRecord,
  OrganizerSearchHit,
  OrganizerStatus,
  SourceDocument,
} from "../../organizer/types";
import * as s from "../../components/OrganizerSettings/organizerSettings.css";
import * as common from "../../lagrange.css";

const STATES: Record<string, string> = {
  saved: "저장됨",
  applied: "저장됨",
  complete: "저장됨",
  completed: "저장됨",
  undone: "되돌림",
  conflict: "수정 충돌",
  failed: "실패",
  prepared: "저장 확인 중",
};

export function OrganizerRecords(): JSX.Element {
  const [records, setRecords] = useState<OrganizerRecord[]>([]);
  const [actions, setActions] = useState<OrganizerAction[]>([]);
  const [status, setStatus] = useState<OrganizerStatus | null>(null);
  const [query, setQuery] = useState("");
  const currentQuery = useRef(query);
  currentQuery.current = query;
  const [hits, setHits] = useState<OrganizerSearchHit[] | null>(null);
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const fetching = useRef(false);
  const lock = useRef(false);
  const directActions = actions.filter((action) => action.kind !== "summary");
  async function refresh(): Promise<void> {
    if (fetching.current) return;
    fetching.current = true;
    const version = epoch.current;
    try {
      const [nextRecords, nextStatus, nextActions] = await Promise.all([
        command<OrganizerRecord[]>("organizer_records"),
        command<OrganizerStatus>("organizer_status"),
        command<OrganizerAction[]>("organizer_actions"),
      ]);
      if (mounted.current && version === epoch.current) {
        setRecords(nextRecords ?? []);
        setStatus(nextStatus ?? null);
        setActions(nextActions ?? []);
      }
    } catch (cause) {
      if (mounted.current && version === epoch.current) setError(errorText(cause));
    } finally {
      fetching.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!isDesktop()) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      mounted.current = false;
      epoch.current += 1;
      clearInterval(timer);
    };
  }, []);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const version = ++epoch.current;
    try {
      if (name === "organizer_search") {
        const result = await command<OrganizerSearchHit[]>(name, args);
        if (
          mounted.current &&
          version === epoch.current &&
          currentQuery.current.trim() === args?.query
        )
          setHits(result);
      } else if (name === "organizer_open_source" || name === "organizer_open_action") {
        const result = await command<SourceDocument>(name, args);
        if (mounted.current && version === epoch.current) setSource(result);
      } else {
        await command(name, args);
        if (mounted.current && version === epoch.current) {
          if (name === "organizer_undo") setNotice("이 정리에서 바꾼 내용을 되돌렸어요.");
          await refresh();
        }
      }
    } catch (cause) {
      if (mounted.current && version === epoch.current) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (mounted.current && version === epoch.current) setPending(false);
    }
  }
  return (
    <section className={s.panel} aria-label="Ex-brain 정리 기록">
      <h1 className={s.heading}>정리 기록</h1>
      <p className={s.caption}>
        Comet과 연결한 Vault에서 근거를 찾고, 정리한 내용과 변경을 확인해요.
      </p>
      {status && (
        <p className={s.caption}>
          완료 {status.progress.completed} · 대기 {status.progress.pending} · 처리 중{" "}
          {status.progress.running} · 보류 {status.progress.deferred} · 오늘 자동 호출{" "}
          {status.progress.requestsToday}/{status.settings.dailyRequestLimit}
          {status.paused ? " · 일시정지" : ""}
        </p>
      )}
      <form
        className={s.actions}
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) void run("organizer_search", { query: query.trim() });
        }}
      >
        <FormField label="기록·원문 검색">
          <TextField
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value) setHits(null);
            }}
          />
        </FormField>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending || !isDesktop() || !query.trim()}
        >
          검색
        </Button>
        {hits && (
          <Button
            variant="quiet"
            onClick={() => {
              setHits(null);
              setQuery("");
            }}
          >
            전체 정리 기록
          </Button>
        )}
      </form>
      {hits ? (
        <div className={s.section} aria-label="검색 결과">
          {hits.length === 0 && <p>일치하는 자료가 없어요.</p>}
          {hits.map((hit) => (
            <article className={s.item} key={`${hit.source.id}:${hit.recordId ?? "source"}`}>
              <h2 className={s.heading}>{hit.title}</h2>
              <p className={s.text}>{hit.excerpt}</p>
              <p className={s.caption}>{hit.source.locator}</p>
              <Button
                variant="quiet"
                disabled={pending}
                onClick={() =>
                  void run("organizer_open_source", {
                    sourceId: hit.source.id,
                    recordId: hit.recordId,
                  })
                }
              >
                열기
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className={s.section}>
          {records.length === 0 && directActions.length === 0 && (
            <p className={s.caption}>
              아직 정리 기록이 없어요. AI 연결의 Ex-brain에서 자료를 연결하거나 캐릭터에게 기록을
              부탁해 보세요.
            </p>
          )}
          {directActions.map((action) => (
            <article className={s.item} key={action.id}>
              <h2 className={s.heading}>{action.title}</h2>
              <p className={s.caption}>
                {new Date(action.createdAt).toLocaleString()} · 직접 요청
                {action.undone ? " · 되돌림" : " · 저장됨"}
              </p>
              {action.error && (
                <p role="alert" className={common.error}>
                  {action.error}
                </p>
              )}
              <div className={s.actions}>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void run("organizer_open_action", { operationId: action.id })}
                >
                  결과 열기
                </Button>
                {action.sourceId && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void run("organizer_open_source", { sourceId: action.sourceId })}
                  >
                    원문 열기
                  </Button>
                )}
                <Button
                  variant="quiet"
                  disabled={pending || !isDesktop() || action.undone}
                  onClick={() => void run("organizer_undo", { operationId: action.id })}
                >
                  되돌리기
                </Button>
              </div>
            </article>
          ))}
          {records.map((record) => (
            <article className={s.item} key={record.id}>
              <h2 className={s.heading}>{record.title}</h2>
              <p className={s.caption}>
                {new Date(record.createdAt).toLocaleString()} ·{" "}
                {STATES[record.state] ?? "상태 확인 필요"}
              </p>
              <details>
                <summary>정리 내용</summary>
                <p className={s.text}>{record.markdown}</p>
              </details>
              <p className={s.caption}>
                출처 · {record.source.title} · {record.source.locator}
              </p>
              {record.outputPath && <p className={s.caption}>저장 위치 · {record.outputPath}</p>}
              <div className={s.actions}>
                <Button
                  variant="secondary"
                  disabled={pending || !record.source.active || !isDesktop()}
                  onClick={() => void run("organizer_open_source", { sourceId: record.source.id })}
                >
                  원문 열기
                </Button>
                <Button
                  variant="quiet"
                  disabled={
                    pending ||
                    !isDesktop() ||
                    record.state === "undone" ||
                    record.state === "conflict"
                  }
                  onClick={() => void run("organizer_undo", { operationId: record.operationId })}
                >
                  되돌리기
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {(error || status?.error) && (
        <p className={common.error} role="alert">
          {error || status?.error}
        </p>
      )}
      {notice && (
        <p role="status" className={common.success}>
          {notice}
        </p>
      )}
      <Dialog
        isOpen={source !== null}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
        title={source?.source.title || "원문"}
        closeLabel="원문 닫기"
      >
        <p className={s.caption}>{source?.source.locator}</p>
        <p className={s.text}>{source?.content}</p>
      </Dialog>
    </section>
  );
}
