import { useEffect, useState, type JSX } from "react";
import { Button } from "@fleetia/lagrange";
import { CompanionBox } from "./CompanionBox";
import { Balloon } from "./Balloon";
import { SettingsPanel } from "./SettingsPanel";
import type { Persona, SceneLine, Snapshot } from "../types";
import * as s from "./companion.css";
import * as ui from "../lagrange.css";

const DEMO: SceneLine[] = [
  {
    persona: "a",
    expression: "호기심",
    text: "박자를 하나 빼도 영창이 될까요. 아. 지금 해 보겠다는 건 아니고요.",
  },
  { persona: "b", expression: "기쁨", text: "빈 박자는 내가 꼬리로 채울게! 톡!" },
  { persona: "a", expression: "생각중", text: "그러면 뺀 게 아니잖아. ……일단 적어 둘게요." },
  { persona: "b", expression: "장난", text: "별꼬리표 박자, 한 칸 추가!" },
];
export function DesktopPreview({ initial }: { initial: Snapshot }): JSX.Element {
  const [state, setState] = useState(initial);
  const [line, setLine] = useState<number | null>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  async function dispatch(name: string, args?: Record<string, unknown>): Promise<void> {
    switch (name) {
      case "open_panel": {
        const persona = args?.persona as Persona;
        const mode = args?.mode as "menu" | "input" | "history";
        setLine(null);
        setState((previous) => ({ ...previous, panel: { persona, mode } }));
        return;
      }
      case "close_panel":
        setState((previous) => ({ ...previous, panel: null }));
        return;
      case "skip_talk":
        setLine(null);
        return;
      case "talk_now":
        setState((previous) => ({
          ...previous,
          panel: null,
          runtime: { ...previous.runtime, hidden: false },
        }));
        setLine(0);
        return;
      case "open_settings":
        setSettingsOpen(true);
        setState((previous) => ({ ...previous, panel: null }));
        return;
      case "open_characters":
        window.location.assign("?view=characters");
        return;
      case "set_paused":
        setState((previous) => ({
          ...previous,
          runtime: { ...previous.runtime, paused: args?.paused === true },
        }));
        return;
      case "hide_boxes":
        setLine(null);
        setState((previous) => ({
          ...previous,
          panel: null,
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
            <Balloon snapshot={snapshot} dispatch={dispatch} preview />
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
            <CompanionBox persona="a" snapshot={snapshot} dispatch={dispatch} preview />
            <CompanionBox persona="b" snapshot={snapshot} dispatch={dispatch} preview />
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
        상자를 클릭하면 메뉴, 두 번 클릭하면 입력창이 열려요. 실제 앱에서는 상자를 끌어서 옮길 수
        있어요.
      </p>
      {settingsOpen && <SettingsPanel snapshot={state} preview />}
    </main>
  );
}
