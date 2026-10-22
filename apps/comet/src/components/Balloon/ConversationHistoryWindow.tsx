import { Fragment, useEffect, useRef, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@comet/icon";
import {
  Button,
  ChoiceButton,
  Dialog,
  InputCapsule,
  SearchInput,
  SegmentedControl,
  Surface,
} from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  ConversationMessages,
  ConversationMemoryReceipt,
  ConversationSession,
  ConversationTimelineEvent,
  ConversationView,
  Snapshot,
} from "../../types";
import { characterById, spriteSource } from "../characterIdentity";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import {
  ConversationMessageActions,
  ConversationSave,
  type ConversationSaveRequest,
} from "./ConversationSave";
import { responseOrigin } from "./conversationStatus";
import { draftPreview } from "./ConversationHistory";
import { useHistoryScroll, type HistoryReadingPosition } from "./useHistoryScroll";
import * as s from "./conversationHistoryWindow.css";

type Props = {
  snapshot: Snapshot;
  initialPersona?: string;
  preview?: boolean;
  previewConversations?: ConversationView[];
};
type HistoryRestoration = HistoryReadingPosition & {
  userId: string;
  selectedId: string | null;
  filter: string;
  query: string;
};
export type HistoryWindowState = { generation: number; restoration: HistoryRestoration | null };

type Draft = { userId: string; sessionId: string; value: string; saved: string };

function isFailedSubmission(snapshot: Snapshot, messageId: string): boolean {
  return (
    snapshot.runtime.phase === "error" &&
    snapshot.conversation?.recovery?.reason === "incomplete" &&
    snapshot.conversation.recovery.messageId === messageId
  );
}

function matchesFilter(session: ConversationSession, filter: string): boolean {
  return (
    filter === "all" ||
    (filter === "together"
      ? session.participants.length > 1
      : session.participants.includes(filter))
  );
}

function nameFor(snapshot: Snapshot, id: string): string {
  return characterById(snapshot, id)?.definition.name ?? id;
}
function sessionName(snapshot: Snapshot, session: ConversationSession): string {
  return session.participants.length > 1
    ? "함께"
    : nameFor(snapshot, session.participants[0] ?? "");
}
function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}
function messageTimeLabel(timestamp: number): string {
  return timeLabel(timestamp).replace(/^오[전후]\s*/, "");
}
function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "오늘";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "어제";
  return date.toLocaleDateString("ko-KR", {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
  });
}
function eventLabel(event: ConversationTimelineEvent): string {
  if (event.kind === "focus-paused") return "집중을 시작해서 대화를 멈췄어요";
  if (event.kind === "resumed") return "지난 대화에서 이야기를 이어가요";
  switch (event.source) {
    case "automatic":
      return "바탕화면에서 먼저 말을 걸었어요";
    case "desktop":
      return "바탕화면에서 대화를 시작했어요";
    case "reply":
      return "이 말에 답장하며 대화를 시작했어요";
    case "history":
      return "지난 대화에서 이야기를 이어가요";
    case "note":
      return "메모를 참고하며 대화를 시작했어요";
    case "music":
      return "음악 이야기를 시작했어요";
    default:
      return "대화 시작";
  }
}
type TranscriptRow =
  | { kind: "message"; message: ConversationMessages["messages"][number] }
  | { kind: "event"; event: ConversationTimelineEvent };

function transcriptRows(page: ConversationMessages | null): TranscriptRow[] {
  if (!page) return [];
  const messages = page.messages;
  const ids = new Set(messages.map((message) => message.id));
  const events = (page.timelineEvents ?? [])
    .filter(
      (event) =>
        event.kind !== "started" &&
        (event.messageId
          ? ids.has(event.messageId)
          : !page.nextBefore || !messages.length || event.createdAt >= messages[0].createdAt),
    )
    .sort((left, right) => left.createdAt - right.createdAt);
  const rows: TranscriptRow[] = [];
  const anchored = new Map<string, ConversationTimelineEvent[]>();
  const unanchored: ConversationTimelineEvent[] = [];
  for (const event of events) {
    if (event.messageId) {
      const group = anchored.get(event.messageId) ?? [];
      group.push(event);
      anchored.set(event.messageId, group);
    } else {
      unanchored.push(event);
    }
  }
  let next = 0;
  for (const message of messages) {
    const before = [...(anchored.get(message.id) ?? [])];
    while (next < unanchored.length && unanchored[next].createdAt <= message.createdAt) {
      before.push(unanchored[next++]);
    }
    before.sort((left, right) => left.createdAt - right.createdAt);
    rows.push(...before.map((event): TranscriptRow => ({ kind: "event", event })));
    rows.push({ kind: "message", message });
  }
  rows.push(...unanchored.slice(next).map((event): TranscriptRow => ({ kind: "event", event })));
  return rows;
}
function mergePages(
  earlier: ConversationMessages,
  later: ConversationMessages,
): ConversationMessages {
  const latestMessageIds = new Set(later.messages.map((message) => message.id));
  return {
    messages: Array.from(
      new Map(
        [...earlier.messages, ...later.messages].map((message) => [message.id, message]),
      ).values(),
    ),
    nextBefore: earlier.nextBefore,
    characterNames: { ...earlier.characterNames, ...later.characterNames },
    userNames: { ...earlier.userNames, ...later.userNames },
    messageSources: { ...earlier.messageSources, ...later.messageSources },
    timelineEvents: Array.from(
      new Map(
        [...(earlier.timelineEvents ?? []), ...(later.timelineEvents ?? [])].map((event) => [
          event.id,
          event,
        ]),
      ).values(),
    ).sort((left, right) => left.createdAt - right.createdAt),
    memoryReceipts: [
      ...(earlier.memoryReceipts ?? []).filter(
        (receipt) => !latestMessageIds.has(receipt.sourceMessageId),
      ),
      ...(later.memoryReceipts ?? []),
    ],
  };
}
function Avatar({
  snapshot,
  participants,
  className,
}: {
  snapshot: Snapshot;
  participants: string[];
  className?: string;
}): JSX.Element {
  const character = characterById(snapshot, participants[0] ?? "");
  const image = spriteSource(character, "평온");
  return (
    <span className={[s.avatar, className].filter(Boolean).join(" ")} aria-hidden="true">
      {participants.length > 1 ? (
        <Icon name="together" size={17} />
      ) : image ? (
        <img src={image} alt="" className={s.avatarImage} />
      ) : (
        nameFor(snapshot, participants[0] ?? "").slice(0, 1)
      )}
    </span>
  );
}

export function ConversationHistoryWindow({
  snapshot,
  initialPersona,
  preview = false,
  previewConversations,
}: Props): JSX.Element {
  const native = isDesktop() && !preview;
  const [restorationReady, setRestorationReady] = useState(!native);
  const [restorationAttempt, setRestorationAttempt] = useState(0);
  const generation = useRef<number | null>(null);
  const reopenPersona = useRef<string | null>(null);
  const restoreSelection = useRef<HistoryRestoration | null>(null);
  const restoreReading = useRef<HistoryRestoration | null>(null);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [selected, setSelected] = useState<ConversationSession | null>(null);
  const [page, setPage] = useState<ConversationMessages | null>(null);
  const [filter, setFilter] = useState(initialPersona ?? "all");
  const filterScope = useRef(filter);
  const filterRequest = useRef(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [saveRequest, setSaveRequest] = useState<ConversationSaveRequest | null>(null);
  const [replacement, setReplacement] = useState<{
    sessionId: string;
    messageId: string;
    previous: string;
    content: string;
  } | null>(null);
  const current = useRef(snapshot);
  current.current = snapshot;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const draft = useRef<Draft | null>(null);
  const owner = useRef<string | null>(null);
  const operation = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const closing = useRef(false);
  const transcriptRevision = useRef(0);
  const transcriptIdentity = useRef<{ sessionId: string; userId: string | undefined } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastSubmission = useRef<{ sessionId: string; messageId: string; content: string } | null>(
    null,
  );
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const busy = responding || Boolean(snapshot.playback);
  const selectedId = selected?.id;
  const transcript = useHistoryScroll(selectedId, page, snapshot.user?.id);
  const activeCharactersKey = snapshot.characters.active.join("\0");
  const editable = Boolean(selectedId && editing === selectedId);
  const recovery =
    snapshot.conversation?.session.id === selectedId ? snapshot.conversation?.recovery : undefined;
  const recoverable =
    recovery &&
    (recovery.reason === "cancelled" || isFailedSubmission(snapshot, recovery.messageId));

  function persistDraft(value = draft.current): Promise<void> {
    if (!value || preview) return Promise.resolve();
    const text = value.value;
    const task = saveQueue.current.then(async () => {
      if (value.userId !== current.current.user?.id || value.saved === text) return;
      if (
        owner.current !== value.sessionId &&
        ["input", "history-input"].includes(current.current.panel?.mode ?? "")
      )
        throw new Error("입력 위치가 바뀌었어요. 이 창에서 이어 말하기를 선택해 주세요.");
      await command("save_conversation_draft", {
        sessionId: value.sessionId,
        draft: text,
        inputOwner: "history",
      });
      value.saved = text;
    });
    saveQueue.current = task.catch(() => {});
    return task;
  }
  async function flushDraft(): Promise<void> {
    clearTimeout(saveTimer.current);
    await persistDraft();
  }
  function showSelection(session: ConversationSession | null): void {
    if (selectedRef.current?.id !== session?.id) {
      setPage(null);
      setSaveRequest(null);
      setError(null);
    }
    selectedRef.current = session;
    setSelected(session);
    const owned = Boolean(
      session && owner.current === session.id && draft.current?.sessionId === session.id,
    );
    setEditing(owned ? owner.current : null);
    setInput(owned ? (draft.current?.value ?? session?.draft ?? "") : (session?.draft ?? ""));
  }
  function adopt(view: ConversationView): void {
    const sameTranscript =
      selectedRef.current?.id === view.session.id &&
      selectedRef.current.userId === view.session.userId;
    owner.current = view.session.id;
    draft.current = {
      userId: view.session.userId,
      sessionId: view.session.id,
      value: view.session.draft,
      saved: view.session.draft,
    };
    selectedRef.current = view.session;
    setSelected(view.session);
    // Acquiring the editor does not discard older pages of the same transcript.
    setPage((previous) => (sameTranscript && previous ? mergePages(previous, view) : view));
    setInput(view.session.draft);
    setEditing(view.session.id);
    setSessions((previous) => [
      view.session,
      ...previous.filter((item) => item.id !== view.session.id),
    ]);
    lastSubmission.current = null;
  }
  async function select(session: ConversationSession, resumeEnded = false): Promise<void> {
    if (
      operation.current ||
      (selectedRef.current?.id === session.id &&
        owner.current === session.id &&
        draft.current?.sessionId === session.id)
    )
      return;
    operation.current = true;
    setPending(true);
    setError(null);
    const userId = current.current.user?.id;
    try {
      await flushDraft();
      if (userId !== current.current.user?.id) return;
      setSaveRequest(null);
      if (session.status !== "ended" || resumeEnded) {
        const view = preview
          ? (previewConversations?.find((item) => item.session.id === session.id) ?? {
              session,
              messages: [],
              nextBefore: null,
            })
          : await command<ConversationView>("resume_chat", {
              sessionId: session.id,
              surface: "history",
            });
        if (userId !== current.current.user?.id) return;
        adopt(view);
      } else {
        draft.current = null;
        if (selectedRef.current?.id !== session.id) setPage(null);
        selectedRef.current = session;
        setSelected(session);
        setEditing(null);
        setInput("");
      }
    } catch (cause) {
      if (alive.current && userId === current.current.user?.id) setError(errorText(cause));
    } finally {
      operation.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function close(): Promise<void> {
    if (!restorationReady) {
      setRestorationAttempt((value) => value + 1);
      return;
    }
    if (operation.current || (loading && !selectedRef.current)) return;
    // Explain blocked closes: the native close request is always prevented.
    if (saveRequest || replacement) {
      setError("저장하거나 취소한 뒤 닫아 주세요.");
      return;
    }
    if (busy) {
      setError("대답이 끝난 뒤 닫아 주세요.");
      return;
    }
    const closingGeneration = generation.current;
    const userId = current.current.user?.id;
    if (native && closingGeneration === null) return;
    operation.current = true;
    closing.current = true;
    setPending(true);
    setError(null);
    try {
      await flushDraft();
      if (userId !== current.current.user?.id || closingGeneration !== generation.current) return;
      const released = await command<boolean>("release_conversation_history", {
        ...(owner.current ? { sessionId: owner.current } : {}),
        generation: closingGeneration,
        restoration: userId
          ? {
              userId,
              selectedId: selectedRef.current?.id ?? null,
              filter,
              query,
              ...(restoreReading.current &&
              restoreReading.current.selectedId === selectedRef.current?.id
                ? {
                    anchor: restoreReading.current.anchor,
                    followingTail: restoreReading.current.followingTail,
                  }
                : transcript.capture()),
            }
          : null,
      });
      if (!released) {
        // An open that never reached this view leaves its generation stale.
        const state = await command<HistoryWindowState>("get_conversation_history_state");
        generation.current = Math.max(generation.current ?? 0, state.generation);
        if (alive.current) setError("창 상태가 바뀌었어요. 다시 닫아 주세요.");
        return;
      }
      owner.current = null;
      draft.current = null;
      setEditing(null);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      operation.current = false;
      closing.current = false;
      if (alive.current) setPending(false);
    }
  }
  const closeRef = useRef(close);
  closeRef.current = close;
  const filterRef = useRef(async (persona: string): Promise<void> => {
    setFilter(persona);
  });
  filterRef.current = async (persona: string): Promise<void> => {
    if (operation.current) return;
    const request = ++filterRequest.current;
    const userId = current.current.user?.id;
    const previousOwner = owner.current;
    const value = draft.current;
    const text = value?.value;
    try {
      await flushDraft();
      if (
        !alive.current ||
        operation.current ||
        request !== filterRequest.current ||
        userId !== current.current.user?.id ||
        previousOwner !== owner.current ||
        value !== draft.current ||
        text !== draft.current?.value
      )
        return;
      filterScope.current = persona;
      setFilter(persona);
      if (!selectedRef.current || !matchesFilter(selectedRef.current, persona)) {
        showSelection(sessions.find((session) => matchesFilter(session, persona)) ?? null);
      }
      setRevision((value) => value + 1);
    } catch (cause) {
      if (
        alive.current &&
        !operation.current &&
        request === filterRequest.current &&
        userId === current.current.user?.id &&
        previousOwner === owner.current &&
        value === draft.current
      )
        setError(errorText(cause));
    }
  };
  useEffect(() => {
    if (!pending && reopenPersona.current) {
      const persona = reopenPersona.current;
      reopenPersona.current = null;
      void filterRef.current(persona);
    }
  }, [pending]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(saveTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let active = true;
    const cleanups: Array<() => void> = [];
    const retain = (cleanup: () => void): void => {
      if (active) cleanups.push(cleanup);
      else cleanup();
    };
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeRef.current();
      })
      .then(retain)
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    void listen<{ generation: number; persona: string }>("conversation-history-open", (event) => {
      generation.current = Math.max(generation.current ?? 0, event.payload.generation);
      if (event.payload.persona !== "all") {
        if (operation.current) reopenPersona.current = event.payload.persona;
        else void filterRef.current(event.payload.persona);
      } else {
        // A reused hidden view still needs current database content on reopening.
        setRevision((value) => value + 1);
      }
    })
      .then(retain)
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [native]);
  useEffect(() => {
    if (!native) return;
    let active = true;
    setRestorationReady(false);
    setLoading(true);
    setListError(null);
    void command<HistoryWindowState>("get_conversation_history_state")
      .then((state) => {
        if (!active) return;
        generation.current = Math.max(generation.current ?? 0, state.generation);
        const saved = state.restoration;
        if (saved && saved.userId === current.current.user?.id) {
          const selectedFilter =
            initialPersona && initialPersona !== "all" ? initialPersona : saved.filter;
          filterScope.current = selectedFilter;
          setFilter(selectedFilter);
          setQuery(saved.query);
          setSearch(saved.query.trim());
          restoreSelection.current = saved;
          restoreReading.current = saved;
        }
        setRestorationReady(true);
      })
      .catch((cause: unknown) => {
        if (active) {
          setListError(errorText(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [native, snapshot.user?.id, restorationAttempt]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!restorationReady) return;
    let active = true;
    setLoading(true);
    setListError(null);
    const result = native
      ? command<ConversationSession[]>("get_conversations", { query: search || undefined })
      : Promise.resolve(
          (previewConversations ?? (snapshot.conversation ? [snapshot.conversation] : []))
            .filter(
              (view) =>
                !search ||
                [
                  view.session.title,
                  view.session.draft,
                  ...view.messages.map((message) => message.content),
                ].some((text) => text.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
            )
            .map((view) => view.session),
        );
    void result
      .then(async (value) => {
        if (!active) return;
        setSessions(value);
        const restored = restoreSelection.current;
        restoreSelection.current = null;
        if (restored && restored.userId === current.current.user?.id) {
          // Searching narrows the sidebar, not the already selected transcript.
          const candidates =
            native &&
            search &&
            restored.selectedId &&
            !value.some((session) => session.id === restored.selectedId)
              ? await command<ConversationSession[]>("get_conversations")
              : value;
          if (!active) return;
          showSelection(
            candidates.find(
              (session) =>
                session.id === restored.selectedId && matchesFilter(session, filterScope.current),
            ) ??
              value.find((session) => matchesFilter(session, filterScope.current)) ??
              null,
          );
          return;
        }
        const previous = selectedRef.current;
        if (previous && matchesFilter(previous, filterScope.current)) {
          const refreshed = value.find((session) => session.id === previous.id);
          if (refreshed) showSelection(refreshed);
        } else {
          showSelection(
            value.find((session) => matchesFilter(session, filterScope.current)) ?? null,
          );
        }
      })
      .catch((cause: unknown) => {
        if (active) setListError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [native, restorationReady, search, revision, snapshot.user?.id, previewConversations]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    transcriptRevision.current += 1;
    const userId = current.current.user?.id;
    const identity = transcriptIdentity.current;
    const restoring = restoreReading.current;
    if (restoring && (restoring.selectedId !== selectedId || restoring.userId !== userId))
      restoreReading.current = null;
    // Revalidation must not discard older loaded pages or their reading anchor.
    // Requery those pages from the database rather than retaining stale message bodies.
    if (
      !restoreReading.current &&
      page &&
      userId &&
      identity?.sessionId === selectedId &&
      identity.userId === userId
    ) {
      restoreReading.current = {
        userId,
        selectedId,
        filter: filterScope.current,
        query,
        ...transcript.capture(),
      };
    }
    transcriptIdentity.current = { sessionId: selectedId, userId };
    const requestedLive = current.current.conversation;
    setPageLoading(true);
    setPage(null);
    const result = native
      ? command<ConversationMessages>("get_conversation_messages", { sessionId: selectedId })
      : Promise.resolve(
          previewConversations?.find((view) => view.session.id === selectedId) ??
            snapshot.conversation ?? { messages: [], nextBefore: null },
        );
    void result
      .then(async (latest) => {
        let value = latest;
        const saved = restoreReading.current;
        if (saved?.selectedId === selectedId && saved.userId === current.current.user?.id) {
          while (
            native &&
            active &&
            !saved.followingTail &&
            saved.anchor &&
            value.nextBefore !== null &&
            !value.messages.some((message) => message.id === saved.anchor?.messageId)
          ) {
            const before = value.nextBefore;
            const older = await command<ConversationMessages>("get_conversation_messages", {
              sessionId: selectedId,
              before,
            });
            if (!active) return;
            value = mergePages(older, value);
            if (value.nextBefore === before) break;
          }
          if (!active) return;
          transcript.restore(saved);
          restoreReading.current = null;
        }
        if (!active) return;
        const live = current.current.conversation;
        setPage(
          live?.session.id === selectedId &&
            live.session.userId === current.current.user?.id &&
            (owner.current === selectedId || live !== requestedLive)
            ? mergePages(value, live)
            : value,
        );
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setPageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    selectedId,
    native,
    previewConversations,
    revision,
    snapshot.memoryRevision,
    snapshot.conversation?.session.id,
    snapshot.conversation?.session.status,
    activeCharactersKey,
  ]);
  useEffect(() => {
    if (preview) return;
    const conversation = snapshot.conversation;
    if (
      conversation &&
      conversation.session.id === selectedRef.current?.id &&
      conversation.session.userId === snapshot.user?.id
    ) {
      setSelected(conversation.session);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === conversation.session.id
            ? {
                ...conversation.session,
                draft: owner.current
                  ? (draft.current?.value ?? conversation.session.draft)
                  : conversation.session.draft,
              }
            : session,
        ),
      );
      setPage((previous) => (previous ? mergePages(previous, conversation) : conversation));
    }
    if (!owner.current) return;
    if (
      snapshot.panel?.mode !== "history-input" ||
      snapshot.conversation?.session.id !== owner.current
    ) {
      clearTimeout(saveTimer.current);
      const value = draft.current;
      if (!["input", "history-input"].includes(snapshot.panel?.mode ?? "")) {
        void persistDraft(value).catch((cause: unknown) => {
          if (alive.current && draft.current === value) setError(errorText(cause));
        });
      }
      owner.current = null;
      setEditing(null);
      return;
    }
    const submitted = lastSubmission.current;
    if (
      submitted &&
      isFailedSubmission(snapshot, submitted.messageId) &&
      draft.current?.sessionId === submitted.sessionId &&
      !draft.current.value
    ) {
      const value = draft.current;
      value.value = submitted.content;
      if (selectedRef.current?.id === submitted.sessionId) setInput(submitted.content);
      void persistDraft(value).catch((cause: unknown) => {
        if (alive.current && draft.current === value) setError(errorText(cause));
      });
    }
  }, [snapshot]);
  useEffect(() => {
    if (!editable || !draft.current || input === draft.current.saved) return;
    const value = draft.current;
    saveTimer.current = setTimeout(() => {
      void persistDraft(value).catch((cause: unknown) => {
        if (alive.current && draft.current === value) setError(errorText(cause));
      });
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [input, editable]);
  useEffect(() => {
    if (editable) textarea.current?.focus();
  }, [editing, editable]);
  useEffect(() => {
    setReplacement(null);
  }, [selectedId, editing, recovery?.messageId]);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    restoreSelection.current = null;
    restoreReading.current = null;
    transcriptIdentity.current = null;
    draft.current = null;
    owner.current = null;
    selectedRef.current = null;
    setSessions([]);
    setSelected(null);
    setPage(null);
    setEditing(null);
    setInput("");
    setSaveRequest(null);
    filterScope.current = initialPersona ?? "all";
    setFilter(initialPersona ?? "all");
    setQuery("");
    setSearch("");
  }, [snapshot.user?.id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        saveRequest ||
        replacement ||
        preview
      )
        return;
      event.preventDefault();
      void closeRef.current();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [saveRequest, replacement, preview]);

  async function send(): Promise<void> {
    const submitted = draft.current;
    if (
      !submitted ||
      !selected ||
      !editable ||
      !submitted.value.trim() ||
      operation.current ||
      busy
    )
      return;
    operation.current = true;
    setPending(true);
    setSending(true);
    setError(null);
    const content = submitted.value;
    const clientMessageId = crypto.randomUUID();
    try {
      await flushDraft();
      if (draft.current !== submitted || owner.current !== submitted.sessionId) return;
      transcript.followTail();
      lastSubmission.current = {
        sessionId: submitted.sessionId,
        messageId: clientMessageId,
        content,
      };
      await command("send_message", {
        sessionId: submitted.sessionId,
        content: content.trim(),
        target: selected.participants.length > 1 ? "all" : selected.participants[0],
        clientMessageId,
      });
      if (draft.current === submitted && owner.current === submitted.sessionId) {
        submitted.saved = "";
        if (submitted.value === content) {
          const failed = isFailedSubmission(current.current, clientMessageId);
          submitted.value = failed ? content : "";
          setInput(submitted.value);
        } else await persistDraft(submitted);
      }
    } catch (cause) {
      if (alive.current && draft.current === submitted) setError(errorText(cause));
    } finally {
      operation.current = false;
      if (alive.current) {
        setPending(false);
        setSending(false);
      }
    }
  }
  async function loadOlder(): Promise<void> {
    if (!selected || !page || page.nextBefore === null || pageLoading) return;
    const sessionId = selected.id;
    const userId = current.current.user?.id;
    const memoryRevision = current.current.memoryRevision;
    const characterIds = current.current.characters.active.join("\0");
    const revision = transcriptRevision.current;
    function isCurrent(): boolean {
      return (
        alive.current &&
        selectedRef.current?.id === sessionId &&
        current.current.user?.id === userId &&
        current.current.memoryRevision === memoryRevision &&
        current.current.characters.active.join("\0") === characterIds &&
        transcriptRevision.current === revision
      );
    }
    setPageLoading(true);
    try {
      const older = await command<ConversationMessages>("get_conversation_messages", {
        sessionId,
        before: page.nextBefore,
      });
      if (!isCurrent()) return;
      setPage((previous) => (previous ? mergePages(older, previous) : older));
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause));
    } finally {
      if (isCurrent()) setPageLoading(false);
    }
  }
  async function retry(): Promise<void> {
    if (!recovery || operation.current || busy || !editable) return;
    operation.current = true;
    setPending(true);
    setError(null);
    const value = draft.current;
    try {
      await flushDraft();
      if (draft.current !== value || owner.current !== value?.sessionId) return;
      transcript.followTail();
      await command("retry_turn", {
        messageId: recovery.messageId,
        target: page?.messages.find((message) => message.id === recovery.messageId)?.persona,
      });
    } catch (cause) {
      if (draft.current === value) setError(errorText(cause));
    } finally {
      operation.current = false;
      setPending(false);
    }
  }
  async function cancelGeneration(): Promise<void> {
    const request = snapshot.activeRequest;
    if (!request || !editable || operation.current) return;
    operation.current = true;
    setPending(true);
    setError(null);
    try {
      await flushDraft();
      if (
        current.current.activeRequest?.epoch !== request.epoch ||
        owner.current !== request.sessionId
      )
        return;
      await command("cancel_generation", { request });
    } catch (cause) {
      if (current.current.activeRequest?.epoch === request.epoch) setError(errorText(cause));
    } finally {
      operation.current = false;
      if (alive.current) setPending(false);
    }
  }
  function editFailedInput(): void {
    const value = draft.current;
    const message = page?.messages.find((item) => item.id === recovery?.messageId);
    if (!editable || !value || !message || pending) return;
    const content =
      lastSubmission.current?.messageId === message.id
        ? lastSubmission.current.content
        : message.content;
    if (value.value && value.value !== content) {
      setReplacement({
        sessionId: value.sessionId,
        messageId: message.id,
        previous: value.value,
        content,
      });
      return;
    }
    value.value = content;
    setInput(content);
    textarea.current?.focus();
  }
  function replaceDraft(): void {
    const value = draft.current;
    const choice = replacement;
    setReplacement(null);
    if (
      !choice ||
      !value ||
      !editable ||
      pending ||
      value.sessionId !== choice.sessionId ||
      recovery?.messageId !== choice.messageId ||
      value.value !== choice.previous
    )
      return;
    value.value = choice.content;
    setInput(choice.content);
    textarea.current?.focus();
  }
  async function openAiSettings(): Promise<void> {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError(null);
    const value = draft.current;
    try {
      await flushDraft();
      if (draft.current !== value) return;
      await command("set_settings_section", { section: "model" });
      if (draft.current !== value) return;
      await command("open_settings");
    } catch (cause) {
      if (draft.current === value) setError(errorText(cause));
    } finally {
      operation.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function openCharacterSettings(target?: string, showMemories = false): Promise<void> {
    const session = selectedRef.current;
    const characterId =
      target ?? (session?.participants.length === 1 ? session.participants[0] : undefined);
    if (
      operation.current ||
      !session ||
      !characterId ||
      !session.participants.includes(characterId)
    )
      return;
    const targetId = characterId;
    operation.current = true;
    setPending(true);
    setError(null);
    const userId = current.current.user?.id;
    const value = draft.current;
    const editingId = owner.current;
    function isCurrent(): boolean {
      return (
        alive.current &&
        current.current.user?.id === userId &&
        selectedRef.current?.id === session?.id &&
        selectedRef.current?.participants.includes(targetId) === true &&
        draft.current === value &&
        owner.current === editingId
      );
    }
    try {
      await flushDraft();
      if (!isCurrent()) return;
      await command("open_characters", {
        characterId: targetId,
        ...(showMemories ? { showMemories: true } : {}),
      });
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause));
    } finally {
      operation.current = false;
      if (alive.current) setPending(false);
    }
  }
  const personas = Array.from(
    new Set([
      ...snapshot.characters.active,
      ...sessions.flatMap((session) => session.participants),
    ]),
  );
  const visibleSessions = sessions.filter((session) => matchesFilter(session, filter));
  const participantName = selected ? sessionName(snapshot, selected) : "";
  const started = page?.timelineEvents?.find((event) => event.kind === "started");
  const receiptsByMessage = new Map<string, ConversationMemoryReceipt[]>();
  for (const receipt of page?.memoryReceipts ?? []) {
    if (!snapshot.characters.active.includes(receipt.characterId)) continue;
    const receipts = receiptsByMessage.get(receipt.sourceMessageId) ?? [];
    receipts.push(receipt);
    receiptsByMessage.set(receipt.sourceMessageId, receipts);
  }
  return (
    <Surface variant="window" className={s.window} aria-label="지난 대화 창">
      <WindowHeader
        className={s.header}
        label="지난 대화 닫기"
        nativeControls
        preview={preview}
        onClose={close}
        actions={
          <div className={s.search}>
            <SearchInput
              containerClassName={s.searchInput}
              aria-label="대화 찾기"
              placeholder="대화 찾기"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
        }
      >
        <h1 className={s.title}>지난 대화</h1>
      </WindowHeader>
      <div className={s.columns}>
        <aside className={s.sidebar} aria-label="대화 목록">
          <SegmentedControl
            className={s.filters}
            label="대화 상대"
            appearance="contained"
            value={filter}
            onValueChange={(value) => {
              void filterRef.current(value);
            }}
            disabled={pending}
            options={[
              { value: "all", label: "모두" },
              ...personas.map((id) => ({ value: id, label: nameFor(snapshot, id) })),
              { value: "together", label: "함께" },
            ]}
          />
          <div className={s.sessions}>
            {loading && (
              <p className={s.empty} role="status">
                지난 대화를 불러오고 있어요.
              </p>
            )}
            {listError && (
              <p className={s.error} role="alert">
                {listError}
              </p>
            )}
            {listError && !restorationReady && (
              <Button
                variant="ghost"
                size="small"
                onClick={() => setRestorationAttempt((value) => value + 1)}
              >
                다시 불러오기
              </Button>
            )}
            {!loading && !listError && visibleSessions.length === 0 && (
              <p className={s.empty}>
                {search ? "찾는 대화가 없어요." : "아직 나눈 대화가 없어요."}
              </p>
            )}
            {visibleSessions.map((session, index) => {
              const preview = draftPreview(session.draft);
              return (
                <Fragment key={session.id}>
                  {(index === 0 ||
                    dayLabel(visibleSessions[index - 1].createdAt) !==
                      dayLabel(session.createdAt)) && (
                    <h2 className={s.day}>{dayLabel(session.createdAt)}</h2>
                  )}
                  <ChoiceButton
                    kind="list"
                    className={s.session}
                    selected={session.id === selectedId}
                    disabled={pending}
                    onClick={() => {
                      void select(session);
                    }}
                  >
                    <Avatar
                      snapshot={snapshot}
                      participants={session.participants}
                      className={s.listAvatar}
                    />
                    <span className={s.sessionCopy}>
                      <span className={s.sessionHeading}>
                        <span className={s.sessionName}>{sessionName(snapshot, session)}</span>
                        <time
                          className={`${s.time} ${s.sessionTime}`}
                          dateTime={new Date(session.createdAt).toISOString()}
                        >
                          {timeLabel(session.createdAt)}
                        </time>
                      </span>
                      <span className={s.preview}>
                        {preview ? `초안 · ${preview}` : session.title || "새 대화"}
                      </span>
                    </span>
                  </ChoiceButton>
                </Fragment>
              );
            })}
          </div>
        </aside>
        <section className={s.detail} aria-label="선택한 대화">
          {!selected ? (
            <p className={s.empty}>왼쪽에서 지난 대화를 골라 주세요.</p>
          ) : (
            <>
              <header className={s.detailHeader}>
                <Avatar
                  snapshot={snapshot}
                  participants={selected.participants}
                  className={s.headerAvatar}
                />
                <div className={`${s.sessionCopy} ${s.detailCopy}`}>
                  <h2 className={s.detailHeading}>{participantName}</h2>
                  <p className={s.meta}>
                    {dayLabel(selected.createdAt)} {timeLabel(selected.createdAt)}
                    {selected.messageCount !== undefined && ` · 메시지 ${selected.messageCount}개`}
                  </p>
                </div>
                {selected.participants.length === 1 && (
                  <Button
                    variant="link"
                    size="small"
                    className={s.settingsButton}
                    disabled={pending}
                    onClick={() => {
                      void openCharacterSettings();
                    }}
                  >
                    {participantName} 설정
                  </Button>
                )}
              </header>
              <div
                className={s.log}
                role="log"
                aria-label="대화 내용"
                ref={transcript.log}
                onScroll={transcript.onScroll}
              >
                <p className={s.context}>
                  <time dateTime={new Date(started?.createdAt ?? selected.createdAt).toISOString()}>
                    {dayLabel(started?.createdAt ?? selected.createdAt)}{" "}
                    {timeLabel(started?.createdAt ?? selected.createdAt)}
                  </time>
                  {" · "}
                  {started
                    ? eventLabel(started)
                    : selected.continuedFrom
                      ? "지난 이야기에서 이어진 대화"
                      : "대화 시작"}
                </p>
                {page?.nextBefore !== null && page?.nextBefore !== undefined && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={pageLoading}
                    onClick={() => {
                      void loadOlder();
                    }}
                  >
                    앞선 내용 더 보기
                  </Button>
                )}
                {pageLoading && (
                  <p className={s.meta} role="status">
                    대화 기록을 불러오고 있어요.
                  </p>
                )}
                {!pageLoading && page?.messages.length === 0 && (
                  <p className={s.meta}>아직 나눈 이야기가 없어요.</p>
                )}
                {transcriptRows(page).map((row) => {
                  if (row.kind === "event") {
                    return (
                      <p className={s.context} key={`event:${row.event.id}`}>
                        <time dateTime={new Date(row.event.createdAt).toISOString()}>
                          {timeLabel(row.event.createdAt)}
                        </time>
                        {" · "}
                        {eventLabel(row.event)}
                      </p>
                    );
                  }
                  const message = row.message;
                  const user = message.role === "user";
                  const name = user
                    ? (page?.userNames?.[message.id] ??
                      snapshot.messageUserNames[message.id] ??
                      snapshot.user?.name ??
                      "나")
                    : (page?.characterNames?.[message.id] ??
                      nameFor(snapshot, message.persona ?? ""));
                  const time = (
                    <time className={s.time} dateTime={new Date(message.createdAt).toISOString()}>
                      {messageTimeLabel(message.createdAt)}
                    </time>
                  );
                  const provenance = user
                    ? name
                    : `${name} · ${responseOrigin(page?.messageSources?.[message.id])}`;
                  const provenanceId = `history-origin-${message.id}`;
                  return (
                    <div
                      className={s.messageBlock}
                      key={message.id}
                      data-history-message={message.id}
                    >
                      <article
                        className={`${s.message} ${user ? s.userMessage : ""}`}
                        aria-label={`${name}의 메시지`}
                      >
                        {user ? (
                          time
                        ) : (
                          <Avatar snapshot={snapshot} participants={[message.persona ?? ""]} />
                        )}
                        <div className={`${s.messageContent} ${user ? s.userMessageContent : ""}`}>
                          <p
                            className={`${s.bubble} ${user ? s.userBubble : ""}`}
                            title={provenance}
                            aria-describedby={provenanceId}
                          >
                            {message.content}
                          </p>
                          <div className={`${s.messageTools} ${user ? s.userMessageTools : ""}`}>
                            <span className={s.messageLabel} id={provenanceId}>
                              {provenance}
                            </span>
                            <ConversationMessageActions
                              message={message}
                              onSave={(kind) =>
                                setSaveRequest({
                                  sessionId: selected.id,
                                  message,
                                  kind,
                                })
                              }
                            />
                          </div>
                        </div>
                        {!user && time}
                      </article>
                      {(receiptsByMessage.get(message.id)?.length ?? 0) > 0 && (
                        <div className={`${s.memoryReceipts} ${user ? s.userMemoryReceipts : ""}`}>
                          {receiptsByMessage.get(message.id)?.map((receipt) => (
                            <Button
                              key={receipt.id}
                              variant="ghost"
                              leadingIcon={<Icon name="memory" size={15} />}
                              className={s.memoryReceipt}
                              disabled={pending}
                              title={`${nameFor(snapshot, receipt.characterId)} · 최근 수정 ${dayLabel(receipt.updatedAt)} ${timeLabel(receipt.updatedAt)}`}
                              onClick={() => {
                                void openCharacterSettings(receipt.characterId, true);
                              }}
                            >
                              기억했어요: {receipt.content}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {saveRequest && (
                <div className={s.save}>
                  <ConversationSave
                    snapshot={snapshot}
                    request={saveRequest}
                    onClose={() => setSaveRequest(null)}
                  />
                </div>
              )}
              <footer className={s.composer}>
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                {editable && snapshot.runtime.error && (
                  <p className={s.error} role="alert">
                    {snapshot.runtime.error}
                  </p>
                )}
                {!editable && (
                  <div className={s.actions}>
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() => {
                        void select(selected, true);
                      }}
                    >
                      이어서 말하기
                    </Button>
                    <span className={s.meta}>이 창에서 이야기를 이어갈 수 있어요.</span>
                  </div>
                )}
                {recoverable && editable && (
                  <div className={s.actions}>
                    <span className={s.meta}>
                      {recovery.reason === "cancelled"
                        ? "생성을 멈췄어요."
                        : "답변을 마치지 못했어요. 보낸 내용은 남아 있어요."}
                    </span>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pending || busy}
                      onClick={() => {
                        void retry();
                      }}
                    >
                      다시 이야기하기
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pending || busy}
                      onClick={editFailedInput}
                    >
                      입력 수정
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        void openAiSettings();
                      }}
                    >
                      AI 연결 확인
                    </Button>
                  </div>
                )}
                {responding && snapshot.activeRequest && editable && (
                  <div className={s.actions}>
                    <span className={s.meta} role="status">
                      대답을 준비하고 있어요.
                    </span>
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={pending}
                      onClick={() => {
                        void cancelGeneration();
                      }}
                    >
                      생성 멈추기
                    </Button>
                  </div>
                )}
                <InputCapsule
                  className={s.capsule}
                  form="multiline"
                  sendSize="compact"
                  label="이어서 말하기"
                  placeholder={`${participantName}에게 이어서 말하기`}
                  value={input}
                  inputRef={textarea}
                  sending={sending}
                  disabled={!editable}
                  sendDisabled={busy || pending}
                  disableInputWhileSending={false}
                  onValueChange={(value) => {
                    // Text typed after the closing flush would not be saved.
                    if (draft.current && editable && !closing.current) {
                      draft.current.value = value;
                      setInput(value);
                    }
                  }}
                  onSend={() => {
                    void send();
                  }}
                  textareaProps={{
                    rows: 1,
                    maxLength: 2000,
                    title: "Enter로 보내기 · Shift+Enter로 줄바꿈",
                    "aria-description": "Enter로 보내기 · Shift+Enter로 줄바꿈",
                    onCompositionStart: () => {
                      composing.current = true;
                    },
                    onCompositionEnd: () => {
                      composing.current = false;
                    },
                    onKeyDown: (event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        event.nativeEvent.keyCode !== 229 &&
                        !composing.current
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    },
                  }}
                />
                <p className={s.meta}>⏎ 보내기 · 답은 여기와 바탕화면 말풍선에 같이 보여요</p>
              </footer>
            </>
          )}
        </section>
      </div>
      <Dialog
        isOpen={Boolean(replacement && editable)}
        title="작성 중인 초안을 바꿀까요?"
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) setReplacement(null);
        }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplacement(null)}>
              계속 작성
            </Button>
            <Button onClick={replaceDraft}>초안 바꾸기</Button>
          </>
        }
      >
        <p>
          작성 중인 초안 대신 답변을 마치지 못한 입력을 가져와요. 이미 보낸 원문은 그대로 남아요.
        </p>
      </Dialog>
    </Surface>
  );
}
