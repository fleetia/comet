import { useEffect, useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { DEFAULT_SHORTCUT, shortcutLabel, type LauncherState } from "./search";
import * as s from "../../lagrange.css";

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
export function LauncherSettings(): JSX.Element {
  const [state, setState] = useState<LauncherState | null>(
    isDesktop()
      ? null
      : { sessionId: 0, shortcut: DEFAULT_SHORTCUT, shortcutRegistered: true, shortcutError: null },
  );
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void command<LauncherState>("get_launcher_state")
      .then((value) => {
        if (active) setState(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(shortcut: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setRecording(false);
    setError(null);
    try {
      setState(await command<LauncherState>("set_launcher_shortcut", { shortcut }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  function record(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setRecording(false);
      return;
    }
    if (event.key === "Tab") {
      setRecording(false);
      return;
    }
    event.preventDefault();
    const shortcut = capturedShortcut(event);
    if (shortcut) void save(shortcut);
  }
  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>빠른 실행 단축키</h2>
      <p className={s.quiet}>
        설정과 위젯을 찾거나 친구에게 말을 걸어요. 트레이의 ‘빠른 실행’으로도 열 수 있어요.
      </p>
      <div className={s.row}>
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
            : state?.shortcut
              ? shortcutLabel(state.shortcut)
              : "단축키 없음"}
        </Button>
        <Button
          variant="quiet"
          disabled={pending || !state?.shortcut}
          onClick={() => void save("")}
        >
          단축키 끄기
        </Button>
        <Button variant="quiet" disabled={pending} onClick={() => void save(DEFAULT_SHORTCUT)}>
          기본값으로
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            void command("open_launcher").catch((cause: unknown) => setError(errorText(cause)));
          }}
        >
          빠른 실행 열기
        </Button>
      </div>
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
