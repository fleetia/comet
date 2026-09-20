import { Button } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
type JournalEvent = { id: string; widgetKind: string; createdAt: number; text: string };
type JournalRow = [number, JournalEvent];
export function JournalTool({ widget }: { widget: WidgetView }): ReactElement {
  const [entries, setEntries] = useState<JournalRow[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(true);
  const generation = useRef(0);
  async function load(before: number | null): Promise<void> {
    if (!isDesktop()) {
      setMore(false);
      return;
    }
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await command<JournalRow[]>("get_widget_journal", { before });
      if (generation.current === request) {
        setEntries((current) =>
          before === null
            ? next
            : [
                ...current,
                ...next.filter(([seq]) => !current.some(([existing]) => existing === seq)),
              ],
        );
        setMore(next.length > 0);
      }
    } catch (cause: unknown) {
      if (generation.current === request) {
        setError(errorText(cause));
      }
    } finally {
      if (generation.current === request) {
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    void load(null);
    return () => {
      generation.current += 1;
    };
  }, [widget.id]);
  return (
    <>
      <p className={c.quiet}>설치한 도구에서 실제로 발생한 사건입니다.</p>
      {error && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      <Button variant="secondary" disabled={busy} onClick={() => void load(null)}>
        새로고침
      </Button>
      {entries.length === 0 && !busy && <p>아직 함께한 사건이 없어요.</p>}
      {entries.map(([seq, entry]) => (
        <article className={s.item} key={seq}>
          <p className={s.prose}>{entry.text}</p>
          <time className={`${c.quiet} ${s.data}`}>
            {new Date(entry.createdAt).toLocaleString()}
          </time>
        </article>
      ))}
      {more && entries.length > 0 && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void load(entries[entries.length - 1][0])}
        >
          이전 사건 더 보기
        </Button>
      )}
      {busy && <p role="status">사건을 불러오고 있어요.</p>}
    </>
  );
}
