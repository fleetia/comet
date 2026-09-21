import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button } from "@fleetia/lagrange";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../../widgets/useWidgets";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import {
  bindTarget,
  DEFAULT_SHORTCUT,
  launcherResults,
  shortcutLabel,
  type LauncherAction,
  type LauncherResult,
  type LauncherState,
  type TargetBinding,
} from "./search";
import * as styles from "./launcher.css";

const PREVIEW_STATE: LauncherState = {
  sessionId: 0,
  shortcut: DEFAULT_SHORTCUT,
  shortcutRegistered: true,
  shortcutError: null,
};
const GLYPHS = { settings: "⚙", widget: "◇", chat: "﹥", target: "◌", notice: "!" };
export function Launcher({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const widgets = useWidgets();
  const [query, setQuery] = useState("");
  const [binding, setBinding] = useState<TargetBinding | null>(null);
  const [state, setState] = useState<LauncherState | null>(isDesktop() ? null : PREVIEW_STATE);
  const stateRef = useRef(state);
  const inputRef = useRef<HTMLInputElement>(null);
  const windowRef = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const pendingSession = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const results = launcherResults(query, snapshot, widgets.snapshot, binding);
  const selected = results.find((result) => result.id === selectedId) ?? results[0];
  const modelReady =
    snapshot.settings.mode === "api"
      ? snapshot.hasApiKey && !!snapshot.settings.apiModel.trim()
      : snapshot.modelReady;

  useEffect(() => {
    inputRef.current?.focus();
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    function receive(next: LauncherState): void {
      if (!active || (stateRef.current && next.sessionId < stateRef.current.sessionId)) return;
      const newer = next.sessionId !== stateRef.current?.sessionId;
      stateRef.current = next;
      setState(next);
      if (newer) {
        pendingSession.current = null;
        setPending(false);
        setError(null);
        setSelectedId(null);
      }
      inputRef.current?.focus();
    }
    void listen<LauncherState>("launcher-opened", (event) => receive(event.payload))
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        receive(await command<LauncherState>("get_launcher_state"));
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    if (selected)
      document.getElementById(`launcher-${selected.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.id]);

  useEffect(() => {
    const element = windowRef.current;
    if (!isDesktop() || !element || !state || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let frame = 0;
    let previousHeight = 0;
    const sessionId = state.sessionId;
    function measure(): void {
      if (!element || disposed) return;
      const height = Math.max(
        250,
        Math.min(500, Math.ceil(element.getBoundingClientRect().height)),
      );
      if (height === previousHeight) return;
      previousHeight = height;
      void command("resize_launcher", { sessionId, height }).catch((cause: unknown) => {
        if (!disposed) setError(errorText(cause));
      });
    }
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(element);
    measure();
    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [state?.sessionId]);

  function edit(value: string): void {
    if (pendingSession.current !== null) return;
    setQuery(value);
    setBinding((previous) => bindTarget(value, snapshot.characters, previous));
    setSelectedId(null);
    setError(null);
  }
  async function close(): Promise<void> {
    if (!stateRef.current) return;
    try {
      await command("close_launcher", { sessionId: stateRef.current.sessionId });
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  async function execute(result: LauncherResult, keepDraft = false): Promise<void> {
    if (pendingSession.current !== null || composing.current) return;
    if (result.kind === "target") {
      const target = result.recipient;
      setQuery(target ? `>${target.token} ` : "> ");
      setBinding(target ?? null);
      setSelectedId(null);
      setError(null);
      inputRef.current?.focus();
      return;
    }
    if (!result.action || !stateRef.current) return;
    const sessionId = stateRef.current.sessionId;
    pendingSession.current = sessionId;
    setPending(true);
    setError(null);
    const action: LauncherAction =
      result.action.type === "chat"
        ? { ...result.action, clientMessageId: crypto.randomUUID() }
        : result.action;
    try {
      await command("execute_launcher", { request: { sessionId, action } });
      if (stateRef.current.sessionId === sessionId && !keepDraft) {
        setQuery("");
        setBinding(null);
        setSelectedId(null);
      }
    } catch (cause) {
      if (stateRef.current.sessionId === sessionId) {
        setError(errorText(cause));
        inputRef.current?.focus();
      }
    } finally {
      if (pendingSession.current === sessionId) {
        pendingSession.current = null;
        setPending(false);
      }
    }
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      void close();
      return;
    }
    if (pendingSession.current !== null) return;
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const index = results.findIndex((result) => result.id === selected?.id);
      const next = (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      setSelectedId(results[next]?.id ?? null);
    } else if (event.key === "Enter" && !event.shiftKey && selected) {
      event.preventDefault();
      void execute(selected);
    }
  }
  const setup: LauncherResult = {
    id: "model-settings",
    kind: "settings",
    title: "AI 연결 열기",
    detail: "",
    preview: "",
    action: { type: "settings", section: "model" },
  };
  return (
    <main
      ref={windowRef}
      className={styles.window}
      onKeyDown={(event) => {
        if (
          !event.defaultPrevented &&
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          !composing.current &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          void close();
        }
      }}
    >
      <WindowHeader
        className={styles.header}
        title="빠른 실행"
        label="빠른 실행 닫기"
        onClose={close}
      />
      <div className={styles.search}>
        <span className={styles.searchIcon} aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-label="찾거나 말 걸기"
          aria-autocomplete="list"
          aria-expanded={true}
          aria-controls="launcher-results"
          aria-activedescendant={selected ? `launcher-${selected.id}` : undefined}
          aria-describedby="launcher-hint"
          autoComplete="off"
          spellCheck={false}
          placeholder="무엇을 할까요?"
          maxLength={2100}
          value={query}
          readOnly={pending}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={keyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
      </div>
      <p id="launcher-hint" className={styles.hint}>
        {query.startsWith(">")
          ? "친구를 고르고 말을 적어 주세요. 예: >B 오늘 졸리네"
          : "설정 · 공 던지기 · 하고 싶은 말     > 친구 고르기"}
      </p>
      <ul
        className={styles.results}
        id="launcher-results"
        role="listbox"
        aria-label="실행 후보"
        aria-busy={pending}
      >
        {results.map((result) => (
          <li
            key={result.id}
            id={`launcher-${result.id}`}
            role="option"
            aria-selected={result.id === selected?.id}
            aria-disabled={!result.action && result.kind !== "target"}
            className={styles.result}
            onPointerMove={() => {
              if (!pending && selected?.id !== result.id) setSelectedId(result.id);
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void execute(result)}
          >
            <span className={styles.glyph} aria-hidden="true">
              {GLYPHS[result.kind]}
            </span>
            <span className={styles.resultText}>
              <span className={styles.title}>{result.title}</span>
              <span className={styles.detail}>{result.detail}</span>
            </span>
            {result.id === selected?.id && <span aria-hidden="true">↵</span>}
          </li>
        ))}
      </ul>
      {(error || widgets.error) && (
        <div className={styles.error} role="alert">
          {error ?? widgets.error}
          <div className={styles.errorActions}>
            {error && selected?.kind === "chat" && !modelReady && (
              <Button
                variant="quiet"
                size="compact"
                disabled={pending}
                onClick={() => void execute(setup, true)}
              >
                AI 연결 열기
              </Button>
            )}
            {widgets.error && (
              <Button variant="quiet" size="compact" onClick={widgets.reload}>
                위젯 다시 읽기
              </Button>
            )}
          </div>
        </div>
      )}
      {selected?.kind === "chat" && (
        <section className={styles.preview} aria-label="실행 미리보기" aria-live="polite">
          <span className={styles.previewLabel}>{selected.title}</span>
          <p className={styles.previewText}>{selected.preview || "하고 싶은 말을 적어 주세요."}</p>
          {!modelReady && (
            <span className={styles.detail}>
              단어장은 바로 답해요. 그 밖의 대화에는 AI 연결이 필요해요.
            </span>
          )}
          {[...selected.preview].length > 2000 && (
            <span className={styles.detail}>대화는 2,000자까지 보낼 수 있어요.</span>
          )}
        </section>
      )}
      <footer className={styles.footer}>
        <span className={styles.keys}>
          <span>
            <kbd>↑ ↓</kbd> 선택
          </span>
          <span>
            <kbd>↵</kbd> 실행
          </span>
          <span>
            <kbd>esc</kbd> 닫기
          </span>
        </span>
        <span role="status">
          {pending
            ? "실행 중…"
            : !isDesktop()
              ? "화면 미리보기"
              : state?.shortcutRegistered
                ? shortcutLabel(state.shortcut)
                : "트레이에서 열 수 있어요"}
        </span>
      </footer>
    </main>
  );
}
