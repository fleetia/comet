import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { OrbitBranch, OrbitExpandedMenu, type OrbitMenuItems } from "@comet/ui";
import type { InstalledCharacter } from "../../types";
import * as styles from "../companion.css";

type Props = {
  name: string;
  character?: InstalledCharacter;
  anchor?: { x: number; y: number };
  ready?: boolean;
  closeRequest?: number;
  paused: boolean;
  pausedUntil?: number | null;
  sleeping: boolean;
  busy: boolean;
  onAction: (id: string) => void | boolean | Promise<boolean | void>;
  onClose: () => void | boolean | Promise<boolean | void>;
};
type BranchState = "closed" | "open" | "closing";
type ExitIntent =
  | { type: "close" }
  | { type: "action"; id: string; closeAll: boolean }
  | { type: "back"; branch: "interaction" | "pause" };

export function CharacterOrbit({
  name,
  character,
  anchor,
  ready = true,
  closeRequest,
  paused,
  pausedUntil,
  sleeping,
  busy,
  onAction,
  onClose,
}: Props): JSX.Element {
  const [interaction, setInteraction] = useState<BranchState>("closed");
  const [pause, setPause] = useState<BranchState>("closed");
  const [mainOpen, setMainOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const intent = useRef<ExitIntent | null>(null);
  const alive = useRef(true);
  const seenCloseRequest = useRef(closeRequest);
  const restoreFocus = useRef<"interaction" | "pause" | null>(null);
  const callbacks = useRef({ onAction, onClose });
  callbacks.current = { onAction, onClose };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function focusParent(branch: "interaction" | "pause"): void {
    restoreFocus.current = branch;
  }
  useLayoutEffect(() => {
    if (pending || !restoreFocus.current) return;
    const branch = restoreFocus.current;
    restoreFocus.current = null;
    const selector =
      branch === "pause"
        ? '[data-character-orbit-branch="interaction"] [data-orbit-primary="5"] button'
        : '[data-character-orbit-main] button[aria-label="교감"]';
    root.current?.querySelector<HTMLButtonElement>(selector)?.focus();
  }, [pending, interaction, pause]);
  async function finishAction(): Promise<void> {
    const operation = intent.current;
    if (!operation || operation.type === "back") return;
    try {
      const result = await (operation.type === "close"
        ? callbacks.current.onClose()
        : callbacks.current.onAction(operation.id));
      if (!alive.current || intent.current !== operation) return;
      // A failed/stale native operation leaves the menu usable for another attempt.
      if (result === false && (operation.type === "close" || operation.closeAll)) {
        setMainOpen(true);
      }
    } catch {
      if (!alive.current || intent.current !== operation) return;
      setMainOpen(true);
      setError("작업을 마치지 못했어요. 다시 시도해 주세요.");
    } finally {
      if (alive.current && intent.current === operation) {
        intent.current = null;
        setPending(false);
      }
    }
  }
  function closeAll(operation: ExitIntent): void {
    if (intent.current) return;
    intent.current = operation;
    setPending(true);
    setError(undefined);
    if (pause !== "closed") setPause("closing");
    else if (interaction !== "closed") setInteraction("closing");
    else if (ready) setMainOpen(false);
    else void finishAction();
  }
  function closeBranch(branch: "interaction" | "pause"): void {
    if (intent.current) return;
    intent.current = { type: "back", branch };
    setPending(true);
    if (branch === "pause" || pause !== "closed") setPause("closing");
    else setInteraction("closing");
  }
  function pauseExited(): void {
    setPause("closed");
    const operation = intent.current;
    if (!operation) return;
    if (operation.type === "back" && operation.branch === "pause") {
      intent.current = null;
      setPending(false);
      focusParent("pause");
    } else if (operation.type === "action" && !operation.closeAll) {
      focusParent("pause");
      void finishAction();
    } else setInteraction("closing");
  }
  function interactionExited(): void {
    setInteraction("closed");
    const operation = intent.current;
    if (!operation) return;
    if (operation.type === "back") {
      intent.current = null;
      setPending(false);
      focusParent("interaction");
    } else setMainOpen(false);
  }
  function back(): void {
    if (pause !== "closed") closeBranch("pause");
    else if (interaction !== "closed") closeBranch("interaction");
    else closeAll({ type: "close" });
  }
  useEffect(() => {
    function escape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      back();
    }
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  });
  useEffect(() => {
    if (seenCloseRequest.current === closeRequest) return;
    seenCloseRequest.current = closeRequest;
    closeAll({ type: "close" });
  });

  const locked = busy || pending;
  const main: OrbitMenuItems = [
    { id: "chat", label: "말 걸기", icon: "chat", disabled: locked },
    { id: "resume", label: "이어서 하기", icon: "resume", disabled: locked },
    { id: "together", label: "함께 이야기해 봐", icon: "together", disabled: locked },
    { id: "history", label: "지난 대화", icon: "history", disabled: locked },
    { id: "settings", label: "설정", icon: "gear", disabled: locked },
    { id: "hide", label: "캐릭터 숨기기", icon: "hide", disabled: locked },
    { id: "interact", label: "교감", icon: "heart", disabled: locked },
  ];
  const interactions: OrbitMenuItems = [
    { id: "snack", label: "간식 주기", icon: "cookie", disabled: locked },
    { id: "drink", label: "음료 건네기", icon: "drink", disabled: locked || !character },
    { id: "gift", label: "선물 건네기", icon: "gift", disabled: locked || !character },
    { id: "move", label: "움직이기", icon: "move", disabled: locked },
    {
      id: "sleep",
      label: sleeping ? "깨우기" : "재우기",
      icon: "moon",
      disabled: locked || !character,
    },
    {
      id: "pause",
      label: paused ? "다시 시작" : "자동 잡담 쉬기",
      icon: paused ? "play" : "pause",
      disabled: locked,
    },
  ];
  const pauseChoices: OrbitMenuItems = [
    { id: "pause-hour", label: "1시간", icon: "clock", disabled: locked },
    { id: "pause-restart", label: "다시 시작할 때까지", icon: "pause", disabled: locked },
  ];
  function act(id: string): void {
    if (locked || intent.current || !ready) return;
    setError(undefined);
    if (id === "interact") {
      if (interaction === "closed") setInteraction("open");
      else closeBranch("interaction");
    } else if (id === "pause" && !paused) {
      if (pause === "closed") setPause("open");
      else closeBranch("pause");
    } else if (id === "pause-hour" || id === "pause-restart") {
      intent.current = { type: "action", id, closeAll: false };
      setPending(true);
      setPause("closing");
    } else if (id === "snack" || id === "pause") {
      intent.current = { type: "action", id, closeAll: false };
      setPending(true);
      void finishAction();
    } else closeAll({ type: "action", id, closeAll: true });
  }
  const interactionPresent = interaction !== "closed";
  const pausePresent = pause !== "closed";
  return (
    <div
      ref={root}
      className={styles.orbitTree}
      style={{
        width: pausePresent ? 640 : interactionPresent ? 600 : 320,
        height: pausePresent ? 500 : interactionPresent ? 420 : 340,
      }}
    >
      <OrbitExpandedMenu
        data-character-orbit-main
        open={ready && mainOpen}
        onExitComplete={() => {
          if (!mainOpen) void finishAction();
        }}
        size="compact"
        parent={name}
        title="함께하기"
        hubIcon="together"
        items={main}
        selectedId={interactionPresent ? "interact" : undefined}
        onAction={act}
        onBack={back}
        characterAnchor={anchor ?? { x: 154, y: 254 }}
        character={
          <span className={styles.orbitAnchor} data-character-orbit-anchor aria-hidden="true" />
        }
      />
      {interactionPresent && (
        <OrbitBranch
          data-character-orbit-branch="interaction"
          aria-label={`${name} 교감`}
          origin={{ x: 214.9, y: 178 }}
          center={{ x: 406, y: 234 }}
          title="교감"
          hubIcon="heart"
          items={interactions}
          selectedId={pausePresent ? "pause" : undefined}
          open={ready && interaction === "open"}
          onAction={act}
          onBack={() => closeBranch("interaction")}
          onExitComplete={() => {
            if (interaction === "closing") interactionExited();
          }}
        />
      )}
      {pausePresent && (
        <OrbitBranch
          data-character-orbit-branch="pause"
          origin={{ x: 473, y: 222.19 }}
          center={{ x: 500, y: 390 }}
          title="자동 잡담 쉬기"
          hubIcon="pause"
          items={pauseChoices}
          open={ready && pause === "open"}
          onAction={act}
          onBack={() => closeBranch("pause")}
          onExitComplete={() => {
            if (pause === "closing") pauseExited();
          }}
        />
      )}
      {paused && (
        <p className={styles.orbitPauseStatus}>
          {pausedUntil
            ? `${new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}까지 자동 잡담 쉬는 중`
            : "다시 시작할 때까지 자동 잡담 쉬는 중"}
        </p>
      )}
      {error && (
        <p className={styles.orbitError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
