import { useEffect, useMemo, useState, type JSX } from "react";
import { Button } from "@fleetia/lagrange";
import { CompanionBox } from "../CompanionBox/CompanionBox";
import { Balloon } from "../Balloon/Balloon";
import { SettingsPanel } from "../SettingsPanel/SettingsPanel";
import type { ConversationView, Message, Persona, SceneLine, Snapshot } from "../../types";
import { activeCharacter } from "../characterIdentity";
import * as s from "../companion.css";
import * as ui from "../../lagrange.css";

const DEMO: SceneLine[] = [
  {
    persona: "a",
    expression: "기쁨",
    text: "왔네. 오늘도 여기서 같이 지내자.",
  },
  {
    persona: "b",
    expression: "기쁨",
    text: "계속 대답해 주지는 않아도 돼. 우리끼리도 잘 놀거든.",
  },
  { persona: "a", expression: "평온", text: "잠깐 쉬어 가도 좋겠다." },
  { persona: "b", expression: "평온", text: "여기서 조용히 같이 있을게." },
];
function pausedConversation(
  conversation: ConversationView | null | undefined,
): ConversationView | null {
  if (!conversation) return null;
  if (conversation.session.status !== "active") return conversation;
  return {
    ...conversation,
    session: { ...conversation.session, status: "paused", updatedAt: Date.now() },
  };
}
function newConversation(
  snapshot: Snapshot,
  participants: string[],
  messages: Message[] = [],
  continuedFrom: string | null = null,
): ConversationView | null {
  if (!snapshot.user) return null;
  const now = Date.now();
  return {
    session: {
      id: crypto.randomUUID(),
      userId: snapshot.user.id,
      participants,
      status: "active",
      title: messages[0]?.content ?? "새 대화",
      createdAt: now,
      updatedAt: now,
      draft: "",
      continuedFrom,
    },
    messages,
    nextBefore: null,
  };
}
export function DesktopPreview({ initial }: { initial: Snapshot }): JSX.Element {
  const [state, setState] = useState(initial);
  const [line, setLine] = useState<number | null>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archived, setArchived] = useState<ConversationView[]>([]);
  const conversations = useMemo(
    () => [
      ...(state.conversation ? [state.conversation] : []),
      ...archived.filter((item) => item.session.id !== state.conversation?.session.id),
    ],
    [state.conversation, archived],
  );
  useEffect(() => {
    if (line === null) {
      return;
    }
    const timer = window.setTimeout(() => setLine(line + 1 < DEMO.length ? line + 1 : null), 4200);
    return () => window.clearTimeout(timer);
  }, [line]);
  const snapshot: Snapshot = {
    ...state,
    playback:
      line === null
        ? null
        : {
            ...DEMO[line],
            id: `preview-${line}`,
            source: "script",
            endsAt: 0,
            lineIndex: line,
            lineCount: DEMO.length,
          },
  };
  function startConversation(conversation: ConversationView | null, persona: string): void {
    const previous = pausedConversation(state.conversation);
    if (previous)
      setArchived((items) => [
        previous,
        ...items.filter((item) => item.session.id !== previous.session.id),
      ]);
    setLine(null);
    setState((previous) => ({ ...previous, conversation, panel: { persona, mode: "input" } }));
  }
  async function dispatch(name: string, args?: Record<string, unknown>): Promise<void> {
    switch (name) {
      case "open_panel": {
        const requested = args?.persona as Persona;
        const persona = activeCharacter(state, requested)?.id ?? requested;
        const mode = args?.mode as "menu" | "input" | "history";
        if (mode === "input") {
          startConversation(newConversation(state, [persona]), persona);
          return;
        }
        setLine(null);
        setState((previous) => ({
          ...previous,
          panel: { persona, mode },
          conversation: pausedConversation(previous.conversation),
        }));
        return;
      }
      case "open_reply": {
        const displayed = snapshot.playback;
        if (!displayed || args?.playbackId !== displayed.id) return;
        const persona = activeCharacter(state, displayed.persona)?.id ?? displayed.persona;
        const seed: Message = {
          id: displayed.id,
          role: "assistant",
          persona,
          content: displayed.text,
          expression: displayed.expression,
          createdAt: Date.now(),
          status: "complete",
        };
        startConversation(newConversation(state, [persona], [seed]), persona);
        return;
      }
      case "save_conversation_draft":
        setState((previous) =>
          !previous.conversation || previous.conversation.session.id !== args?.sessionId
            ? previous
            : {
                ...previous,
                conversation: {
                  ...previous.conversation,
                  session: { ...previous.conversation.session, draft: String(args?.draft ?? "") },
                },
              },
        );
        return;
      case "send_message": {
        const current = state.conversation;
        if (
          !current ||
          args?.sessionId !== current.session.id ||
          current.session.status !== "active"
        )
          return;
        const content = String(args?.content ?? "").trim();
        if (!content) return;
        const started =
          current.messages.some((message) => message.role === "user") ||
          current.session.continuedFrom;
        const participants =
          !started && args?.target === "all"
            ? state.characters.active
            : current.session.participants;
        const now = Date.now();
        const messages: Message[] = [
          {
            id: String(args?.clientMessageId),
            role: "user",
            persona: participants.length > 1 ? "all" : participants[0],
            content,
            expression: null,
            createdAt: now,
            status: "complete",
          },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            persona: participants[0],
            content: "응, 듣고 있어. 더 이야기해 줘.",
            expression: "기쁨",
            createdAt: now + 1,
            status: "complete",
          },
        ];
        setState((previous) =>
          previous.conversation?.session.id !== current.session.id
            ? previous
            : {
                ...previous,
                messages: [...previous.messages, ...messages],
                conversation: {
                  ...previous.conversation,
                  session: {
                    ...previous.conversation.session,
                    participants,
                    title: started ? current.session.title : content,
                    draft: "",
                    updatedAt: now,
                  },
                  messages: [...previous.conversation.messages, ...messages],
                },
              },
        );
        return;
      }
      case "finish_conversation":
        setState((previous) =>
          !previous.conversation || previous.conversation.session.id !== args?.sessionId
            ? previous
            : {
                ...previous,
                panel: null,
                conversation: {
                  ...previous.conversation,
                  session: {
                    ...previous.conversation.session,
                    status: "ended",
                    updatedAt: Date.now(),
                  },
                },
              },
        );
        return;
      case "resume_chat": {
        const selected = conversations.find((item) => item.session.id === args?.sessionId);
        if (!selected) return;
        const resumed =
          selected.session.status === "ended"
            ? newConversation(state, selected.session.participants, [], selected.session.id)
            : {
                ...selected,
                session: { ...selected.session, status: "active" as const, updatedAt: Date.now() },
              };
        startConversation(resumed, selected.session.participants[0]);
        return;
      }
      case "close_panel":
        setState((previous) =>
          args?.sessionId && previous.conversation?.session.id !== args.sessionId
            ? previous
            : { ...previous, panel: null, conversation: pausedConversation(previous.conversation) },
        );
        return;
      case "skip_talk":
        setLine(null);
        return;
      case "talk_now":
        setState((previous) => ({
          ...previous,
          panel: null,
          conversation: pausedConversation(previous.conversation),
          runtime: { ...previous.runtime, hidden: false },
        }));
        setLine(0);
        return;
      case "open_settings":
        setSettingsOpen(true);
        setState((previous) => ({
          ...previous,
          panel: null,
          conversation: pausedConversation(previous.conversation),
        }));
        return;
      case "open_characters":
        window.location.assign("?view=characters");
        return;
      case "set_paused": {
        const minutes = typeof args?.minutes === "number" ? args.minutes : null;
        setState((previous) => ({
          ...previous,
          runtime: {
            ...previous.runtime,
            paused: args?.paused === true,
            pausedUntil: args?.paused === true && minutes ? Date.now() + minutes * 60_000 : null,
          },
        }));
        return;
      }
      case "hide_boxes":
        setLine(null);
        setState((previous) => ({
          ...previous,
          panel: null,
          conversation: pausedConversation(previous.conversation),
          runtime: { ...previous.runtime, hidden: true },
        }));
        return;
      default:
        throw new Error(
          "화면 동작 미리보기예요. 실제 대화와 저장은 데스크톱 앱에서 사용할 수 있어요.",
        );
    }
  }
  return (
    <main className={s.preview}>
      <h1 className={s.previewTitle}>comet</h1>
      <p className={ui.quiet}>바탕화면 한쪽에, 둘이 있어요.</p>
      <div className={s.stage}>
        {!state.runtime.hidden && (snapshot.panel || snapshot.playback) ? (
          <div className={s.stageBalloon}>
            <Balloon
              snapshot={snapshot}
              dispatch={dispatch}
              previewConversations={conversations}
              preview
            />
          </div>
        ) : (
          <p className={s.resting}>
            {state.runtime.hidden
              ? "상자를 숨긴 모습이에요."
              : "말이 없을 때는, 이렇게 둘만 남아요."}
          </p>
        )}
        {!state.runtime.hidden && (
          <div className={s.actors}>
            {snapshot.characters.active.map((id) => (
              <CompanionBox key={id} id={id} snapshot={snapshot} dispatch={dispatch} preview />
            ))}
          </div>
        )}
      </div>
      <div className={s.demoControls}>
        <Button variant="secondary" onClick={() => void dispatch("talk_now")}>
          둘의 대화 예시 보기
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setState((previous) => ({
              ...previous,
              runtime: { ...previous.runtime, hidden: false },
            }));
            void dispatch("open_panel", { persona: "a", mode: "menu" });
          }}
        >
          메뉴 열어 보기
        </Button>
        <Button variant="quiet" onClick={() => setSettingsOpen(!settingsOpen)}>
          {settingsOpen ? "설정 접기" : "설정 살펴보기"}
        </Button>
      </div>
      <p className={ui.quiet}>
        화면 동작 미리보기 · 대사는 미리 정해진 예시예요.
        <br />
        말풍선을 클릭하면 답장할 수 있어요. 캐릭터 우클릭은 메뉴, 두 번 클릭은 새 대화예요.
        미리보기의 대화는 이 화면에서만 유지돼요.
      </p>
      {settingsOpen && <SettingsPanel snapshot={state} preview />}
    </main>
  );
}
