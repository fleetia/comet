import { Button, ChartBarItem, FocusRecordRow, FormField, IconButton, Textarea } from "@comet/ui";
import { FocusPanel } from "./FocusPanel";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, text, type DataRecord, type ToolAction } from "../toolData";
import { clockLabel, moveDay, movePeriod, periodAnchor } from "../Planner/plannerData";
import {
  appUsageTime,
  elapsedWithin,
  focusBuckets,
  focusDuration,
  type FocusBucket,
  type FocusPeriod,
  type FocusSession,
} from "./FocusTimerData";
import * as s from "./FocusTimer.css";

function bucketRangeLabel(bucket: FocusBucket, period: FocusPeriod): string {
  const start = new Date(bucket.startAt);
  const date = localDay(start);
  if (period === "day") {
    const end = localDay(new Date(bucket.endAt)) === date ? clockLabel(bucket.endAt) : "24:00";
    return `${date} ${clockLabel(bucket.startAt)}–${end}`;
  }
  if (period === "year") {
    return `${start.getFullYear()}년 ${start.getMonth() + 1}월`;
  }
  return date;
}

export function FocusTimerStats({
  sessions,
  day,
  selectedId,
  onSelect,
  onOpenNote,
  act,
  onNotes,
  onClose,
  onOpenTimeline,
}: {
  sessions: FocusSession[];
  day: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenNote: (ref: DataRecord) => void;
  act: ToolAction;
  onNotes?: () => void;
  onClose?: () => void;
  onOpenTimeline?: () => void;
}): ReactElement {
  const [period, setPeriod] = useState<FocusPeriod>("week");
  const [anchor, setAnchor] = useState(day);
  const [bucketKey, setBucketKey] = useState<string | null>(day);
  const selected = sessions.find((session) => session.id === selectedId);
  const buckets = focusBuckets(sessions, period, anchor);
  const chosen = buckets.find((bucket) => bucket.key === bucketKey);
  const total = buckets.reduce((sum, bucket) => sum + bucket.elapsedMs, 0);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.elapsedMs));
  const matchingIds = new Set(
    (chosen ? [chosen] : buckets).flatMap((bucket) => bucket.sessions.map((session) => session.id)),
  );
  const visible = sessions
    .filter((session) => matchingIds.has(session.id))
    .sort((left, right) => right.startedAt - left.startedAt);
  const allIds = new Set(
    buckets.flatMap((bucket) =>
      bucket.sessions.filter((session) => !session.active).map((session) => session.id),
    ),
  );
  const first = buckets[0],
    last = buckets[buckets.length - 1];
  const label =
    period === "day"
      ? anchor
      : period === "week"
        ? `${periodAnchor("week", anchor)} – ${moveDay(periodAnchor("week", anchor), 6)}`
        : period === "month"
          ? `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`
          : `${anchor.slice(0, 4)}년`;
  const scopeStart = chosen?.startAt ?? first?.startAt ?? 0;
  const scopeEnd = chosen?.endAt ?? last?.endAt ?? 0;
  const scopeLabel = chosen ? bucketRangeLabel(chosen, period) : label;
  const chosenScopeName = period === "week" || period === "month" ? "이 날짜" : "선택 구간";
  const scopeName = chosen ? chosenScopeName : "이 기간";
  const scopeDescription = (session: FocusSession): string =>
    `${scopeName} ${focusDuration(elapsedWithin(session, scopeStart, scopeEnd))} · 세션 전체 ${focusDuration(session.elapsedMs)}${session.appUsage ? ` · 앱 전면 사용 · 세션 전체 · ${session.appUsage.target.name} ${appUsageTime(session.appUsage.elapsedMs)}` : ""}`;
  function shift(amount: number): void {
    setAnchor(period === "day" ? moveDay(anchor, amount) : movePeriod(anchor, period, amount));
    setBucketKey(null);
  }
  if (selected)
    return (
      <FocusSessionDetail
        session={selected}
        onBack={() => onSelect(null)}
        onOpenNote={onOpenNote}
        act={act}
      />
    );
  return (
    <FocusPanel
      label="집중 통계"
      tab="records"
      onClose={onClose}
      onTabChange={(tab) => {
        if (tab === "notes") onNotes?.();
      }}
      period={period}
      onPeriodChange={(value) => {
        if (value === "day" || value === "week" || value === "month" || value === "year") {
          setPeriod(value);
          setBucketKey(null);
        }
      }}
    >
      <div className={s.periodSummary}>
        <span className={s.periodLabel}>{label} 합계</span>
        <div className={s.periodSummaryRow}>
          <div className={s.periodTotal}>
            <span className={s.periodTotalValue}>{focusDuration(total)}</span>
            <span className={s.periodCount}>{allIds.size}회 집중</span>
          </div>
          <div className={s.panelTools}>
            <IconButton
              icon="chevleft"
              variant="surface"
              aria-label="이전 기간"
              onClick={() => shift(-1)}
            />
            <IconButton
              icon="chev"
              variant="surface"
              aria-label="다음 기간"
              onClick={() => shift(1)}
            />
          </div>
        </div>
      </div>
      <div className={s.recordsChart} data-dense={buckets.length > 12}>
        {buckets.map((bucket) => (
          <ChartBarItem
            key={bucket.key}
            className={s.recordsChartBar}
            label={bucket.label}
            valueLabel={bucket.elapsedMs ? focusDuration(bucket.elapsedMs) : "—"}
            value={bucket.elapsedMs}
            max={maximum}
            current={
              chosen?.key === bucket.key ||
              (!chosen &&
                bucket.startAt <= new Date(`${day}T12:00:00`).getTime() &&
                bucket.endAt > new Date(`${day}T12:00:00`).getTime())
            }
            role="button"
            tabIndex={0}
            aria-pressed={chosen?.key === bucket.key}
            aria-label={`${bucketRangeLabel(bucket, period)} ${focusDuration(bucket.elapsedMs)}`}
            onClick={() => setBucketKey(bucket.key === bucketKey ? null : bucket.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setBucketKey(bucket.key === bucketKey ? null : bucket.key);
              }
            }}
          />
        ))}
      </div>
      <p className={s.recordsHelp}>
        휴식과 일시정지는 빼고 실제로 집중한 시간이에요.{" "}
        <button
          className={s.timelineLink}
          type="button"
          onClick={onOpenTimeline}
          disabled={!onOpenTimeline}
        >
          다이어리 시간표
        </button>
        에도 집중한 칸을 칠해줘요.
        {visible.length === 0 && (
          <span className={s.caption}>{scopeLabel}에 집중 기록이 없어요.</span>
        )}
      </p>
      <section className={s.recordsSection} aria-label="집중 기록 목록">
        <h2 className={s.noteHeading}>
          {chosen
            ? `${scopeLabel} · ${focusDuration(chosen.elapsedMs)}`
            : `${scopeName}의 집중 기록`}
        </h2>
        <div className={s.recordsList}>
          {visible.map((session) => (
            <FocusRecordRow
              key={session.id}
              className={s.focusRecordRow}
              time={`${clockLabel(session.startedAt)}–${clockLabel(session.endedAt)}`}
              title={session.title}
              duration={
                <span className={s.recordDuration}>
                  {focusDuration(elapsedWithin(session, scopeStart, scopeEnd))}
                  {session.appUsage && (
                    <span className={s.recordUsage}>
                      앱 {appUsageTime(session.appUsage.elapsedMs)}
                    </span>
                  )}
                </span>
              }
              description={
                <>
                  {session.active
                    ? "집중 중"
                    : session.outcome === "completed"
                      ? "시간 종료"
                      : "직접 마침"}
                  {session.memo || text(session.noteRef.id) ? " · 메모 있음" : ""}
                  {elapsedWithin(session, scopeStart, scopeEnd) !== session.elapsedMs && (
                    <span className={s.recordScope}>
                      {scopeName} {focusDuration(elapsedWithin(session, scopeStart, scopeEnd))} ·
                      세션 전체 {focusDuration(session.elapsedMs)}
                    </span>
                  )}
                </>
              }
              role="button"
              tabIndex={0}
              aria-label={`${session.title} 집중 기록 상세`}
              aria-description={scopeDescription(session)}
              onClick={() => onSelect(session.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(session.id);
                }
              }}
            />
          ))}
        </div>
      </section>
    </FocusPanel>
  );
}

function sessionMemoDraft(session: FocusSession): { memo: string; baseMemo: string } {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`comet.focus.session-memo:${session.id}`) || "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "memo" in value &&
      typeof value.memo === "string" &&
      "baseMemo" in value &&
      typeof value.baseMemo === "string"
    )
      return { memo: value.memo, baseMemo: value.baseMemo };
  } catch {
    /* The saved session remains readable without local draft storage. */
  }
  return { memo: session.memo, baseMemo: session.memo };
}

function FocusSessionDetail({
  session,
  onBack,
  onOpenNote,
  act,
}: {
  session: FocusSession;
  onBack: () => void;
  onOpenNote: (ref: DataRecord) => void;
  act: ToolAction;
}): ReactElement {
  const [initial] = useState(() => sessionMemoDraft(session));
  const [memo, setMemo] = useState(initial.memo);
  const [baseMemo, setBaseMemo] = useState(initial.baseMemo);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const previousId = useRef(session.id);
  const conflict = memo !== baseMemo && session.memo !== baseMemo;
  useEffect(() => {
    if (previousId.current !== session.id) {
      const draft = sessionMemoDraft(session);
      setMemo(draft.memo);
      setBaseMemo(draft.baseMemo);
    } else if (memo === baseMemo) {
      setMemo(session.memo);
      setBaseMemo(session.memo);
    }
    previousId.current = session.id;
    setSaved(false);
  }, [session.id, session.memo]);
  useEffect(() => {
    try {
      const key = `comet.focus.session-memo:${session.id}`;
      if (memo === baseMemo) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ memo, baseMemo }));
    } catch {
      /* Editing and explicit saving remain available. */
    }
  }, [session.id, memo, baseMemo]);
  async function save(): Promise<void> {
    if (busy || conflict) return;
    setBusy(true);
    try {
      const ok = session.active
        ? await act("update-memo", { memo, expectedMemo: baseMemo })
        : await act("update-session-memo", { id: session.id, memo, expectedMemo: baseMemo });
      if (ok) {
        setSaved(true);
        setBaseMemo(memo);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.recordsPanel} aria-label="집중 기록 상세">
      <Button variant="ghost" disabled={busy} onClick={onBack}>
        ‹ 집중 기록
      </Button>
      <span className={s.caption}>세션 전체 집중</span>
      <strong className={s.detailTime}>{focusDuration(session.elapsedMs)}</strong>
      <p className={s.quiet}>
        {new Date(session.startedAt).toLocaleDateString()} · {clockLabel(session.startedAt)}–
        {clockLabel(session.endedAt)}
      </p>
      <h2 className={s.headingText}>{session.title}</h2>
      <dl className={s.meta}>
        <dt>일정</dt>
        <dd>{text(session.eventRef.title) || "연결한 일정 없음"}</dd>
        <dt>종료</dt>
        <dd>
          {session.active
            ? "진행 중"
            : session.outcome === "completed"
              ? "설정한 시간 종료"
              : "직접 마침"}
        </dd>
        <dt>노트</dt>
        <dd>{text(session.noteRef.title) || "연결한 노트 없음"}</dd>
        {session.appUsage && (
          <>
            <dt>앱 전면 사용</dt>
            <dd>
              세션 전체 · {session.appUsage.target.name} ·{" "}
              {appUsageTime(session.appUsage.elapsedMs)}
            </dd>
          </>
        )}
      </dl>
      <FormField label="집중 기록 메모">
        <Textarea
          layout="flexible"
          fill
          rows={3}
          disabled={busy}
          className={s.textArea}
          value={memo}
          maxLength={20000}
          onChange={(event) => {
            setMemo(event.target.value);
            setSaved(false);
          }}
        />
      </FormField>
      {conflict && (
        <p role="alert" className={s.error}>
          다른 화면에서 메모가 바뀌었어요. 입력한 초안은 남아 있어요.
        </p>
      )}
      <div className={s.row}>
        <Button variant="ghost" disabled={busy || conflict} onClick={() => void save()}>
          기록 메모 저장
        </Button>
        {saved && <span className={s.quiet}>저장됨</span>}
        {conflict && (
          <Button
            variant="ghost"
            onClick={() => {
              setMemo(session.memo);
              setBaseMemo(session.memo);
            }}
          >
            최신 메모 불러오기
          </Button>
        )}
      </div>
      {text(session.noteRef.id) && (
        <Button variant="ghost" onClick={() => onOpenNote(session.noteRef)}>
          연결한 노트 열기
        </Button>
      )}
    </section>
  );
}
