import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Dialog, OrganizationCard, SearchInput, SegmentedControl } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  OrganizerAction,
  OrganizerRecord,
  OrganizerSearchHit,
  OrganizerStatus,
  SourceDocument,
} from "../../organizer/types";
import * as s from "./diaryOrganizer.css";
import * as common from "../../common.css";

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
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
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
  const entries = [
    ...directActions.map((action) => ({
      id: `action:${action.id}`,
      kind: "direct",
      title: action.title,
      createdAt: action.createdAt,
      state: action.undone ? "undone" : "saved",
      action,
      record: null,
    })),
    ...records.map((record) => ({
      id: `record:${record.id}`,
      kind: "summary",
      title: record.title,
      createdAt: record.createdAt,
      state: record.state,
      action: null,
      record,
    })),
  ]
    .filter((entry) => filter === "all" || entry.kind === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const selectedRecord = selected?.record;
  const selectedAction = selected?.action;
  return (
    <section className={s.panel} aria-label="Ex-brain 정리 기록">
      <form
        className={s.actions}
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) void run("organizer_search", { query: query.trim() });
        }}
      >
        <SearchInput
          className={s.search}
          aria-label="기록·원문 검색"
          placeholder="기록·원문 검색"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value) setHits(null);
          }}
        />
        <Button
          type="submit"
          variant="ghost"
          size="small"
          disabled={pending || !isDesktop() || !query.trim()}
        >
          검색
        </Button>
        <SegmentedControl
          label="정리 기록 종류"
          appearance="contained"
          value={filter}
          options={[
            { value: "all", label: "전체" },
            { value: "summary", label: "자료 정리" },
            { value: "direct", label: "직접 요청" },
          ]}
          onValueChange={(value) => {
            setFilter(value);
            setHits(null);
          }}
        />
        {hits && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              setHits(null);
              setQuery("");
            }}
          >
            전체 정리 기록
          </Button>
        )}
      </form>
      {status && (
        <p className={s.caption}>
          완료 {status.progress.completed} · 대기 {status.progress.pending} · 처리 중{" "}
          {status.progress.running} · 보류 {status.progress.deferred}
          {status.paused ? " · 일시정지" : ""}
        </p>
      )}
      <div className={s.layout}>
        <div className={s.list} aria-label={hits ? "검색 결과" : "정리 기록 목록"}>
          {hits ? (
            <>
              {hits.length === 0 && <p className={s.caption}>일치하는 자료가 없어요.</p>}
              {hits.map((hit) => (
                <OrganizationCard
                  key={`${hit.source.id}:${hit.recordId ?? "source"}`}
                  title={hit.title}
                  description={hit.excerpt}
                  timestamp={hit.source.title}
                  statusLabel="검색 결과"
                  onClick={() =>
                    void run("organizer_open_source", {
                      sourceId: hit.source.id,
                      recordId: hit.recordId,
                    })
                  }
                  disabled={pending}
                />
              ))}
            </>
          ) : (
            <>
              {entries.length === 0 && (
                <p className={s.caption}>
                  아직 정리 기록이 없어요. AI 연결의 Ex-brain에서 자료를 연결하거나 캐릭터에게
                  기록을 부탁해 보세요.
                </p>
              )}
              {entries.map((entry) => (
                <OrganizationCard
                  key={entry.id}
                  title={entry.title}
                  selected={selected?.id === entry.id}
                  timestamp={new Date(entry.createdAt).toLocaleString()}
                  description={entry.kind === "direct" ? "직접 요청" : entry.record?.source.title}
                  status={
                    entry.state === "undone"
                      ? "reverted"
                      : entry.state === "conflict" || entry.state === "failed"
                        ? "conflict"
                        : entry.state === "prepared"
                          ? "confirmation"
                          : "saved"
                  }
                  statusLabel={STATES[entry.state] ?? "상태 확인 필요"}
                  onClick={() => setSelectedId(entry.id)}
                />
              ))}
            </>
          )}
        </div>
        <article className={s.detail} aria-label="선택한 정리 기록">
          {selected ? (
            <>
              <header>
                <h2 className={s.heading}>{selected.title}</h2>
                <p className={s.caption}>
                  {new Date(selected.createdAt).toLocaleString()} ·{" "}
                  {STATES[selected.state] ?? "상태 확인 필요"}
                </p>
              </header>
              {selectedRecord && (
                <>
                  <p className={s.text}>{selectedRecord.markdown}</p>
                  <div className={s.source}>
                    <p className={s.caption}>
                      출처 · {selectedRecord.source.title} · {selectedRecord.source.locator}
                    </p>
                    {selectedRecord.outputPath && (
                      <p className={s.caption}>저장 위치 · {selectedRecord.outputPath}</p>
                    )}
                  </div>
                </>
              )}
              {selectedAction?.error && (
                <p role="alert" className={common.error}>
                  {selectedAction.error}
                </p>
              )}
              {selectedAction && (
                <p className={s.caption}>
                  캐릭터에게 직접 요청해 저장한 기록이에요. 결과와 원문을 열어 확인할 수 있어요.
                </p>
              )}
              {selectedAction?.undoSupported === false && !selectedAction.undone && (
                <p id="organizer-undo-reason" className={s.caption}>
                  {selectedAction.undoReason?.trim() || "이 동작은 되돌릴 수 없어요."}
                </p>
              )}
              <div className={s.actions}>
                {selectedAction && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void run("organizer_open_action", { operationId: selectedAction.id })
                    }
                  >
                    결과 열기
                  </Button>
                )}
                {(selectedRecord || selectedAction?.sourceId) && (
                  <Button
                    variant="ghost"
                    disabled={pending || !isDesktop() || selectedRecord?.source.active === false}
                    onClick={() =>
                      void run("organizer_open_source", {
                        sourceId: selectedRecord?.source.id ?? selectedAction?.sourceId,
                      })
                    }
                  >
                    원문 열기
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={
                    pending ||
                    !isDesktop() ||
                    selected.state === "undone" ||
                    selected.state === "conflict" ||
                    selectedAction?.undoSupported === false
                  }
                  aria-describedby={
                    selectedAction?.undoSupported === false && !selectedAction.undone
                      ? "organizer-undo-reason"
                      : undefined
                  }
                  onClick={() =>
                    void run("organizer_undo", {
                      operationId: selectedRecord?.operationId ?? selectedAction?.id,
                    })
                  }
                >
                  되돌리기
                </Button>
              </div>
            </>
          ) : (
            <p className={s.caption}>정리한 내용을 이곳에서 확인할 수 있어요.</p>
          )}
        </article>
      </div>
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
