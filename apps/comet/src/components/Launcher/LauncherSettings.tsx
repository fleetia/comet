import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "../../ui";
import { Keycap } from "@comet/ui";
import * as styles from "./launcherSettings.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { DEFAULT_SHORTCUT, shortcutLabel, type LauncherState } from "./search";
import * as s from "../../common.css";

function capturedShortcut(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (![event.ctrlKey, event.metaKey, event.altKey].some(Boolean)) return null;
  const code = event.code;
  if (!/^(Key[A-Z]|Digit[0-9]|Space|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right))$/.test(code))
    return null;
  return [
    event.metaKey ? "Super" : "",
    event.ctrlKey ? "Control" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    code,
  ]
    .filter(Boolean)
    .join("+");
}
export function LauncherSettings({ onDirtyChange, compact = false }: { onDirtyChange?: (dirty: boolean) => void; compact?: boolean }): JSX.Element {
  const [state, setState] = useState<LauncherState | null>(
    isDesktop()
      ? null
      : { sessionId: 0, shortcut: DEFAULT_SHORTCUT, shortcutRegistered: true, shortcutError: null },
  );
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(DEFAULT_SHORTCUT);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const lock = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty = Boolean(state && draft !== state.shortcut);
  useEffect(() => { report.current?.(dirty); }, [dirty]);
  useEffect(() => {
    if (!isDesktop()) return;
    mounted.current = true;
    const request = ++sequence.current;
    void command<LauncherState>("get_launcher_state")
      .then((value) => {
        if (mounted.current && request === sequence.current) { setState(value); setDraft(value.shortcut); }
      })
      .catch((cause: unknown) => {
        if (mounted.current && request === sequence.current) setError(errorText(cause));
      });
    return () => {
      mounted.current = false;
      sequence.current += 1;
      report.current?.(false);
    };
  }, []);
  async function save(shortcut: string): Promise<void> {
    if (lock.current || !state || !isDesktop()) return;
    lock.current = true;
    const request = ++sequence.current;
    setPending(true);
    setRecording(false);
    setError(null);
    try {
      const next = await command<LauncherState>("set_launcher_shortcut", { shortcut });
      if (!mounted.current || request !== sequence.current) return;
      setState(next);
      setDraft(next.shortcut);
    } catch (cause) {
      if (mounted.current && request === sequence.current) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (mounted.current && request === sequence.current) setPending(false);
    }
  }
  function record(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(state?.shortcut ?? "");
      setRecording(false);
      return;
    }
    if (event.key === "Tab") {
      setRecording(false);
      return;
    }
    event.preventDefault();
    const shortcut = capturedShortcut(event);
    if (shortcut) { setDraft(shortcut); setRecording(false); setError(null); }
  }
  return (
    <section className={compact ? styles.compact : s.section}>
      <h2 className={compact ? styles.label : s.sectionTitle}>빠른 실행 단축키</h2>
      {!compact && <p className={s.quiet}>
        설정과 위젯을 찾거나 친구에게 말을 걸어요. 트레이의 ‘빠른 실행’으로도 열 수 있어요.
      </p>}
      <div className={compact ? styles.controls : s.row}>
        <Button
          variant="secondary"
          disabled={pending || !state}
          onClick={(event) => {
            event.currentTarget.focus();
            setRecording(true);
          }}
          onKeyDown={record}
          onBlur={() => setRecording(false)}
          aria-label="빠른 실행 단축키 변경"
        >
          {recording
            ? "사용할 키를 눌러 주세요…"
            : draft
              ? <Keycap>{shortcutLabel(draft)}</Keycap>
              : "단축키 없음"}
        </Button>
        {(!compact || dirty) && <>
        <Button variant="primary" disabled={pending || !state || !dirty} onClick={() => void save(draft)}>적용</Button>
        <Button variant="quiet" disabled={pending || !state || !dirty} onClick={() => { setDraft(state?.shortcut ?? ""); setError(null); }}>변경 취소</Button>
        <Button
          variant="quiet"
          disabled={pending || !state?.shortcut}
          onClick={() => void save("")}
        >
          단축키 끄기
        </Button>
        <Button variant="quiet" disabled={pending || !state} onClick={() => void save(DEFAULT_SHORTCUT)}>
          기본값으로
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            void command("open_launcher").catch((cause: unknown) => {
              if (mounted.current) setError(errorText(cause));
            });
          }}
        >
          빠른 실행 열기
        </Button>
        </>}
      </div>
      {compact && !dirty && <details className={styles.options}><summary>단축키 관리</summary><div className={s.row}><Button variant="quiet" size="compact" onClick={() => void save("")} disabled={pending}>끄기</Button><Button variant="quiet" size="compact" onClick={() => void save(DEFAULT_SHORTCUT)} disabled={pending}>기본값으로</Button><Button variant="quiet" size="compact" onClick={() => void command("open_launcher").catch((cause: unknown) => setError(errorText(cause)))}>빠른 실행 열기</Button></div></details>}
      {recording && (
        <p className={s.quiet} role="status">
          ⌘, Ctrl 또는 Alt와 함께 눌러 주세요. Esc로 취소해요.
        </p>
      )}
      {(error || state?.shortcutError) && (
        <p className={s.error} role="alert">
          {error ?? state?.shortcutError}
        </p>
      )}
      {state && !state.shortcutRegistered && state.shortcut && (
        <p className={s.quiet}>다른 단축키를 지정하거나 트레이에서 열어 주세요.</p>
      )}
    </section>
  );
}
