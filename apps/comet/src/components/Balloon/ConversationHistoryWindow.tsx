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
  ConversationSession,
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
import * as s from "./conversationHistoryWindow.css";

type Props = {
  snapshot: Snapshot;
  initialPersona?: string;
  preview?: boolean;
  previewConversations?: ConversationView[];
};
type Draft = { userId: string; sessionId: string; value: string; saved: string };

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
function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "오늘";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "어제";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}
function mergePages(
  earlier: ConversationMessages,
  later: ConversationMessages,
): ConversationMessages {
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
  };
}
function Avatar({
  snapshot,
  participants,
}: {
  snapshot: Snapshot;
  participants: string[];
}): JSX.Element {
  const character = characterById(snapshot, participants[0] ?? "");
  const image = spriteSource(character, "평온");
  return (
    <span className={s.avatar} aria-hidden="true">
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
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [selected, setSelected] = useState<ConversationSession | null>(null);
  const [page, setPage] = useState<ConversationMessages | null>(null);
  const [filter, setFilter] = useState(initialPersona ?? "all");
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastSubmission = useRef<{ sessionId: string; messageId: string; content: string } | null>(
    null,
  );
  const native = isDesktop() && !preview;
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const busy = responding || Boolean(snapshot.playback);
  const selectedId = selected?.id;
  const editable = Boolean(selectedId && editing === selectedId);
  const recovery =
    snapshot.conversation?.session.id === selectedId ? snapshot.conversation?.recovery : undefined;

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
  function adopt(view: ConversationView): void {
    owner.current = view.session.id;
    draft.current = {
      userId: view.session.userId,
      sessionId: view.session.id,
      value: view.session.draft,
      saved: view.session.draft,
    };
    selectedRef.current = view.session;
    setSelected(view.session);
    setPage(view);
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
      (selectedRef.current?.id === session.id && owner.current === session.id)
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
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError(null);
    try {
      await flushDraft();
      await command(
        "release_conversation_history",
        owner.current ? { sessionId: owner.current } : {},
      );
      owner.current = null;
      draft.current = null;
      setEditing(null);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      operation.current = false;
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
    try {
      await flushDraft();
      setFilter(persona);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
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
    void listen<string>("conversation-history-persona", (event) => {
      void filterRef.current(event.payload);
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
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
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
      .then((value) => {
        if (!active) return;
        setSessions(value);
        const refreshed = value.find((session) => session.id === selectedRef.current?.id);
        if (refreshed) {
          setSelected(refreshed);
          if (!owner.current) setInput(refreshed.draft);
        }
        if (!selectedRef.current) {
          const first =
            value.find(
              (session) => !initialPersona || session.participants.includes(initialPersona),
            ) ?? value[0];
          if (first) {
            selectedRef.current = first;
            setSelected(first);
            setInput(first.draft);
          }
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
  }, [native, search, revision, snapshot.user?.id, previewConversations]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setPageLoading(true);
    setPage(null);
    const result = native
      ? command<ConversationMessages>("get_conversation_messages", { sessionId: selectedId })
      : Promise.resolve(
          previewConversations?.find((view) => view.session.id === selectedId) ??
            snapshot.conversation ?? { messages: [], nextBefore: null },
        );
    void result
      .then((value) => {
        if (!active) return;
        const live = current.current.conversation;
        setPage(
          live?.session.id === selectedId && owner.current === selectedId
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
  }, [selectedId, native, previewConversations, revision]);
  useEffect(() => {
    if (!owner.current || preview) return;
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
    const conversation = snapshot.conversation;
    if (conversation.session.id === selectedRef.current?.id) {
      setSelected(conversation.session);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === conversation.session.id
            ? { ...conversation.session, draft: draft.current?.value ?? conversation.session.draft }
            : session,
        ),
      );
      setPage((previous) => (previous ? mergePages(previous, conversation) : conversation));
    }
    const submitted = lastSubmission.current;
    if (
      submitted &&
      snapshot.conversation.recovery?.messageId === submitted.messageId &&
      draft.current?.sessionId === submitted.sessionId &&
      !draft.current.value
    ) {
      draft.current.value = submitted.content;
      setInput(submitted.content);
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
    draft.current = null;
    owner.current = null;
    selectedRef.current = null;
    setSessions([]);
    setSelected(null);
    setPage(null);
    setEditing(null);
    setInput("");
    setSaveRequest(null);
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
          const failed = current.current.conversation?.recovery?.messageId === clientMessageId;
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
    setPageLoading(true);
    try {
      const older = await command<ConversationMessages>("get_conversation_messages", {
        sessionId,
        before: page.nextBefore,
      });
      if (selectedRef.current?.id !== sessionId) return;
      setPage((previous) => (previous ? mergePages(older, previous) : older));
    } catch (cause) {
      if (selectedRef.current?.id === sessionId) setError(errorText(cause));
    } finally {
      if (selectedRef.current?.id === sessionId) setPageLoading(false);
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
  const personas = Array.from(
    new Set([
      ...snapshot.characters.active,
      ...sessions.flatMap((session) => session.participants),
    ]),
  );
  const visibleSessions = sessions.filter(
    (session) =>
      filter === "all" ||
      (filter === "together"
        ? session.participants.length > 1
        : session.participants.includes(filter)),
  );
  const participantName = selected ? sessionName(snapshot, selected) : "";
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
                    <Avatar snapshot={snapshot} participants={session.participants} />
                    <span className={s.sessionCopy}>
                      <span className={s.sessionHeading}>
                        <span className={s.sessionName}>{sessionName(snapshot, session)}</span>
                        <time
                          className={s.time}
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
                <Avatar snapshot={snapshot} participants={selected.participants} />
                <div className={s.sessionCopy}>
                  <h2 className={s.detailHeading}>{participantName}</h2>
                  <p className={s.meta}>
                    {dayLabel(selected.createdAt)} {timeLabel(selected.createdAt)} ·{" "}
                    {selected.title || "새 대화"}
                  </p>
                </div>
                {selected.participants.length === 1 && (
                  <Button
                    variant="link"
                    size="small"
                    onClick={() => {
                      void flushDraft()
                        .then(() => command("open_characters"))
                        .catch((cause: unknown) => setError(errorText(cause)));
                    }}
                  >
                    친구 설정
                  </Button>
                )}
              </header>
              <div className={s.log} role="log" aria-label="대화 내용">
                <p className={s.context}>
                  {selected.continuedFrom ? "지난 이야기에서 이어진 대화" : "대화 시작"} ·{" "}
                  {dayLabel(selected.createdAt)} {timeLabel(selected.createdAt)}
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
                {page?.messages.map((message) => {
                  const user = message.role === "user";
                  const name = user
                    ? (page.userNames?.[message.id] ??
                      snapshot.messageUserNames[message.id] ??
                      snapshot.user?.name ??
                      "나")
                    : (page.characterNames?.[message.id] ??
                      nameFor(snapshot, message.persona ?? ""));
                  const time = (
                    <time className={s.time} dateTime={new Date(message.createdAt).toISOString()}>
                      {timeLabel(message.createdAt)}
                    </time>
                  );
                  return (
                    <article
                      className={`${s.message} ${user ? s.userMessage : ""}`}
                      aria-label={`${name}의 메시지`}
                      key={message.id}
                    >
                      {user ? (
                        time
                      ) : (
                        <Avatar snapshot={snapshot} participants={[message.persona ?? ""]} />
                      )}
                      <div className={s.messageContent}>
                        {selected.participants.length > 1 && !user && (
                          <span className={s.messageLabel}>{name}</span>
                        )}
                        <p className={`${s.bubble} ${user ? s.userBubble : ""}`}>
                          {message.content}
                        </p>
                        <span className={s.messageLabel}>
                          {name}
                          {!user && ` · ${responseOrigin(page.messageSources?.[message.id])}`}
                        </span>
                        <ConversationMessageActions
                          message={message}
                          onSave={(kind) =>
                            setSaveRequest({
                              sessionId: selected.id,
                              message,
                              kind,
                              context: selected.noteContext,
                            })
                          }
                        />
                      </div>
                      {!user && time}
                    </article>
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
                {recovery && editable && (
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
                  label="이어서 말하기"
                  placeholder={`${participantName}에게 이어서 말하기`}
                  value={input}
                  inputRef={textarea}
                  sending={sending}
                  disabled={!editable}
                  sendDisabled={busy || pending}
                  disableInputWhileSending={false}
                  onValueChange={(value) => {
                    if (draft.current && editable) {
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
                <p className={s.meta}>⏎ 보내기 · Shift+Enter 줄바꿈 · 답은 바탕화면에도 보여요</p>
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
