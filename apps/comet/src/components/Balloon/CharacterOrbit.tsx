import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import {
  OrbitBranch,
  OrbitExpandedMenu,
  type OrbitMenuItems,
  type OrbitPrimaryItems,
} from "@comet/ui";
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
type Branch = "interaction" | "pause" | "play" | "toys";
type ExitIntent =
  | { type: "close" }
  | { type: "action"; id: string; closeAll: boolean }
  | { type: "back"; branch: Branch }
  | { type: "switch"; to: Branch };

/** The ring a branch fans out from; top-level branches come off the main ring. */
const PARENT: Record<Branch, Branch | null> = {
  interaction: null,
  pause: "interaction",
  play: null,
  toys: "play",
};
/** Where focus returns when a branch folds: the node that opened it. */
const OPENER: Record<Branch, string> = {
  interaction: '[data-character-orbit-main] button[aria-label="교감"]',
  play: '[data-character-orbit-main] button[aria-label="같이 놀기"]',
  pause: '[data-character-orbit-branch="interaction"] button[aria-label="자동 잡담 쉬기"]',
  toys: '[data-character-orbit-branch="play"] button[aria-label="장난감 꺼내기"]',
};
const CLOSED: Record<Branch, BranchState> = {
  interaction: "closed",
  pause: "closed",
  play: "closed",
  toys: "closed",
};
/** Children first, so closing everything folds the outermost ring before its parent. */
const DEPTH_ORDER: Branch[] = ["pause", "toys", "interaction", "play"];
/** Actions that keep the menu open: the friend reacts in place. */
const IN_PLACE = new Set(["snack", "stroke", "poke", "pause"]);

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
  const [branches, setBranches] = useState(CLOSED);
  const [mainOpen, setMainOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const intent = useRef<ExitIntent | null>(null);
  const alive = useRef(true);
  const seenCloseRequest = useRef(closeRequest);
  const restoreFocus = useRef<Branch | null>(null);
  const focusInto = useRef<Branch | null>(null);
  const callbacks = useRef({ onAction, onClose });
  callbacks.current = { onAction, onClose };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function setBranch(branch: Branch, value: BranchState): void {
    setBranches((current) => ({ ...current, [branch]: value }));
  }
  useLayoutEffect(() => {
    if (pending) return;
    if (restoreFocus.current) {
      const branch = restoreFocus.current;
      restoreFocus.current = null;
      root.current?.querySelector<HTMLButtonElement>(OPENER[branch])?.focus();
    } else if (focusInto.current && branches[focusInto.current] === "open") {
      // Enter on a node opens its outer ring and moves the keyboard there.
      const branch = focusInto.current;
      focusInto.current = null;
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-character-orbit-branch="${branch}"] [data-orbit-primary] button:not(:disabled)`,
        )
        ?.focus();
    }
  }, [pending, branches]);
  async function finishAction(): Promise<void> {
    const operation = intent.current;
    if (!operation || operation.type === "back" || operation.type === "switch") return;
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
  /** Folds the outermost open ring, or the main menu once no branch is left. */
  function foldNext(state: Record<Branch, BranchState>): void {
    const next = DEPTH_ORDER.find((branch) => state[branch] === "open");
    if (next) setBranch(next, "closing");
    else if (ready) setMainOpen(false);
    else void finishAction();
  }
  function closeAll(operation: ExitIntent): void {
    if (intent.current) return;
    intent.current = operation;
    setPending(true);
    setError(undefined);
    foldNext(branches);
  }
  function closeBranch(branch: Branch, operation: ExitIntent = { type: "back", branch }): void {
    if (intent.current) return;
    intent.current = operation;
    setPending(true);
    // A child ring folds before the ring it came from.
    const child = DEPTH_ORDER.find(
      (value) => PARENT[value] === branch && branches[value] !== "closed",
    );
    setBranch(child ?? branch, "closing");
  }
  function exited(branch: Branch): void {
    const next = { ...branches, [branch]: "closed" as const };
    setBranches(next);
    const operation = intent.current;
    if (!operation) return;
    if (
      operation.type === "back" &&
      operation.branch !== branch &&
      PARENT[branch] === operation.branch
    ) {
      setBranch(operation.branch, "closing");
    } else if (operation.type === "back") {
      intent.current = null;
      setPending(false);
      restoreFocus.current = branch;
    } else if (operation.type === "switch") {
      const parent = PARENT[branch];
      if (parent && next[parent] === "open") setBranch(parent, "closing");
      else {
        intent.current = null;
        setPending(false);
        setBranch(operation.to, "open");
      }
    } else if (operation.type === "action" && !operation.closeAll) {
      restoreFocus.current = branch;
      void finishAction();
    } else foldNext(next);
  }
  function back(): void {
    const open = DEPTH_ORDER.find((branch) => branches[branch] !== "closed");
    if (open) closeBranch(open);
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
  const main: OrbitPrimaryItems = [
    { id: "chat", label: "말 걸기", icon: "chat", disabled: locked },
    { id: "resume", label: "이어서 하기", icon: "resume", disabled: locked },
    { id: "together", label: "함께 이야기해 봐", icon: "together", disabled: locked },
    { id: "history", label: "지난 대화", icon: "history", disabled: locked },
    { id: "settings", label: "설정", icon: "gear", disabled: locked },
    { id: "hide", label: "캐릭터 숨기기", icon: "hide", disabled: locked },
    { id: "play", label: "같이 놀기", icon: "ball2", disabled: locked },
    { id: "interact", label: "교감", icon: "heart", disabled: locked },
  ];
  const interactions: OrbitPrimaryItems = [
    { id: "stroke", label: "쓰다듬기", icon: "pet", disabled: locked || !character },
    { id: "poke", label: "콕 찌르기", icon: "poke", disabled: locked || !character },
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
  const games: OrbitMenuItems = [
    { id: "play-dice", label: "주사위 굴리기", icon: "dice", disabled: locked },
    { id: "play-coin", label: "동전 던지기", icon: "coin", disabled: locked },
    { id: "play-rps", label: "가위바위보", icon: "scissors", disabled: locked },
    { id: "play-number", label: "숫자 맞히기", icon: "hash", disabled: locked },
    { id: "toys", label: "장난감 꺼내기", icon: "toybox", disabled: locked },
    { id: "play-cups", label: "컵 찾기", icon: "cupdown", disabled: locked },
    { id: "play-fortune", label: "장난 운세", icon: "crystal", disabled: locked },
  ];
  const toys: OrbitMenuItems = [
    { id: "toy-ball", label: "공", icon: "ball2", disabled: locked },
    { id: "toy-paper-plane", label: "종이비행기", icon: "plane", disabled: locked },
    { id: "toy-bubbles", label: "비눗방울", icon: "bubble", disabled: locked },
    { id: "toy-pet", label: "작은 펫", icon: "paw", disabled: locked },
  ];
  function toggle(branch: Branch): void {
    if (branches[branch] !== "closed") {
      closeBranch(branch);
      return;
    }
    const other = (["interaction", "play"] as const).find(
      (value) => value !== branch && PARENT[branch] === null && branches[value] !== "closed",
    );
    if (other) {
      closeBranch(other, { type: "switch", to: branch });
      return;
    }
    if (root.current?.contains(document.activeElement)) focusInto.current = branch;
    setBranch(branch, "open");
  }
  function act(id: string): void {
    if (locked || intent.current || !ready) return;
    setError(undefined);
    if (id === "interact") toggle("interaction");
    else if (id === "play") toggle("play");
    else if (id === "toys") toggle("toys");
    else if (id === "pause" && !paused) toggle("pause");
    else if (id === "pause-hour" || id === "pause-restart") {
      intent.current = { type: "action", id, closeAll: false };
      setPending(true);
      setBranch("pause", "closing");
    } else if (IN_PLACE.has(id)) {
      intent.current = { type: "action", id, closeAll: false };
      setPending(true);
      void finishAction();
    } else closeAll({ type: "action", id, closeAll: true });
  }
  const present = (branch: Branch): boolean => branches[branch] !== "closed";
  const size = present("toys")
    ? { width: 800, height: 420 }
    : present("pause")
      ? { width: 640, height: 500 }
      : present("interaction") || present("play")
        ? { width: 600, height: 420 }
        : { width: 320, height: 340 };
  function branch(
    id: Branch,
    props: {
      title: string;
      hubIcon: "heart" | "pause" | "ball2" | "toybox";
      items: OrbitPrimaryItems;
      origin: { x: number; y: number };
      center: { x: number; y: number };
      selectedId?: string;
      label?: string;
    },
  ): JSX.Element | null {
    if (!present(id)) return null;
    return (
      <OrbitBranch
        data-character-orbit-branch={id}
        aria-label={props.label}
        className={styles.readableOrbit}
        origin={props.origin}
        center={props.center}
        title={props.title}
        hubIcon={props.hubIcon}
        items={props.items}
        selectedId={props.selectedId}
        open={ready && branches[id] === "open"}
        onAction={act}
        onBack={() => closeBranch(id)}
        onExitComplete={() => {
          if (branches[id] === "closing") exited(id);
        }}
      />
    );
  }
  return (
    <div ref={root} className={styles.orbitTree} style={size}>
      <OrbitExpandedMenu
        data-character-orbit-main
        open={ready && mainOpen}
        onExitComplete={() => {
          if (!mainOpen) void finishAction();
        }}
        className={styles.readableOrbit}
        size="compact"
        parent={name}
        title="함께하기"
        hubIcon="together"
        items={main}
        selectedId={present("interaction") ? "interact" : present("play") ? "play" : undefined}
        onAction={act}
        onBack={back}
        characterAnchor={anchor ?? { x: 154, y: 254 }}
        character={
          <span className={styles.orbitAnchor} data-character-orbit-anchor aria-hidden="true" />
        }
      />
      {branch("interaction", {
        label: `${name} 교감`,
        title: "교감",
        hubIcon: "heart",
        items: interactions,
        origin: { x: 214.9, y: 178 },
        center: { x: 406, y: 234 },
        selectedId: present("pause") ? "pause" : undefined,
      })}
      {branch("pause", {
        title: "자동 잡담 쉬기",
        hubIcon: "pause",
        items: pauseChoices,
        origin: { x: 464.9, y: 268 },
        center: { x: 500, y: 400 },
      })}
      {branch("play", {
        label: `${name} 같이 놀기`,
        title: "같이 놀기",
        hubIcon: "ball2",
        items: games,
        origin: { x: 223.8, y: 138.9 },
        center: { x: 420, y: 250 },
        selectedId: present("toys") ? "toys" : undefined,
      })}
      {branch("toys", {
        title: "장난감 꺼내기",
        hubIcon: "toybox",
        items: toys,
        origin: { x: 463.7, y: 197.9 },
        center: { x: 674, y: 170 },
      })}
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
