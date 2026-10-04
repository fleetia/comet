import { Button } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "./diaryEnvelope.css";

type JournalEvent = { id: string; widgetKind: string; createdAt: number; text: string };
type JournalRow = [number, JournalEvent];

export function DiaryJournal({ date }: { date: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<JournalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  async function load(before: number | null): Promise<void> {
    if (!isDesktop()) return;
    const request = ++generation.current;
    const [year, month, day] = date.split("-").map(Number);
    // Local calendar midnights also cover 23/25-hour days when the device changes daylight saving time.
    const startAt = new Date(year, month - 1, day).getTime();
    const endAt = new Date(year, month - 1, day + 1).getTime();
    setBusy(true);
    setError(null);
    try {
      const next = await command<JournalRow[]>("get_widget_journal", { before, startAt, endAt });
      if (generation.current !== request) return;
      setEntries((current) =>
        before === null
          ? next
          : [
              ...current,
              ...next.filter(([seq]) => !current.some(([existing]) => existing === seq)),
            ],
      );
      setMore(next.length === 100);
    } catch (cause: unknown) {
      if (generation.current === request) setError(errorText(cause));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  useEffect(() => {
    setEntries([]);
    setMore(false);
    setError(null);
    setBusy(false);
    if (open) void load(null);
    return () => {
      generation.current += 1;
    };
  }, [date, open]);
  return (
    <details
      className={s.disclosure}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>함께한 기록</summary>
      {open && (
        <>
          <p className={s.caption}>{date} · 도구에서 실제로 일어난 일</p>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <Button variant="quiet" size="compact" disabled={busy} onClick={() => void load(null)}>
            기록 새로고침
          </Button>
          {entries.length === 0 && !busy && !error && (
            <p className={s.caption}>이날 함께한 기록이 없어요.</p>
          )}
          {entries.map(([seq, entry]) => (
            <article className={s.note} key={seq}>
              <p className={s.noteBody}>{entry.text}</p>
              <time className={s.caption} dateTime={new Date(entry.createdAt).toISOString()}>
                {new Date(entry.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </article>
          ))}
          {more && entries.length > 0 && (
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => void load(entries[entries.length - 1][0])}
            >
              이전 기록 더 보기
            </Button>
          )}
          {busy && <p role="status">기록을 불러오고 있어요.</p>}
        </>
      )}
    </details>
  );
}
