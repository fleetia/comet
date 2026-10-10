import { Button, FormField, TextArea } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { text, type DataRecord, type ToolAction } from "../toolData";
import { clockLabel, moveDay, movePeriod, periodAnchor } from "../Planner/plannerData";
import {
  appUsageTime,
  focusBuckets,
  focusDuration,
  type FocusPeriod,
  type FocusSession,
} from "./FocusTimerData";
import * as s from "./FocusTimer.css";

export function FocusTimerStats({
  sessions,
  day,
  selectedId,
  onSelect,
  onOpenNote,
  act,
}: {
  sessions: FocusSession[];
  day: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenNote: (ref: DataRecord) => void;
  act: ToolAction;
}): ReactElement {
  const [period, setPeriod] = useState<FocusPeriod>("week");
  const [anchor, setAnchor] = useState(day);
  const [bucketKey, setBucketKey] = useState<string | null>(null);
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
    <section className={s.pane} aria-label="집중 통계">
      <div className={s.presets} aria-label="통계 기간">
        {(
          [
            ["day", "일"],
            ["week", "주"],
            ["month", "월"],
            ["year", "년"],
          ] as const
        ).map(([value, title]) => (
          <Button
            key={value}
            variant="quiet"
            size="compact"
            className={s.preset}
            aria-pressed={period === value}
            onClick={() => {
              setPeriod(value);
              setBucketKey(null);
            }}
          >
            {title}
          </Button>
        ))}
      </div>
      <div className={s.heading}>
        <Button
          variant="quiet"
          size="compact"
          aria-label="이전 통계 기간"
          onClick={() => shift(-1)}
        >
          ‹
        </Button>
        <span className={s.quiet}>{label}</span>
        <Button variant="quiet" size="compact" aria-label="다음 통계 기간" onClick={() => shift(1)}>
          ›
        </Button>
      </div>
      <div className={s.statsSummary}>
        <strong className={s.total}>{focusDuration(total)}</strong>
        <span className={s.quiet}>{allIds.size}회 집중</span>
      </div>
      <div
        className={s.chart}
        data-dense={buckets.length > 12}
        aria-label={`${label} 실제 집중 시간 그래프`}
      >
        {buckets.map((bucket) => (
          <button
            key={bucket.key}
            className={s.bar}
            type="button"
            aria-pressed={chosen?.key === bucket.key}
            aria-label={`${bucket.label} ${focusDuration(bucket.elapsedMs)}`}
            title={`${bucket.label} · ${focusDuration(bucket.elapsedMs)}`}
            onClick={() => setBucketKey(bucket.key === bucketKey ? null : bucket.key)}
          >
            <span className={s.barTrack}>
              <span
                className={s.barFill}
                style={{ height: `${(bucket.elapsedMs / maximum) * 100}%` }}
              />
            </span>
            <span className={s.barLabel}>{bucket.label}</span>
          </button>
        ))}
      </div>
      <p className={`${s.quiet} ${s.chartCaption}`}>
        {chosen
          ? `${chosen.label} · ${focusDuration(chosen.elapsedMs)}`
          : "휴식과 일시정지를 제외한 실제 집중 시간이에요."}
      </p>
      <div className={s.recordHeading}>
        <h2 className={s.headingText}>{chosen ? "선택한 기간의 집중" : "집중 기록"}</h2>
        <Button
          variant="quiet"
          size="compact"
          onClick={() => {
            setAnchor(day);
            setBucketKey(null);
          }}
        >
          현재 기간
        </Button>
      </div>
      {visible.length === 0 && (
        <p className={s.empty}>아직 집중 기록이 없어요. 이번 집중부터 시간을 쌓아가요.</p>
      )}
      <div className={s.activityList}>
        {visible.map((session) => (
          <Button
            key={session.id}
            variant="quiet"
            className={s.recordButton}
            onClick={() => onSelect(session.id)}
            aria-label={`${session.title} 집중 기록 상세`}
          >
            <span className={s.recordRow}>
              <span className={s.quiet}>{clockLabel(session.startedAt)}</span>
              <span className={s.grow}>
                <span className={s.itemTitle}>{session.title}</span>
                <span className={s.caption}>
                  {session.active
                    ? "집중 중"
                    : session.outcome === "completed"
                      ? "시간 종료"
                      : "직접 마침"}
                  {session.memo || text(session.noteRef.id) ? " · 메모 있음" : ""}
                </span>
                {session.appUsage && (
                  <span className={s.caption}>
                    앱 전면 사용 · {session.appUsage.target.name}{" "}
                    {appUsageTime(session.appUsage.elapsedMs)}
                  </span>
                )}
              </span>
              <span>{focusDuration(session.elapsedMs)}</span>
            </span>
          </Button>
        ))}
      </div>
      {sessions.length > 0 && first && last && (
        <p className={s.quiet}>새로 남긴 집중 구간을 기준으로 집계해요.</p>
      )}
    </section>
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
    <section className={s.pane} aria-label="집중 기록 상세">
      <Button variant="quiet" disabled={busy} onClick={onBack}>
        ‹ 집중 기록
      </Button>
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
              {session.appUsage.target.name} · {appUsageTime(session.appUsage.elapsedMs)}
            </dd>
          </>
        )}
      </dl>
      <FormField label="집중 기록 메모">
        <TextArea
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
        <Button variant="secondary" disabled={busy || conflict} onClick={() => void save()}>
          기록 메모 저장
        </Button>
        {saved && <span className={s.quiet}>저장됨</span>}
        {conflict && (
          <Button
            variant="quiet"
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
        <Button variant="quiet" onClick={() => onOpenNote(session.noteRef)}>
          연결한 노트 열기
        </Button>
      )}
    </section>
  );
}
